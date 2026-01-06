import { TickerMessage, TradeMessage, ConnectionState } from './types';

export interface MarketStats {
  market_ticker: string;
  ts: number;

  // Price / spread
  best_bid?: number;
  best_ask?: number;
  mid?: number;
  spread?: number;
  spread_bps?: number;
  implied_prob?: number;
  price_delta_1m?: number;

  // Microprice + imbalance
  microprice?: number;
  imbalance_top?: number;
  bid_size_top?: number;
  ask_size_top?: number;

  // Orderbook depth
  sum_bid_top5?: number;
  sum_ask_top5?: number;
  book_imbalance_top5?: number;
  wall_bid_size?: number;
  wall_ask_size?: number;
  wall_bid_ratio?: number;
  wall_ask_ratio?: number;

  // Trade flow
  trades_per_min?: number;
  trades_last_60s?: number;
  buy_pressure?: number;
  sell_pressure?: number;
  vwap_60s?: number;
  last_trade_age_ms?: number;
  last_trade_price?: number;
  volume?: number;
  open_interest?: number;

  // Volatility
  vol_mid_60s?: number;
  jump_flag?: boolean;
  jump_size?: number;

  // Data health
  last_ticker_age_ms?: number;
  last_orderbook_age_ms?: number;
  last_trade_ts?: number;
  feed_status: 'fresh' | 'stale' | 'unknown';
}

export interface StatsUpdate {
  type: 'stats';
  ts: number;
  markets: Record<string, MarketStats>;
}

export interface SSEStatsPayload {
  type: 'stats';
  ts: number;
  markets: Record<string, MarketStats>;
}

interface TradeRecord {
  ts: number;
  price: number;
  count: number;
  side: 'buy' | 'sell' | 'unknown';
}

interface MidRecord {
  ts: number;
  mid: number;
}

interface MarketBuffer {
  trades: TradeRecord[];
  mids: MidRecord[];
  lastTickerTs: number;
  lastOrderbookTs: number;
  lastTradeTs: number;
  lastMid?: number;
  mid5sAgo?: number;
  mid5sAgoTs?: number;
  mid1mAgo?: number;
  mid1mAgoTs?: number;
}

const RING_BUFFER_MAX_SIZE = 500;
const RING_BUFFER_WINDOW_MS = 60000;
const STALE_THRESHOLD_MS = 3000;
const JUMP_THRESHOLD_CENTS = 5;
const TOP_N_LEVELS = 5;

export class StatsEngine {
  private buffers: Map<string, MarketBuffer> = new Map();
  private lastComputedStats: Map<string, MarketStats> = new Map();
  private dirtyMarkets: Set<string> = new Set();

  private getOrCreateBuffer(marketTicker: string): MarketBuffer {
    let buffer = this.buffers.get(marketTicker);
    if (!buffer) {
      buffer = {
        trades: [],
        mids: [],
        lastTickerTs: 0,
        lastOrderbookTs: 0,
        lastTradeTs: 0,
      };
      this.buffers.set(marketTicker, buffer);
    }
    return buffer;
  }

  private pruneBuffer(buffer: MarketBuffer, now: number): void {
    const cutoff = now - RING_BUFFER_WINDOW_MS;

    while (buffer.trades.length > 0 && buffer.trades[0].ts < cutoff) {
      buffer.trades.shift();
    }
    if (buffer.trades.length > RING_BUFFER_MAX_SIZE) {
      buffer.trades = buffer.trades.slice(-RING_BUFFER_MAX_SIZE);
    }

    while (buffer.mids.length > 0 && buffer.mids[0].ts < cutoff) {
      buffer.mids.shift();
    }
    if (buffer.mids.length > RING_BUFFER_MAX_SIZE) {
      buffer.mids = buffer.mids.slice(-RING_BUFFER_MAX_SIZE);
    }
  }

