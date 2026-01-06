export type GroupType = 'winner' | 'spread' | 'total' | 'other';

export interface KalshiMarket {
  ticker: string;
  market_ticker?: string;
  title: string;
  subtitle?: string;
  status?: string;
  yes_bid?: number;
  yes_ask?: number;
  last_price?: number;
  volume?: number;
  volume_24h?: number;
  open_interest?: number;
  result?: string;
  event_ticker?: string;
  group_type?: GroupType;
  line?: number | null;
  side?: string;
}

export interface KalshiEvent {
  event_ticker: string;
  title: string;
  subtitle?: string;
  category?: string;
  markets?: KalshiMarket[];
  mutually_exclusive?: boolean;
}

export interface EventWithMarkets {
  event: KalshiEvent;
  markets: KalshiMarket[];
}

export interface TickerMessage {
  type: 'ticker';
  msg: {
    market_ticker: string;
    yes_bid?: number;
    yes_ask?: number;
    no_bid?: number;
    no_ask?: number;
    last_price?: number;
    volume?: number;
    volume_24h?: number;
    open_interest?: number;
    ts?: number;
  };
}

export interface OrderbookSnapshotMessage {
  type: 'orderbook_snapshot';
  msg: {
    market_ticker: string;
    yes: [number, number][];
    no: [number, number][];
    ts?: number;
  };
}

export interface OrderbookDeltaMessage {
  type: 'orderbook_delta';
  msg: {
    market_ticker: string;
    price: number;
    delta: number;
    side: 'yes' | 'no';
    ts?: number;
  };
}

export interface TradeMessage {
  type: 'trade';
  msg: {
    market_ticker: string;
    trade_id?: string;
    count?: number;
    yes_price?: number;
    no_price?: number;
    taker_side?: string;
    ts?: number;
  };
}

export interface SubscribedMessage {
  type: 'subscribed';
  msg: {
    channel: string;
    market_tickers?: string[];
  };
}

export interface ErrorMessage {
  type: 'error';
  msg: {
    code?: number;
    message?: string;
  };
}

export type KalshiWSMessage =
  | TickerMessage
  | OrderbookSnapshotMessage
  | OrderbookDeltaMessage
  | TradeMessage
  | SubscribedMessage
  | ErrorMessage
  | { type: string; msg: unknown };

export interface ResolvedEventInfo {
  eventTicker: string;
  title: string;
  category?: string;
  marketCount: number;
}

export interface SSEMetaPayload {
  type: 'meta';
  event: KalshiEvent;
  markets: KalshiMarket[];
  resolvedEvents?: ResolvedEventInfo[];
  gameId?: string;
}

export interface SSETickerPayload {
  type: 'ticker';
  data: TickerMessage['msg'];
}

export interface SSEOrderbookPayload {
  type: 'orderbook';
  market_ticker: string;
  yes_bid?: number;
  yes_ask?: number;
  yes_levels: [number, number][];
  no_levels: [number, number][];
}

export interface SSERawPayload {
  type: 'raw';
  messages: { ts: number; data: unknown }[];
}

export interface SSEErrorPayload {
  type: 'error';
  message: string;
  requiresAuth?: boolean;
}

export interface SSEStatusPayload {
  type: 'status';
  status: 'resolving' | 'connecting' | 'streaming' | 'disconnected' | 'error';
  message?: string;
}

export interface SSEStatsPayload {
  type: 'stats';
  ts: number;
  markets: Record<string, import('./stats').MarketStats>;
}

export interface SSESignalsPayload {
  type: 'signals';
  ts: number;
  signals: import('./signals').SignalItem[];
  ladders: import('./signals').LadderState[];
}

export type SSEPayload =
  | SSEMetaPayload
  | SSETickerPayload
  | SSEOrderbookPayload
  | SSERawPayload
  | SSEErrorPayload
  | SSEStatusPayload
  | SSEStatsPayload
  | SSESignalsPayload;

export interface ConnectionState {
  tickersByMarket: Map<string, TickerMessage['msg']>;
  orderbookByMarket: Map<string, { yes: Map<number, number>; no: Map<number, number> }>;
  rawFeed: { ts: number; data: unknown }[];
}

export function getKalshiEnv(): 'prod' | 'demo' {
  const env = process.env.KALSHI_ENV?.toLowerCase();
  return env === 'demo' ? 'demo' : 'prod';
}

export function getRestBaseUrl(): string {
  return getKalshiEnv() === 'demo'
    ? 'https://demo-api.kalshi.co'
    : 'https://api.elections.kalshi.com';
}

export function getWsUrl(): string {
  return getKalshiEnv() === 'demo'
    ? 'wss://demo-api.kalshi.co/trade-api/ws/v2'
    : 'wss://api.elections.kalshi.com/trade-api/ws/v2';
}
