import WebSocket from 'ws';
import { 
  KalshiWSMessage, 
  ConnectionState,
  TickerMessage,
  OrderbookSnapshotMessage,
  OrderbookDeltaMessage,
  getWsUrl 
} from './types';
import { generateAuthHeaders, hasAuthCredentials } from './signing';

const MAX_RAW_FEED_SIZE = 200;

export interface WSConnectionOptions {
  marketTickers: string[];
  channels?: string[];
  useAuth?: boolean;
  onMessage?: (msg: KalshiWSMessage) => void;
  onStateUpdate?: (state: ConnectionState) => void;
  onError?: (error: string, requiresAuth?: boolean) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
}

export function createConnectionState(): ConnectionState {
  return {
    tickersByMarket: new Map(),
    orderbookByMarket: new Map(),
    rawFeed: [],
  };
}

function applyTickerUpdate(state: ConnectionState, msg: TickerMessage['msg']) {
  state.tickersByMarket.set(msg.market_ticker, msg);
}

function applyOrderbookSnapshot(state: ConnectionState, msg: OrderbookSnapshotMessage['msg']) {
  const yesMap = new Map<number, number>();
  const noMap = new Map<number, number>();

  for (const [price, quantity] of msg.yes || []) {
    if (quantity > 0) yesMap.set(price, quantity);
  }
  for (const [price, quantity] of msg.no || []) {
    if (quantity > 0) noMap.set(price, quantity);
  }

  state.orderbookByMarket.set(msg.market_ticker, { yes: yesMap, no: noMap });
}

function applyOrderbookDelta(state: ConnectionState, msg: OrderbookDeltaMessage['msg']) {
  let book = state.orderbookByMarket.get(msg.market_ticker);
  if (!book) {
    book = { yes: new Map(), no: new Map() };
    state.orderbookByMarket.set(msg.market_ticker, book);
  }

  const sideMap = msg.side === 'yes' ? book.yes : book.no;
  const currentQty = sideMap.get(msg.price) || 0;
  const newQty = currentQty + msg.delta;

  if (newQty <= 0) {
    sideMap.delete(msg.price);
  } else {
    sideMap.set(msg.price, newQty);
  }
}

function addToRawFeed(state: ConnectionState, data: unknown) {
  state.rawFeed.push({ ts: Date.now(), data });
  if (state.rawFeed.length > MAX_RAW_FEED_SIZE) {
    state.rawFeed.shift();
  }
}