  onTickerUpdate(msg: TickerMessage['msg']): void {
    const now = Date.now();
    const buffer = this.getOrCreateBuffer(msg.market_ticker);
    buffer.lastTickerTs = now;

    const bid = msg.yes_bid;
    const ask = msg.yes_ask;
    if (bid !== undefined && ask !== undefined && bid > 0 && ask > 0) {
      const mid = (bid + ask) / 2;
      buffer.mids.push({ ts: now, mid });

      if (buffer.mid5sAgoTs === undefined || now - buffer.mid5sAgoTs >= 5000) {
        buffer.mid5sAgo = buffer.lastMid;
        buffer.mid5sAgoTs = now;
      }

      if (buffer.mid1mAgoTs === undefined || now - buffer.mid1mAgoTs >= 60000) {
        buffer.mid1mAgo = buffer.lastMid;
        buffer.mid1mAgoTs = now;
      }
      buffer.lastMid = mid;
    }

    this.pruneBuffer(buffer, now);
    this.dirtyMarkets.add(msg.market_ticker);
  }

  onOrderbookUpdate(marketTicker: string): void {
    const now = Date.now();
    const buffer = this.getOrCreateBuffer(marketTicker);
    buffer.lastOrderbookTs = now;
    this.dirtyMarkets.add(marketTicker);
  }

  onTradeUpdate(msg: TradeMessage['msg'], currentBid?: number, currentAsk?: number): void {
    const now = Date.now();
    const buffer = this.getOrCreateBuffer(msg.market_ticker);
    buffer.lastTradeTs = now;

    const price = msg.yes_price ?? 0;
    const count = msg.count ?? 1;

    let side: 'buy' | 'sell' | 'unknown' = 'unknown';
    if (msg.taker_side) {
      side = msg.taker_side.toLowerCase() === 'yes' ? 'buy' : 'sell';
    } else if (currentBid !== undefined && currentAsk !== undefined && price > 0) {
      const midPrice = (currentBid + currentAsk) / 2;
      if (price >= midPrice) {
        side = 'buy';
      } else {
        side = 'sell';
      }
    }

    buffer.trades.push({ ts: now, price, count, side });
    this.pruneBuffer(buffer, now);
    this.dirtyMarkets.add(msg.market_ticker);
  }

  computeStats(state: ConnectionState): Record<string, MarketStats> {
    const now = Date.now();
    const result: Record<string, MarketStats> = {};

    for (const marketTicker of this.dirtyMarkets) {
      const stats = this.computeMarketStats(marketTicker, state, now);
      if (stats) {
        result[marketTicker] = stats;
        this.lastComputedStats.set(marketTicker, stats);
      }
    }

    this.dirtyMarkets.clear();
    return result;
  }

  computeAllStats(state: ConnectionState): Record<string, MarketStats> {
    const now = Date.now();
    const result: Record<string, MarketStats> = {};

    for (const marketTicker of state.tickersByMarket.keys()) {
      const stats = this.computeMarketStats(marketTicker, state, now);
      if (stats) {
        result[marketTicker] = stats;
        this.lastComputedStats.set(marketTicker, stats);
      }
    }

    for (const marketTicker of state.orderbookByMarket.keys()) {
      if (!result[marketTicker]) {
        const stats = this.computeMarketStats(marketTicker, state, now);
        if (stats) {
          result[marketTicker] = stats;
          this.lastComputedStats.set(marketTicker, stats);
        }
      }
    }

    this.dirtyMarkets.clear();
    return result;
  }

