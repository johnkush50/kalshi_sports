import { NextRequest } from 'next/server';
import { fetchRelatedEvents, extractMarketTickers, EnrichedMarket } from '@/lib/kalshi/rest';
import { connectAndSubscribe, getOrderbookSummary } from '@/lib/kalshi/ws';
import { hasAuthCredentials } from '@/lib/kalshi/signing';
import { StatsEngine } from '@/lib/kalshi/stats';
import { SignalsEngine } from '@/lib/kalshi/signals';
import {
  KalshiWSMessage,
  ConnectionState,
  SSEPayload,
  TickerMessage,
  TradeMessage,
  OrderbookSnapshotMessage,
  OrderbookDeltaMessage,
} from '@/lib/kalshi/types';

const MAX_MARKETS = 50;
const TICKER_BATCH_INTERVAL = 300;
const RAW_BATCH_INTERVAL = 500;
const STATS_EMIT_INTERVAL = 500;
const SIGNALS_EMIT_INTERVAL = 1000;

function sendSSE(controller: ReadableStreamDefaultController, payload: SSEPayload) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  controller.enqueue(new TextEncoder().encode(data));
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const eventTicker = searchParams.get('eventTicker');
  const useAuth = searchParams.get('useAuth') === 'true';

  if (!eventTicker) {
    return new Response(JSON.stringify({ error: 'eventTicker is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let wsConnection: ReturnType<typeof connectAndSubscribe> | null = null;
  let tickerBatchTimer: NodeJS.Timeout | null = null;
  let rawBatchTimer: NodeJS.Timeout | null = null;
  let statsBatchTimer: NodeJS.Timeout | null = null;
  let signalsBatchTimer: NodeJS.Timeout | null = null;
  let pendingTickers: Map<string, TickerMessage['msg']> = new Map();
  let pendingRaw: { ts: number; data: unknown }[] = [];
  let isClosed = false;
  const statsEngine = new StatsEngine();
  const signalsEngine = new SignalsEngine();
  let currentGameId: string | null = null;
  let enrichedMarketsRef: EnrichedMarket[] = [];

  const stream = new ReadableStream({
    async start(controller) {
      sendSSE(controller, { type: 'status', status: 'resolving', message: 'Fetching event details...' });

      try {
        const relatedResult = await fetchRelatedEvents(eventTicker);
        const { primaryEvent, markets, resolvedEvents, gameId } = relatedResult;

        currentGameId = gameId;
        enrichedMarketsRef = markets;

        // Initialize signals engine with game ID first, then market metadata
        signalsEngine.setGameId(gameId);
        signalsEngine.setMarketMeta(markets.map(m => ({
          ticker: m.ticker || m.market_ticker || '',
          title: m.title,
          group_type: m.group_type,
          line: m.line,
          side: m.side,
          event_ticker: m.event_ticker,
        })));

        let marketTickers = extractMarketTickers(markets);

        if (marketTickers.length === 0) {
          sendSSE(controller, { type: 'error', message: 'No markets found for this event' });
          controller.close();
          return;
        }

        let cappedWarning = '';
        if (marketTickers.length > MAX_MARKETS) {
          cappedWarning = ` (showing first ${MAX_MARKETS} of ${marketTickers.length})`;
          marketTickers = marketTickers.slice(0, MAX_MARKETS);
        }

        const eventForMeta = primaryEvent || {
          event_ticker: eventTicker,
          title: `Game: ${gameId}`,
        };

        sendSSE(controller, {
          type: 'meta',
          event: { ...eventForMeta, markets: markets.slice(0, MAX_MARKETS) },
          markets: markets.slice(0, MAX_MARKETS),
          resolvedEvents,
          gameId,
        });

        if (cappedWarning) {
          sendSSE(controller, {
            type: 'status',
            status: 'streaming',
            message: `Connected${cappedWarning}`
          });
        }

        sendSSE(controller, { type: 'status', status: 'connecting', message: 'Connecting to WebSocket...' });

        const shouldUseAuth = hasAuthCredentials();

        let currentState: ConnectionState | null = null;

        wsConnection = connectAndSubscribe({
          marketTickers,
          channels: ['ticker', 'orderbook_delta', 'trade'],
          useAuth: shouldUseAuth,
          onMessage: (msg: KalshiWSMessage) => {
            if (isClosed) return;

            if (msg.type === 'ticker') {
              const tickerMsg = msg as TickerMessage;
              pendingTickers.set(tickerMsg.msg.market_ticker, tickerMsg.msg);
              statsEngine.onTickerUpdate(tickerMsg.msg);
            } else if (msg.type === 'orderbook_snapshot') {
              const obMsg = msg as OrderbookSnapshotMessage;
              statsEngine.onOrderbookUpdate(obMsg.msg.market_ticker);
            } else if (msg.type === 'orderbook_delta') {
              const obMsg = msg as OrderbookDeltaMessage;
              statsEngine.onOrderbookUpdate(obMsg.msg.market_ticker);
            } else if (msg.type === 'trade') {
              const tradeMsg = msg as TradeMessage;
              const ticker = currentState?.tickersByMarket.get(tradeMsg.msg.market_ticker);
              statsEngine.onTradeUpdate(tradeMsg.msg, ticker?.yes_bid, ticker?.yes_ask);
            }

            pendingRaw.push({ ts: Date.now(), data: msg });
            if (pendingRaw.length > 50) {
              pendingRaw = pendingRaw.slice(-50);
            }
          },
          onStateUpdate: (state: ConnectionState) => {
            if (isClosed) return;
            currentState = state;

            for (const [marketTicker] of pendingTickers) {
              const summary = getOrderbookSummary(state, marketTicker);
              if (summary.yes_levels.length > 0 || summary.no_levels.length > 0) {
                sendSSE(controller, {
                  type: 'orderbook',
                  market_ticker: marketTicker,
                  ...summary,
                });
              }
            }
          },
          onError: (error: string, requiresAuth?: boolean) => {
            if (isClosed) return;
            sendSSE(controller, {
              type: 'error',
              message: error,
              requiresAuth
            });
            if (requiresAuth && !shouldUseAuth && hasAuthCredentials()) {
              sendSSE(controller, {
                type: 'status',
                status: 'error',
                message: 'Auth available - reconnect with useAuth=true'
              });
            }
          },
          onConnected: () => {
            if (isClosed) return;
            sendSSE(controller, { type: 'status', status: 'streaming', message: 'Connected and streaming' });
          },
          onDisconnected: () => {
            if (isClosed) return;
            sendSSE(controller, { type: 'status', status: 'disconnected', message: 'WebSocket disconnected' });
          },
        });

        tickerBatchTimer = setInterval(() => {
          if (isClosed || pendingTickers.size === 0) return;

          for (const [, tickerData] of pendingTickers) {
            sendSSE(controller, { type: 'ticker', data: tickerData });
          }
          pendingTickers.clear();
        }, TICKER_BATCH_INTERVAL);

        rawBatchTimer = setInterval(() => {
          if (isClosed || pendingRaw.length === 0) return;

          sendSSE(controller, { type: 'raw', messages: [...pendingRaw] });
          pendingRaw = [];
        }, RAW_BATCH_INTERVAL);

        statsBatchTimer = setInterval(() => {
          if (isClosed || !currentState) return;

          const now = Date.now();
          const baseStats = statsEngine.computeAllStats(currentState);

          if (Object.keys(baseStats).length > 0) {
            // Compute enriched stats with signals
            const enrichedStats = signalsEngine.computeEnrichedStats(baseStats, now);
            sendSSE(controller, { type: 'stats', ts: now, markets: enrichedStats });
          }
        }, STATS_EMIT_INTERVAL);

        // Signals and ladders batch timer (less frequent)
        signalsBatchTimer = setInterval(() => {
          if (isClosed || !currentState || !currentGameId) return;

          const now = Date.now();
          const baseStats = statsEngine.computeAllStats(currentState);
          const enrichedStats = signalsEngine.computeEnrichedStats(baseStats, now);

          // Compute ladders for the current game
          const ladders = signalsEngine.computeLadders(enrichedStats, currentGameId, now);
          const signals = signalsEngine.getActiveSignals();

          // Clear old signals
          signalsEngine.clearOldSignals(60000);

          if (signals.length > 0 || ladders.length > 0) {
            sendSSE(controller, {
              type: 'signals',
              ts: now,
              signals,
              ladders,
            });
          }
        }, SIGNALS_EMIT_INTERVAL);

      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        sendSSE(controller, { type: 'error', message });
        controller.close();
      }
    },
    cancel() {
      isClosed = true;
      if (tickerBatchTimer) clearInterval(tickerBatchTimer);
      if (rawBatchTimer) clearInterval(rawBatchTimer);
      if (statsBatchTimer) clearInterval(statsBatchTimer);
      if (signalsBatchTimer) clearInterval(signalsBatchTimer);
      if (wsConnection) wsConnection.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