export function connectAndSubscribe(options: WSConnectionOptions): { 
  close: () => void; 
  getState: () => ConnectionState;
} {
  const {
    marketTickers,
    channels = ['ticker', 'orderbook_delta', 'trade'],
    useAuth = false,
    onMessage,
    onStateUpdate,
    onError,
    onConnected,
    onDisconnected,
  } = options;

  const wsUrl = getWsUrl();
  const state = createConnectionState();
  let ws: WebSocket | null = null;
  let subscribeId = 1;
  let isClosed = false;
  let hasReceivedMessage = false;
  let authFailureTimeout: NodeJS.Timeout | null = null;

  const wsOptions: WebSocket.ClientOptions = {
    headers: {},
  };

  if (useAuth) {
    const authHeaders = generateAuthHeaders('GET', '/trade-api/ws/v2');
    if (authHeaders) {
      wsOptions.headers = authHeaders as unknown as { [key: string]: string };
    }
  }

  try {
    ws = new WebSocket(wsUrl, wsOptions);
  } catch (err) {
    onError?.(`Failed to create WebSocket: ${err}`, false);
    return { close: () => {}, getState: () => state };
  }

  ws.on('open', () => {
    if (isClosed || !ws) return;

    authFailureTimeout = setTimeout(() => {
      if (!hasReceivedMessage && !isClosed) {
        if (!useAuth && hasAuthCredentials()) {
          onError?.('WebSocket connection may require authentication. Retrying with auth...', true);
        } else if (!useAuth) {
          onError?.('Kalshi WebSocket requires API-key auth. Set KALSHI_ACCESS_KEY + KALSHI_PRIVATE_KEY_PEM to enable fallback auth mode.', true);
        }
      }
    }, 5000);

    const subscribeMessage = {
      id: subscribeId++,
      cmd: 'subscribe',
      params: {
        channels,
        market_tickers: marketTickers,
      },
    };

    ws.send(JSON.stringify(subscribeMessage));
    onConnected?.();
  });

  ws.on('message', (data: WebSocket.Data) => {
    if (isClosed) return;
    hasReceivedMessage = true;

    if (authFailureTimeout) {
      clearTimeout(authFailureTimeout);
      authFailureTimeout = null;
    }

    try {
      const message = JSON.parse(data.toString()) as KalshiWSMessage;
      
      addToRawFeed(state, message);

      switch (message.type) {
        case 'ticker':
          applyTickerUpdate(state, (message as TickerMessage).msg);
          break;
        case 'orderbook_snapshot':
          applyOrderbookSnapshot(state, (message as OrderbookSnapshotMessage).msg);
          break;
        case 'orderbook_delta':
          applyOrderbookDelta(state, (message as OrderbookDeltaMessage).msg);
          break;
        case 'error':
          const errMsg = message.msg as { message?: string };
          if (errMsg.message?.toLowerCase().includes('auth') || 
              errMsg.message?.toLowerCase().includes('unauthorized')) {
            onError?.(errMsg.message || 'Authentication error', true);
          } else {
            onError?.(errMsg.message || 'WebSocket error', false);
          }
          break;
      }

      onMessage?.(message);
      onStateUpdate?.(state);
    } catch (err) {
      console.error('Failed to parse WS message:', err);
    }
  });

  ws.on('error', (err: Error) => {
    if (isClosed) return;
    console.error('WebSocket error:', err);
    onError?.(`WebSocket error: ${err.message}`, false);
  });

  ws.on('close', (code: number, reason: Buffer) => {
    if (isClosed) return;
    
    if (authFailureTimeout) {
      clearTimeout(authFailureTimeout);
      authFailureTimeout = null;
    }

    if (code === 1008 || code === 4001 || code === 4003) {
      onError?.('Kalshi WebSocket requires API-key auth. Set KALSHI_ACCESS_KEY + KALSHI_PRIVATE_KEY_PEM to enable fallback auth mode.', true);
    } else if (!hasReceivedMessage && code !== 1000) {
      if (!useAuth && hasAuthCredentials()) {
        onError?.('Connection closed without messages. Will retry with auth.', true);
      } else if (!useAuth) {
        onError?.('Kalshi WebSocket requires API-key auth. Set KALSHI_ACCESS_KEY + KALSHI_PRIVATE_KEY_PEM to enable fallback auth mode.', true);
      }
    }
    
    onDisconnected?.();
  });

  return {
    close: () => {
      isClosed = true;
      if (authFailureTimeout) {
        clearTimeout(authFailureTimeout);
      }
      if (ws && ws.readyState !== WebSocket.CLOSED) {
        ws.close();
      }
    },
    getState: () => state,
  };
}

export function getOrderbookSummary(state: ConnectionState, marketTicker: string): {
  yes_bid?: number;
  yes_ask?: number;
  yes_levels: [number, number][];
  no_levels: [number, number][];
} {
  const book = state.orderbookByMarket.get(marketTicker);
  if (!book) {
    return { yes_levels: [], no_levels: [] };
  }

  const yesLevels = Array.from(book.yes.entries()).sort((a, b) => b[0] - a[0]);
  const noLevels = Array.from(book.no.entries()).sort((a, b) => b[0] - a[0]);

  const yesBid = yesLevels.length > 0 ? yesLevels[0][0] : undefined;
  const yesAsk = noLevels.length > 0 ? 100 - noLevels[0][0] : undefined;

  return {
    yes_bid: yesBid,
    yes_ask: yesAsk,
    yes_levels: yesLevels.slice(0, 5),
    no_levels: noLevels.slice(0, 5),
  };
}