  private computeMarketStats(
    marketTicker: string,
    state: ConnectionState,
    now: number
  ): MarketStats | null {
    const buffer = this.buffers.get(marketTicker);
    const ticker = state.tickersByMarket.get(marketTicker);
    const book = state.orderbookByMarket.get(marketTicker);

    let bestBid = ticker?.yes_bid;
    let bestAsk = ticker?.yes_ask;
    let bidSizeTop = 0;
    let askSizeTop = 0;

    const yesLevels: [number, number][] = [];
    const noLevels: [number, number][] = [];

    if (book) {
      const sortedYes = Array.from(book.yes.entries()).sort((a, b) => b[0] - a[0]);
      const sortedNo = Array.from(book.no.entries()).sort((a, b) => b[0] - a[0]);

      for (let i = 0; i < Math.min(TOP_N_LEVELS, sortedYes.length); i++) {
        yesLevels.push(sortedYes[i]);
      }
      for (let i = 0; i < Math.min(TOP_N_LEVELS, sortedNo.length); i++) {
        noLevels.push(sortedNo[i]);
      }

      if (yesLevels.length > 0) {
        if (bestBid === undefined) bestBid = yesLevels[0][0];
        bidSizeTop = yesLevels[0][1];
      }
      if (noLevels.length > 0) {
        if (bestAsk === undefined) bestAsk = 100 - noLevels[0][0];
        askSizeTop = noLevels[0][1];
      }
    }

    let mid: number | undefined;
    let spread: number | undefined;
    let spreadBps: number | undefined;
    let impliedProb: number | undefined;
    let priceDelta1m: number | undefined;
    let microprice: number | undefined;
    let imbalanceTop: number | undefined;

    if (bestBid !== undefined && bestAsk !== undefined) {
      mid = (bestBid + bestAsk) / 2;
      spread = bestAsk - bestBid;
      if (mid > 0) {
        spreadBps = (spread / mid) * 10000;
      }
      impliedProb = mid / 100;

      if (bidSizeTop > 0 || askSizeTop > 0) {
        const totalSize = bidSizeTop + askSizeTop;
        if (totalSize > 0) {
          microprice = (bestAsk * bidSizeTop + bestBid * askSizeTop) / totalSize;
          imbalanceTop = (bidSizeTop - askSizeTop) / totalSize;
        }
      }

      if (buffer && buffer.mid1mAgo !== undefined && mid !== undefined) {
        priceDelta1m = mid - buffer.mid1mAgo;
      }
    }

    let sumBidTop5 = 0;
    let sumAskTop5 = 0;
    let wallBidSize = 0;
    let wallAskSize = 0;

    for (const [, size] of yesLevels) {
      sumBidTop5 += size;
      if (size > wallBidSize) wallBidSize = size;
    }
    for (const [, size] of noLevels) {
      sumAskTop5 += size;
      if (size > wallAskSize) wallAskSize = size;
    }

    let bookImbalanceTop5: number | undefined;
    if (sumBidTop5 > 0 || sumAskTop5 > 0) {
      bookImbalanceTop5 = (sumBidTop5 - sumAskTop5) / (sumBidTop5 + sumAskTop5);
    }

    const wallBidRatio = sumBidTop5 > 0 ? wallBidSize / sumBidTop5 : undefined;
    const wallAskRatio = sumAskTop5 > 0 ? wallAskSize / sumAskTop5 : undefined;

    let tradesLast60s = 0;
    let tradesPerMin = 0;
    let buyPressure = 0;
    let sellPressure = 0;
    let vwap60s: number | undefined;
    let lastTradeAgeMs: number | undefined;
    let lastTradePrice: number | undefined;

    if (buffer && buffer.trades.length > 0) {
      const cutoff = now - RING_BUFFER_WINDOW_MS;
      let totalValue = 0;
      let totalCount = 0;
      let buyCount = 0;
      let sellCount = 0;

      for (const trade of buffer.trades) {
        if (trade.ts >= cutoff) {
          tradesLast60s++;
          totalValue += trade.price * trade.count;
          totalCount += trade.count;
          if (trade.side === 'buy') buyCount += trade.count;
          else if (trade.side === 'sell') sellCount += trade.count;
        }
      }

      tradesPerMin = tradesLast60s;
      if (totalCount > 0) {
        vwap60s = totalValue / totalCount;
        const totalPressure = buyCount + sellCount;
        if (totalPressure > 0) {
          buyPressure = buyCount / totalPressure;
          sellPressure = sellCount / totalPressure;
        }
      }

      const lastTrade = buffer.trades[buffer.trades.length - 1];
      lastTradeAgeMs = now - lastTrade.ts;
      lastTradePrice = lastTrade.price;
    }

    let volMid60s: number | undefined;
    let jumpFlag = false;
    let jumpSize: number | undefined;

    if (buffer && buffer.mids.length >= 2) {
      const cutoff = now - RING_BUFFER_WINDOW_MS;
      const recentMids = buffer.mids.filter(m => m.ts >= cutoff);

      if (recentMids.length >= 2) {
        const changes: number[] = [];
        for (let i = 1; i < recentMids.length; i++) {
          changes.push(recentMids[i].mid - recentMids[i - 1].mid);
        }

        if (changes.length > 0) {
          const mean = changes.reduce((a, b) => a + b, 0) / changes.length;
          const variance = changes.reduce((a, b) => a + (b - mean) ** 2, 0) / changes.length;
          volMid60s = Math.sqrt(variance);
        }
      }

      if (buffer.lastMid !== undefined && buffer.mid5sAgo !== undefined) {
        const diff = Math.abs(buffer.lastMid - buffer.mid5sAgo);
        if (diff >= JUMP_THRESHOLD_CENTS) {
          jumpFlag = true;
          jumpSize = buffer.lastMid - buffer.mid5sAgo;
        }
      }
    }

    const lastTickerAgeMs = buffer?.lastTickerTs ? now - buffer.lastTickerTs : undefined;
    const lastOrderbookAgeMs = buffer?.lastOrderbookTs ? now - buffer.lastOrderbookTs : undefined;

    let feedStatus: 'fresh' | 'stale' | 'unknown' = 'unknown';
    const latestUpdate = Math.max(
      buffer?.lastTickerTs || 0,
      buffer?.lastOrderbookTs || 0,
      buffer?.lastTradeTs || 0
    );
    if (latestUpdate > 0) {
      feedStatus = now - latestUpdate < STALE_THRESHOLD_MS ? 'fresh' : 'stale';
    }

    return {
      market_ticker: marketTicker,
      ts: now,
      best_bid: bestBid,
      best_ask: bestAsk,
      mid,
      spread,
      spread_bps: spreadBps,
      implied_prob: impliedProb,
      price_delta_1m: priceDelta1m,
      microprice,
      imbalance_top: imbalanceTop,
      bid_size_top: bidSizeTop > 0 ? bidSizeTop : undefined,
      ask_size_top: askSizeTop > 0 ? askSizeTop : undefined,
      sum_bid_top5: sumBidTop5 > 0 ? sumBidTop5 : undefined,
      sum_ask_top5: sumAskTop5 > 0 ? sumAskTop5 : undefined,
      book_imbalance_top5: bookImbalanceTop5,
      wall_bid_size: wallBidSize > 0 ? wallBidSize : undefined,
      wall_ask_size: wallAskSize > 0 ? wallAskSize : undefined,
      wall_bid_ratio: wallBidRatio,
      wall_ask_ratio: wallAskRatio,
      trades_per_min: tradesPerMin,
      trades_last_60s: tradesLast60s,
      buy_pressure: buyPressure > 0 ? buyPressure : undefined,
      sell_pressure: sellPressure > 0 ? sellPressure : undefined,
      vwap_60s: vwap60s,
      last_trade_age_ms: lastTradeAgeMs,
      last_trade_price: lastTradePrice,
      vol_mid_60s: volMid60s,
      jump_flag: jumpFlag,
      jump_size: jumpSize,
      last_ticker_age_ms: lastTickerAgeMs,
      last_orderbook_age_ms: lastOrderbookAgeMs,
      last_trade_ts: buffer?.lastTradeTs,
      feed_status: feedStatus,
    };
  }

  getLastStats(): Map<string, MarketStats> {
    return this.lastComputedStats;
  }

  hasDirtyMarkets(): boolean {
    return this.dirtyMarkets.size > 0;
  }
}

export function computeMicroprice(
  bid: number,
  ask: number,
  bidSize: number,
  askSize: number
): number | undefined {
  const totalSize = bidSize + askSize;
  if (totalSize <= 0) return undefined;
  return (ask * bidSize + bid * askSize) / totalSize;
}

export function computeImbalance(bidSize: number, askSize: number): number | undefined {
  const totalSize = bidSize + askSize;
  if (totalSize <= 0) return undefined;
  return (bidSize - askSize) / totalSize;
}
