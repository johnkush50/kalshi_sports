"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Activity,
  AlertTriangle,
  ArrowUpDown,
  CheckCircle2,
  Clock,
  Copy,
  RefreshCw,
  TrendingUp,
  Wifi,
  WifiOff,
  X,
  ChevronRight,
  BarChart3,
  Zap
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  BarChart,
  Bar,
  ComposedChart,
} from "recharts";
import { DepthBar } from "@/components/ui/depth-bar";
import { MiniSparkline } from "@/components/ui/mini-sparkline";

type GroupType = 'winner' | 'spread' | 'total' | 'other';
type SignalType = 'MONO_VIOLATION' | 'NEG_MASS' | 'SUM_GT_1' | 'OUTLIER_LINE' | 'STALE_QUOTE' | 'JUMP' | 'LOW_LIQUIDITY' | 'WIDE_SPREAD';
type SignalConfidence = 'low' | 'medium' | 'high';

interface KalshiMarket {
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

interface ResolvedEventInfo {
  eventTicker: string;
  title: string;
  category?: string;
  marketCount: number;
}

interface KalshiEvent {
  event_ticker: string;
  title: string;
  subtitle?: string;
  category?: string;
  markets?: KalshiMarket[];
}

interface TickerData {
  market_ticker?: string;
  yes_bid?: number;
  yes_ask?: number;
  last_price?: number;
  volume?: number;
  volume_24h?: number;
  open_interest?: number;
}

interface RawMessage {
  ts: number;
  data: { type?: string; msg?: unknown };
}

interface MarketStats {
  market_ticker: string;
  ts: number;
  best_bid?: number;
  best_ask?: number;
  mid?: number;
  spread?: number;
  spread_bps?: number;
  implied_prob?: number;
  price_delta_1m?: number;
  microprice?: number;
  imbalance_top?: number;
  bid_size_top?: number;
  ask_size_top?: number;
  sum_bid_top5?: number;
  sum_ask_top5?: number;
  book_imbalance_top5?: number;
  wall_bid_size?: number;
  wall_ask_size?: number;
  wall_bid_ratio?: number;
  wall_ask_ratio?: number;
  trades_per_min?: number;
  trades_last_60s?: number;
  buy_pressure?: number;
  sell_pressure?: number;
  vwap_60s?: number;
  last_trade_age_ms?: number;
  last_trade_price?: number;
  vol_mid_60s?: number;
  jump_flag?: boolean;
  jump_size?: number;
  last_ticker_age_ms?: number;
  last_orderbook_age_ms?: number;
  last_trade_ts?: number;
  feed_status: 'fresh' | 'stale' | 'unknown';
  // Enriched fields
  group_type?: GroupType;
  line?: number | null;
  side?: string;
  liquidity_score?: number;
  staleness_score?: number;
  jump_score_5s?: number;
  jump_score_30s?: number;
  exitability_cents?: number;
  signals?: SignalType[];
}

interface SignalItem {
  id: string;
  ts: number;
  market_ticker: string;
  type: SignalType;
  confidence: SignalConfidence;
  suggested_action: string;
  reason: string;
  magnitude?: number;
  related_tickers?: string[];
  severity_score?: number;
  ladder_key?: string;
}

interface LadderPoint {
  line: number;
  side: string;
  market_ticker: string;
  title?: string;
  mid?: number;
  bid?: number;
  ask?: number;
  bid_prob: number;
  ask_prob: number;
  mid_prob: number;
  fitted_prob?: number;
  residual?: number;
  depth_bid?: number;
  depth_ask?: number;
  volume?: number;
  spread_cents?: number;
  is_violation?: boolean;
  is_outlier?: boolean;
  is_primary?: boolean;
  is_excluded?: boolean;
  exclude_reason?: string;
  parse_source?: 'ticker' | 'title' | 'unknown';
}

interface LadderDiagnostics {
  total_markets: number;
  parsed_markets: number;
  unparsed_markets: number;
  duplicates_dropped: number;
  excluded_by_liquidity: number;
  excluded_by_spread: number;
  excluded_by_staleness: number;
}

type MonotonicDirection = 'nonincreasing' | 'nondecreasing';

interface LadderState {
  ladder_key: string;
  game_id: string;
  ladder_type: 'spread' | 'total';
  team_or_direction: string;
  expected_direction: MonotonicDirection;
  points: LadderPoint[];
  violations: SignalItem[];
  diagnostics: LadderDiagnostics;
  mono_violation_count: number;
  outlier_count: number;
  max_violation_cents: number;
  last_updated: number;
}

interface LadderSummarySignal {
  ladder_key: string;
  ladder_type: 'spread' | 'total';
  side: string;
  mono_count: number;
  outlier_count: number;
  max_violation_cents: number;
  severity_score: number;
  details: SignalItem[];
}

type ConnectionStatus = "disconnected" | "resolving" | "connecting" | "streaming" | "error";

export default function Home() {
  const [eventTicker, setEventTicker] = useState("");
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [statusMessage, setStatusMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [requiresAuth, setRequiresAuth] = useState(false);

  const [event, setEvent] = useState<KalshiEvent | null>(null);
  const [markets, setMarkets] = useState<KalshiMarket[]>([]);
  const [tickerData, setTickerData] = useState<Map<string, TickerData>>(new Map());
  const [rawMessages, setRawMessages] = useState<RawMessage[]>([]);

  const [filterTicker, setFilterTicker] = useState(true);
  const [filterOrderbook, setFilterOrderbook] = useState(true);
  const [filterTrade, setFilterTrade] = useState(true);

  const [sortField, setSortField] = useState<string>("ticker");
  const [sortAsc, setSortAsc] = useState(true);

  // Live Stats state
  const [marketStats, setMarketStats] = useState<Map<string, MarketStats>>(new Map());
  const [statsSearch, setStatsSearch] = useState("");
  const [showOnlyFresh, setShowOnlyFresh] = useState(false);
  const [showOnlyJumping, setShowOnlyJumping] = useState(false);
  const [debugMarket, setDebugMarket] = useState<string | null>(null);
  const [statsSortField, setStatsSortField] = useState<string>("market_ticker");
  const [statsSortAsc, setStatsSortAsc] = useState(true);

  // Related events state
  const [resolvedEvents, setResolvedEvents] = useState<ResolvedEventInfo[]>([]);
  const [gameId, setGameId] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<GroupType | 'all'>('all');

  // Signals and ladders state
  const [signals, setSignals] = useState<SignalItem[]>([]);
  const [ladders, setLadders] = useState<LadderState[]>([]);
  const [selectedMarket, setSelectedMarket] = useState<string | null>(null);
  const [midHistory, setMidHistory] = useState<Map<string, { ts: number; mid: number }[]>>(new Map());
  const [mainTab, setMainTab] = useState<string>("markets");
  const [showSignalsOnly, setShowSignalsOnly] = useState(false);
  const [messageCount, setMessageCount] = useState(0);
  const [lastMessageTs, setLastMessageTs] = useState<number | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);

  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setStatus("disconnected");
    setStatusMessage("");
  }, []);

  const connect = useCallback((useAuth = false) => {
    if (!eventTicker.trim()) {
      setError("Please enter an event ticker");
      return;
    }

    disconnect();
    setError(null);
    setRequiresAuth(false);
    setEvent(null);
    setMarkets([]);
    setTickerData(new Map());
    setRawMessages([]);
    setMarketStats(new Map());
    setDebugMarket(null);
    setResolvedEvents([]);
    setGameId(null);
    setSelectedGroup('all');
    setSignals([]);
    setLadders([]);
    setSelectedMarket(null);
    setMidHistory(new Map());
    setMessageCount(0);
    setLastMessageTs(null);
    setStatus("resolving");

    const url = `/api/stream?eventTicker=${encodeURIComponent(eventTicker.trim())}${useAuth ? "&useAuth=true" : ""}`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data);

        switch (payload.type) {
          case "status":
            setStatus(payload.status);
            setStatusMessage(payload.message || "");
            break;

          case "meta":
            setEvent(payload.event);
            setMarkets(payload.markets || []);
            if (payload.resolvedEvents) {
              setResolvedEvents(payload.resolvedEvents);
            }
            if (payload.gameId) {
              setGameId(payload.gameId);
            }
            break;

          case "ticker":
            setTickerData((prev) => {
              const next = new Map(prev);
              next.set(payload.data.market_ticker, payload.data);
              return next;
            });
            break;

          case "raw":
            setRawMessages((prev) => {
              const next = [...prev, ...payload.messages];
              return next.slice(-200);
            });
            break;

          case "stats":
            setMessageCount(c => c + 1);
            setLastMessageTs(Date.now());
            if (payload.markets) {
              setMarketStats((prev) => {
                const next = new Map(prev);
                for (const [ticker, stats] of Object.entries(payload.markets)) {
                  next.set(ticker, stats as MarketStats);
                }
                return next;
              });
              // Track mid history for sparklines
              setMidHistory((prev) => {
                const next = new Map(prev);
                for (const [ticker, stats] of Object.entries(payload.markets)) {
                  const s = stats as MarketStats;
                  if (s.mid !== undefined) {
                    const history = [...(next.get(ticker) || [])];
                    history.push({ ts: Date.now(), mid: s.mid });
                    if (history.length > 60) history.shift();
                    next.set(ticker, history);
                  }
                }
                return next;
              });
            }
            break;

          case "signals":
            if (payload.signals) {
              setSignals(payload.signals);
            }
            if (payload.ladders) {
              setLadders(payload.ladders);
            }
            break;

          case "error":
            setError(payload.message);
            if (payload.requiresAuth) {
              setRequiresAuth(true);
            }
            setStatus("error");
            break;
        }
      } catch (err) {
        console.error("Failed to parse SSE message:", err);
      }
    };

    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        setStatus("disconnected");
      }
    };
  }, [eventTicker, disconnect]);

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  const getMarketWithLiveData = (market: KalshiMarket): KalshiMarket & TickerData => {
    const live = tickerData.get(market.ticker || market.market_ticker || "");
    return { ...market, ...live };
  };

  // Filter markets by selected group
  const filteredMarkets = markets.filter((m) => {
    if (selectedGroup === 'all') return true;
    return m.group_type === selectedGroup;
  });

  // Count markets per group
  const groupCounts = {
    all: markets.length,
    winner: markets.filter((m) => m.group_type === 'winner').length,
    spread: markets.filter((m) => m.group_type === 'spread').length,
    total: markets.filter((m) => m.group_type === 'total').length,
    other: markets.filter((m) => m.group_type === 'other').length,
  };

  const sortedMarkets = [...filteredMarkets].sort((a, b) => {
    const aData = getMarketWithLiveData(a);
    const bData = getMarketWithLiveData(b);

    let aVal: string | number | undefined;
    let bVal: string | number | undefined;

    switch (sortField) {
      case "ticker":
        aVal = aData.ticker;
        bVal = bData.ticker;
        break;
      case "title":
        aVal = aData.title;
        bVal = bData.title;
        break;
      case "last_price":
        aVal = aData.last_price;
        bVal = bData.last_price;
        break;
      case "yes_bid":
        aVal = aData.yes_bid;
        bVal = bData.yes_bid;
        break;
      case "yes_ask":
        aVal = aData.yes_ask;
        bVal = bData.yes_ask;
        break;
      case "volume":
        aVal = aData.volume;
        bVal = bData.volume;
        break;
      case "open_interest":
        aVal = aData.open_interest;
        bVal = bData.open_interest;
        break;
      case "line":
        aVal = aData.line ?? undefined;
        bVal = bData.line ?? undefined;
        break;
      case "side":
        aVal = aData.side;
        bVal = bData.side;
        break;
      case "group_type":
        aVal = aData.group_type;
        bVal = bData.group_type;
        break;
      default:
        aVal = aData.ticker;
        bVal = bData.ticker;
    }

    if (aVal === undefined && bVal === undefined) return 0;
    if (aVal === undefined) return 1;
    if (bVal === undefined) return -1;

    if (typeof aVal === "string" && typeof bVal === "string") {
      return sortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    }

    return sortAsc ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
  });

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  const handleStatsSort = (field: string) => {
    if (statsSortField === field) {
      setStatsSortAsc(!statsSortAsc);
    } else {
      setStatsSortField(field);
      setStatsSortAsc(true);
    }
  };

  const filteredStats = Array.from(marketStats.values()).filter((stats) => {
    if (statsSearch && !stats.market_ticker.toLowerCase().includes(statsSearch.toLowerCase())) {
      return false;
    }
    if (showOnlyFresh && stats.feed_status !== "fresh") {
      return false;
    }
    if (showOnlyJumping && !stats.jump_flag) {
      return false;
    }
    return true;
  });

  const sortedStats = [...filteredStats].sort((a, b) => {
    let aVal: string | number | boolean | undefined;
    let bVal: string | number | boolean | undefined;

    switch (statsSortField) {
      case "market_ticker": aVal = a.market_ticker; bVal = b.market_ticker; break;
      case "mid": aVal = a.mid; bVal = b.mid; break;
      case "spread": aVal = a.spread; bVal = b.spread; break;
      case "spread_bps": aVal = a.spread_bps; bVal = b.spread_bps; break;
      case "microprice": aVal = a.microprice; bVal = b.microprice; break;
      case "imbalance_top": aVal = a.imbalance_top; bVal = b.imbalance_top; break;
      case "book_imbalance_top5": aVal = a.book_imbalance_top5; bVal = b.book_imbalance_top5; break;
      case "trades_per_min": aVal = a.trades_per_min; bVal = b.trades_per_min; break;
      case "vwap_60s": aVal = a.vwap_60s; bVal = b.vwap_60s; break;
      case "vol_mid_60s": aVal = a.vol_mid_60s; bVal = b.vol_mid_60s; break;
      case "feed_status": aVal = a.feed_status; bVal = b.feed_status; break;
      default: aVal = a.market_ticker; bVal = b.market_ticker;
    }

    if (aVal === undefined && bVal === undefined) return 0;
    if (aVal === undefined) return 1;
    if (bVal === undefined) return -1;

    if (typeof aVal === "string" && typeof bVal === "string") {
      return statsSortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    }

    return statsSortAsc ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
  });

  const filteredRawMessages = rawMessages.filter((msg) => {
    const type = msg.data?.type;
    if (type === "ticker" && !filterTicker) return false;
    if ((type === "orderbook_snapshot" || type === "orderbook_delta") && !filterOrderbook) return false;
    if (type === "trade" && !filterTrade) return false;
    return true;
  });

  const statusColors: Record<ConnectionStatus, string> = {
    disconnected: "bg-gray-500",
    resolving: "bg-yellow-500",
    connecting: "bg-yellow-500",
    streaming: "bg-green-500",
    error: "bg-red-500",
  };

  const formatPrice = (price?: number) => {
    if (price === undefined || price === null) return "—";
    return `${price}¢`;
  };

  const formatNumber = (num?: number) => {
    if (num === undefined || num === null) return "—";
    return num.toLocaleString();
  };

  const formatDecimal = (num?: number, decimals = 2) => {
    if (num === undefined || num === null) return "—";
    return num.toFixed(decimals);
  };

  const formatPercent = (num?: number) => {
    if (num === undefined || num === null) return "—";
    return `${(num * 100).toFixed(1)}%`;
  };

  const formatImbalance = (num?: number) => {
    if (num === undefined || num === null) return "—";
    const pct = (num * 100).toFixed(0);
    const color = num > 0.1 ? "text-green-400" : num < -0.1 ? "text-red-400" : "text-gray-400";
    return <span className={color}>{pct}%</span>;
  };

  const formatAge = (ms?: number) => {
    if (ms === undefined || ms === null) return "—";
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  // Computed values for overview cards
  const freshCount = Array.from(marketStats.values()).filter(s => s.feed_status === 'fresh').length;
  const staleCount = Array.from(marketStats.values()).filter(s => s.feed_status === 'stale').length;
  const totalTradesPerMin = Array.from(marketStats.values()).reduce((sum, s) => sum + (s.trades_per_min || 0), 0);
  const signalsFiring = signals.length;
  const msgPerSec = lastMessageTs ? Math.round(messageCount / ((Date.now() - (lastMessageTs - 30000)) / 1000)) : 0;

  // Get stats for selected market
  const selectedStats = selectedMarket ? marketStats.get(selectedMarket) : null;
  const selectedHistory = selectedMarket ? midHistory.get(selectedMarket) || [] : [];

  // Copy signal to clipboard
  const copySignalToClipboard = (signal: SignalItem) => {
    const row = `${new Date(signal.ts).toISOString()}\t${signal.market_ticker}\t${signal.type}\t${signal.confidence}\t${signal.suggested_action}\t${signal.reason}`;
    navigator.clipboard.writeText(row);
  };

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-transparent text-foreground font-sans selection:bg-blue-500/30">
        {/* Top Bar */}
        <header className="sticky top-0 z-50 glass-panel border-b-0 mb-6">
          <div className="max-w-[1800px] mx-auto px-4 py-3">
            <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-500/10 rounded-lg border border-blue-500/20">
                  <BarChart3 className="w-5 h-5 text-blue-400" />
                </div>
                <div>
                  <h1 className="text-lg font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400">
                    Kalshi Edge
                  </h1>
                  <p className="text-[10px] text-gray-500 uppercase tracking-widest font-medium">Market Terminal</p>
                </div>
                <Badge variant="outline" className="text-[10px] ml-2 border-gray-700 text-gray-400 bg-gray-900/50">
                  {process.env.NEXT_PUBLIC_KALSHI_ENV === 'demo' ? 'DEMO ENV' : 'LIVE'}
                </Badge>
              </div>

              <div className="flex flex-1 w-full lg:w-auto items-center gap-3 justify-end">
                <div className="relative w-full max-w-md group">
                  <Input
                    value={eventTicker}
                    onChange={(e) => setEventTicker(e.target.value)}
                    placeholder="Search Event (e.g., kxnflgame-...)"
                    className="w-full bg-gray-900/50 border-gray-800 text-sm focus:border-blue-500/50 transition-all font-mono pl-3"
                    onKeyDown={(e) => e.key === "Enter" && connect(true)}
                  />
                  <div className="absolute right-1 top-1">
                    {status === "disconnected" || status === "error" ? (
                      <Button onClick={() => connect(true)} size="sm" className="h-7 text-xs bg-blue-600 hover:bg-blue-500">
                        Connect
                      </Button>
                    ) : (
                      <Button onClick={disconnect} variant="ghost" size="sm" className="h-7 text-xs text-red-400 hover:text-red-300 hover:bg-red-950/30">
                        Disconnect
                      </Button>
                    )}
                  </div>
                </div>

                {/* Connection Status */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-gray-900/50 border border-gray-800 text-xs">
                      <div className={`w-1.5 h-1.5 rounded-full ${statusColors[status]} ${status === 'streaming' ? 'animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.5)]' : ''}`} />
                      <span className="capitalize text-gray-400 font-medium">{status}</span>
                      {status === 'streaming' && (
                        <span className="text-gray-600 border-l border-gray-800 pl-2 ml-1">
                          {msgPerSec} msg/s
                        </span>
                      )}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{statusMessage}</p>
                    {lastMessageTs && <p className="text-xs text-gray-400 mt-1">Last update: {formatAge(Date.now() - lastMessageTs)}</p>}
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
          </div>
        </header>

        <main className="max-w-[1800px] mx-auto px-4 pb-12 space-y-6">
          {/* Error Banner */}
          {error && (
            <div className="border border-red-500/20 bg-red-950/20 backdrop-blur-sm rounded-lg p-4 animate-in fade-in slide-in-from-top-2">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-red-200 font-medium">{error}</p>
                  {requiresAuth && (
                    <div className="mt-3">
                      <Button onClick={() => connect(true)} size="sm" variant="outline" className="border-red-500/30 hover:bg-red-950/50 text-red-300">
                        Retry with Authentication
                      </Button>
                    </div>
                  )}
                </div>
                <Button variant="ghost" size="icon" onClick={() => setError(null)} className="text-red-400 hover:text-red-300 hover:bg-red-950/30">
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}

          {/* Overview Cards */}
          {status === 'streaming' && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              <Card className="glass-card hover:bg-white/5 transition-colors group">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold group-hover:text-gray-400 transition-colors">Fresh Markets</p>
                      <p className="text-2xl font-bold text-emerald-400 font-mono-nums mt-1">{freshCount}</p>
                    </div>
                    <div className="p-2 rounded-lg bg-emerald-500/10 group-hover:bg-emerald-500/20 transition-colors">
                      <Activity className="w-5 h-5 text-emerald-400" />
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card className="glass-card hover:bg-white/5 transition-colors group">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold group-hover:text-gray-400 transition-colors">Stale</p>
                      <p className={`text-2xl font-bold font-mono-nums mt-1 ${staleCount > 0 ? 'text-amber-400' : 'text-gray-400'}`}>{staleCount}</p>
                    </div>
                    <div className="p-2 rounded-lg bg-amber-500/10 group-hover:bg-amber-500/20 transition-colors">
                      <Clock className="w-5 h-5 text-amber-400" />
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card className="glass-card hover:bg-white/5 transition-colors group">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold group-hover:text-gray-400 transition-colors">Msg / Sec</p>
                      <p className="text-2xl font-bold text-blue-400 font-mono-nums mt-1">{msgPerSec}</p>
                    </div>
                    <div className="p-2 rounded-lg bg-blue-500/10 group-hover:bg-blue-500/20 transition-colors">
                      <Zap className="w-5 h-5 text-blue-400" />
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card className="glass-card hover:bg-white/5 transition-colors group">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold group-hover:text-gray-400 transition-colors">Active Signals</p>
                      <p className="text-2xl font-bold text-purple-400 font-mono-nums mt-1">{signalsFiring}</p>
                    </div>
                    <div className="p-2 rounded-lg bg-purple-500/10 group-hover:bg-purple-500/20 transition-colors">
                      <AlertTriangle className="w-5 h-5 text-purple-400" />
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card className="glass-card hover:bg-white/5 transition-colors group">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold group-hover:text-gray-400 transition-colors">Tickers</p>
                      <p className="text-2xl font-bold text-gray-200 font-mono-nums mt-1">{markets.length}</p>
                    </div>
                    <div className="p-2 rounded-lg bg-gray-800 group-hover:bg-gray-700 transition-colors">
                      <TrendingUp className="w-5 h-5 text-gray-400" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Event Info */}
          {event && (
            <div className="glass-panel rounded-xl p-6 relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 group-hover:bg-blue-500/10 transition-colors duration-700" />
              <div className="relative z-10 flex flex-col md:flex-row md:items-start justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-bold tracking-tight text-white mb-1">{event.title}</h2>
                  {event.subtitle && <p className="text-sm text-gray-400 font-medium">{event.subtitle}</p>}
                  <div className="flex flex-wrap gap-2 mt-4">
                    <Badge variant="outline" className="bg-white/5 hover:bg-white/10 border-white/10 text-xs font-mono text-blue-300">
                      {event.event_ticker}
                    </Badge>
                    {gameId && (
                      <Badge variant="secondary" className="bg-purple-500/10 text-purple-300 hover:bg-purple-500/20 text-xs font-mono">
                        GAME_ID: {gameId}
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 justify-end">
                  {resolvedEvents.length > 1 && resolvedEvents.map((re) => (
                    <div key={re.eventTicker} className="px-3 py-1.5 rounded-lg bg-gray-900/50 border border-gray-800 flex items-center gap-2">
                      <span className="text-[10px] uppercase text-gray-500 font-bold">{re.eventTicker.split('-')[0].replace('KX', '')}</span>
                      <Badge variant="secondary" className="h-5 text-[10px] px-1.5 min-w-[20px] justify-center">{re.marketCount}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Main Tabs */}
          <Tabs value={mainTab} onValueChange={setMainTab} className="w-full space-y-6">
            <TabsList className="w-full justify-start border-b border-white/5 bg-transparent p-0 h-auto gap-6 rounded-none">
              <TabsTrigger
                value="markets"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-blue-500 data-[state=active]:bg-transparent data-[state=active]:text-blue-400 px-0 py-3 text-sm font-medium text-gray-400 hover:text-gray-200 transition-colors gap-2"
              >
                <TrendingUp className="w-4 h-4" /> Markets
              </TabsTrigger>
              <TabsTrigger
                value="signals"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-purple-500 data-[state=active]:bg-transparent data-[state=active]:text-purple-400 px-0 py-3 text-sm font-medium text-gray-400 hover:text-gray-200 transition-colors gap-2"
              >
                <Zap className="w-4 h-4" /> Signal Board
                {signals.length > 0 && (
                  <span className="w-5 h-5 rounded-full bg-purple-500/20 text-purple-400 text-[10px] flex items-center justify-center font-bold">
                    {signals.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger
                value="ladders"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-emerald-500 data-[state=active]:bg-transparent data-[state=active]:text-emerald-400 px-0 py-3 text-sm font-medium text-gray-400 hover:text-gray-200 transition-colors gap-2"
              >
                <BarChart3 className="w-4 h-4" /> Ladder Inspector
              </TabsTrigger>
            </TabsList>

            {/* Markets Tab */}
            <TabsContent value="markets" className="mt-6">
              <div className="flex flex-col xl:flex-row gap-6">
                {/* Markets Table */}
                <Card className="flex-1 glass-panel border-0">
                  <CardHeader className="pb-4 border-b border-white/5">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-base font-semibold text-white">Active Markets</CardTitle>
                        <Badge variant="secondary" className="bg-white/5 text-gray-400 hover:bg-white/10">{sortedMarkets.length}</Badge>
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        <Input
                          value={statsSearch}
                          onChange={(e) => setStatsSearch(e.target.value)}
                          placeholder="Filter markets..."
                          className="w-40 h-8 text-xs bg-black/20 border-white/10 focus:border-blue-500/50"
                        />
                        <div className="flex bg-black/20 rounded-lg p-0.5 border border-white/5">
                          {(['all', 'winner', 'spread', 'total'] as const).map((group) => (
                            <button
                              key={group}
                              onClick={() => setSelectedGroup(group)}
                              className={`px-3 py-1 text-[10px] font-medium rounded-md transition-all ${selectedGroup === group
                                ? 'bg-blue-500 text-white shadow-sm'
                                : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
                                }`}
                            >
                              {group === 'all' ? 'All' : group.charAt(0).toUpperCase() + group.slice(1)}
                            </button>
                          ))}
                        </div>
                        <div className="flex items-center gap-3 px-3 py-1.5 rounded-lg border border-white/5 bg-black/20">
                          <label className="flex items-center gap-2 text-[10px] cursor-pointer text-gray-400 hover:text-gray-200">
                            <input
                              type="checkbox"
                              checked={showOnlyFresh}
                              onChange={(e) => setShowOnlyFresh(e.target.checked)}
                              className="rounded w-3 h-3 bg-white/5 border-white/10 checked:bg-blue-500"
                            />
                            Fresh
                          </label>
                          <div className="w-px h-3 bg-white/10" />
                          <label className="flex items-center gap-2 text-[10px] cursor-pointer text-gray-400 hover:text-gray-200">
                            <input
                              type="checkbox"
                              checked={showSignalsOnly}
                              onChange={(e) => setShowSignalsOnly(e.target.checked)}
                              className="rounded w-3 h-3 bg-white/5 border-white/10 checked:bg-purple-500"
                            />
                            Signals
                          </label>
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    <ScrollArea className="h-[600px]">
                      <table className="w-full text-xs">
                        <thead className="bg-white/5 sticky top-0 z-20 backdrop-blur-md">
                          <tr>
                            <th className="px-4 py-3 text-left text-gray-400 font-medium cursor-pointer hover:text-white transition-colors" onClick={() => handleStatsSort("market_ticker")}>
                              Market {statsSortField === "market_ticker" && (statsSortAsc ? "↑" : "↓")}
                            </th>
                            {(selectedGroup === 'spread' || selectedGroup === 'total') && (
                              <>
                                <th className="px-4 py-3 text-left text-gray-400 font-medium">Line</th>
                                <th className="px-4 py-3 text-left text-gray-400 font-medium">Side</th>
                              </>
                            )}
                            <th className="px-4 py-3 text-right text-gray-400 font-medium cursor-pointer hover:text-white transition-colors" onClick={() => handleStatsSort("mid")}>
                              Price / Prob {statsSortField === "mid" && (statsSortAsc ? "↑" : "↓")}
                            </th>
                            <th className="px-4 py-3 text-right text-gray-400 font-medium">
                              Trend (1m)
                            </th>
                            <th className="px-4 py-3 text-center text-gray-400 font-medium w-[120px]">
                              Depth Pressure
                            </th>
                            <th className="px-4 py-3 text-right text-gray-400 font-medium cursor-pointer hover:text-white transition-colors" onClick={() => handleStatsSort("spread")}>
                              Spread {statsSortField === "spread" && (statsSortAsc ? "↑" : "↓")}
                            </th>
                            <th className="px-4 py-3 text-left text-gray-400 font-medium">Context</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedStats
                            .filter(s => {
                              if (showSignalsOnly && (!s.signals || s.signals.length === 0)) return false;
                              return true;
                            })
                            .map((stats) => {
                              const market = markets.find(m => m.ticker === stats.market_ticker || m.market_ticker === stats.market_ticker);
                              const history = midHistory.get(stats.market_ticker) || [];
                              const delta = stats.price_delta_1m;
                              const deltaColor = delta && delta > 0 ? "text-emerald-400" : delta && delta < 0 ? "text-rose-400" : "text-gray-500";

                              return (
                                <tr
                                  key={stats.market_ticker}
                                  onClick={() => setSelectedMarket(selectedMarket === stats.market_ticker ? null : stats.market_ticker)}
                                  className={`border-b border-white/5 cursor-pointer transition-all ${selectedMarket === stats.market_ticker ? "bg-blue-500/10 border-blue-500/20" :
                                    stats.feed_status === 'stale' ? "opacity-40 hover:bg-white/5" : "hover:bg-white/[0.02]"
                                    }`}
                                >
                                  <td className="px-4 py-3">
                                    <div className="flex flex-col">
                                      <span className="font-medium text-gray-200 truncate max-w-[180px]" title={market?.title || stats.market_ticker}>
                                        {market?.title || stats.market_ticker}
                                      </span>
                                      <span className="text-[10px] text-gray-500 font-mono truncate max-w-[180px]">
                                        {stats.market_ticker.split('-').slice(1).join('-')}
                                      </span>
                                    </div>
                                  </td>

                                  {(selectedGroup === 'spread' || selectedGroup === 'total') && (
                                    <>
                                      <td className="px-4 py-3 font-mono text-amber-400 font-bold">
                                        {market?.line !== null && market?.line !== undefined ? (
                                          market.group_type === 'spread' && market.line >= 0 ? `+${market.line}` : market.line
                                        ) : "—"}
                                      </td>
                                      <td className="px-4 py-3 text-gray-300">{market?.side || "—"}</td>
                                    </>
                                  )}

                                  <td className="px-4 py-3 text-right">
                                    <div className="flex flex-col items-end">
                                      <span className="font-mono-nums text-sm font-bold text-white">{formatPrice(stats.mid)}</span>
                                      <span className="text-[10px] text-gray-500 font-mono-nums">
                                        {stats.implied_prob ? (stats.implied_prob * 100).toFixed(1) + '%' : '—'}
                                      </span>
                                    </div>
                                  </td>

                                  <td className="px-4 py-3 text-right">
                                    <div className="flex flex-col items-end gap-1">
                                      <div className="w-[60px] h-[20px]">
                                        <MiniSparkline data={history} width={60} height={20} />
                                      </div>
                                      <span className={`text-[10px] font-mono-nums ${deltaColor}`}>
                                        {delta ? (delta > 0 ? '+' : '') + delta.toFixed(1) + '¢' : '—'}
                                      </span>
                                    </div>
                                  </td>

                                  <td className="px-4 py-3">
                                    <div className="flex flex-col items-center gap-1">
                                      <DepthBar bidSize={stats.sum_bid_top5 || 0} askSize={stats.sum_ask_top5 || 0} />
                                      <div className="flex justify-between w-full max-w-[80px] text-[9px] font-mono text-gray-500">
                                        <span>{stats.sum_bid_top5 ? (stats.sum_bid_top5 / 1000).toFixed(1) + 'k' : '0'}</span>
                                        <span>{stats.sum_ask_top5 ? (stats.sum_ask_top5 / 1000).toFixed(1) + 'k' : '0'}</span>
                                      </div>
                                    </div>
                                  </td>

                                  <td className="px-4 py-3 text-right">
                                    <div className="flex flex-col items-end">
                                      <span className="font-mono-nums text-gray-300">{formatPrice(stats.spread)}</span>
                                      <span className="text-[10px] text-gray-600 font-mono-nums">{stats.spread_bps ? stats.spread_bps.toFixed(0) : '—'} bps</span>
                                    </div>
                                  </td>

                                  <td className="px-4 py-3">
                                    <div className="flex gap-1 flex-wrap items-center">
                                      {stats.jump_flag && <Badge variant="jump" className="text-[9px] px-1.5 h-4">JUMP</Badge>}
                                      {stats.signals?.includes('STALE_QUOTE') && <Badge variant="stale" className="text-[9px] px-1.5 h-4">STALE</Badge>}
                                      {stats.signals?.includes('MONO_VIOLATION') && <Badge variant="destructive" className="text-[9px] px-1.5 h-4">MONO</Badge>}
                                      {/* Only show generic Status badge if no specific signals or if stale */}
                                      {(!stats.signals || stats.signals.length === 0) && (
                                        <div className={`w-1.5 h-1.5 rounded-full ${stats.feed_status === 'fresh' ? 'bg-emerald-500/50' : 'bg-amber-500/50'}`} />
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </ScrollArea>
                  </CardContent>
                </Card>

                {/* Market Details Panel */}
                {selectedMarket && selectedStats && (
                  <Card className="w-full xl:w-96 shrink-0 glass-panel border-0 animate-in slide-in-from-right-4">
                    <CardHeader className="pb-4 border-b border-white/5">
                      <div className="flex items-center justify-between">
                        <div className="overflow-hidden">
                          <p className="text-[10px] text-blue-400 font-mono mb-1">{selectedMarket}</p>
                          <CardTitle className="text-sm truncate pr-2 text-white">
                            {markets.find(m => m.ticker === selectedMarket || m.market_ticker === selectedMarket)?.title || "Unknown Market"}
                          </CardTitle>
                        </div>
                        <Button variant="ghost" size="icon" onClick={() => setSelectedMarket(null)} className="h-6 w-6 text-gray-400 hover:text-white">
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-6 pt-6">
                      {/* Sparkline Big */}
                      {selectedHistory.length > 1 && (
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-xs text-gray-400">Price Action (60s)</p>
                            <span className="text-xs font-mono text-white">{formatPrice(selectedStats.mid)}</span>
                          </div>
                          <div className="h-32 w-full bg-black/20 rounded-lg p-2 border border-white/5">
                            <ResponsiveContainer width="100%" height="100%">
                              <LineChart data={selectedHistory}>
                                <Line
                                  type="stepAfter"
                                  dataKey="mid"
                                  stroke="#3b82f6"
                                  strokeWidth={2}
                                  dot={false}
                                  activeDot={{ r: 4, fill: '#60a5fa' }}
                                />
                                <XAxis dataKey="ts" hide />
                                <YAxis domain={['auto', 'auto']} hide />
                                <RechartsTooltip
                                  contentStyle={{ background: 'rgba(9,9,11,0.9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: '12px' }}
                                  labelFormatter={(ts) => new Date(ts).toLocaleTimeString()}
                                  formatter={(value) => [`${Number(value).toFixed(1)}¢`, 'Mid']}
                                />
                              </LineChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                      )}

                      {/* Key Stats Grid */}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="glass-card p-3 rounded-lg border-white/5 bg-white/[0.02]">
                          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Best Bid</p>
                          <p className="font-mono text-lg text-emerald-400">{formatPrice(selectedStats.best_bid)}</p>
                          <p className="text-[10px] text-gray-500 font-mono mt-0.5">Size: {selectedStats.bid_size_top}</p>
                        </div>
                        <div className="glass-card p-3 rounded-lg border-white/5 bg-white/[0.02]">
                          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Best Ask</p>
                          <p className="font-mono text-lg text-rose-400">{formatPrice(selectedStats.best_ask)}</p>
                          <p className="text-[10px] text-gray-500 font-mono mt-0.5">Size: {selectedStats.ask_size_top}</p>
                        </div>
                        <div className="glass-card p-3 rounded-lg border-white/5 bg-white/[0.02]">
                          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">VWAP (60s)</p>
                          <p className="font-mono text-lg text-white">{formatPrice(selectedStats.vwap_60s)}</p>
                        </div>
                        <div className="glass-card p-3 rounded-lg border-white/5 bg-white/[0.02]">
                          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Volatility</p>
                          <p className="font-mono text-lg text-blue-300">{formatDecimal(selectedStats.vol_mid_60s, 2)}</p>
                        </div>
                      </div>

                      {/* Health */}
                      <div className="text-xs pt-4 border-t border-white/5">
                        <p className="text-gray-500 mb-2 font-medium">Data Freshness</p>
                        <div className="flex gap-4 font-mono text-gray-400">
                          <span className={selectedStats.last_trade_age_ms && selectedStats.last_trade_age_ms < 1000 ? "text-emerald-400" : ""}>
                            Trd: {formatAge(selectedStats.last_trade_age_ms)}
                          </span>
                          <span className={selectedStats.last_orderbook_age_ms && selectedStats.last_orderbook_age_ms < 500 ? "text-emerald-400" : ""}>
                            Bk: {formatAge(selectedStats.last_orderbook_age_ms)}
                          </span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            </TabsContent>

            {/* Signal Board Tab */}
            <TabsContent value="signals" className="mt-6">
              <Card className="glass-panel border-0">
                <CardHeader className="border-b border-white/5 pb-4">
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2 text-white">
                      <Zap className="w-5 h-5 text-purple-400" />
                      Signal Board
                    </CardTitle>
                    <Badge variant="outline" className="text-xs border-purple-500/30 text-purple-400 bg-purple-500/10">
                      {signals.length} active signals
                    </Badge>
                  </div>
                  <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3 text-yellow-500/50" />
                    For informational purposes only. Not financial advice.
                  </p>
                </CardHeader>
                <CardContent className="pt-6">
                  {signals.length === 0 ? (
                    <div className="text-center py-12 text-gray-500">
                      <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-4">
                        <Zap className="w-8 h-8 opacity-50" />
                      </div>
                      <p className="text-lg font-medium text-gray-400">No signals currently firing</p>
                      <p className="text-xs mt-2 max-w-sm mx-auto">Signals appear when ladder violations, arbitrage opportunities, or statistical outliers are detected.</p>
                    </div>
                  ) : (
                    <ScrollArea className="h-[500px] pr-4">
                      <div className="space-y-3">
                        {signals.map((signal) => (
                          <div key={signal.id} className="p-4 bg-white/5 rounded-xl border border-white/5 hover:border-white/10 transition-all hover:shadow-lg hover:shadow-purple-900/10 group">
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-2">
                                  <Badge variant={
                                    signal.type === 'MONO_VIOLATION' ? 'mono' :
                                      signal.type === 'OUTLIER_LINE' ? 'signal' :
                                        signal.type === 'JUMP' ? 'jump' :
                                          'secondary'
                                  } className="shadow-none">
                                    {signal.type}
                                  </Badge>
                                  <Badge variant={
                                    signal.confidence === 'high' ? 'success' :
                                      signal.confidence === 'medium' ? 'warning' :
                                        'secondary'
                                  } className="shadow-none">
                                    {signal.confidence}
                                  </Badge>
                                  <span className="text-[10px] text-gray-500 font-mono">
                                    {new Date(signal.ts).toLocaleTimeString()}
                                  </span>
                                </div>
                                <p className="text-sm font-mono text-blue-400 mb-1 group-hover:text-blue-300 transition-colors">{signal.market_ticker}</p>
                                <p className="text-sm text-gray-200 font-medium">{signal.suggested_action}</p>
                                <p className="text-xs text-gray-400 mt-1">{signal.reason}</p>
                              </div>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => copySignalToClipboard(signal)}
                                title="Copy to clipboard"
                                className="opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white/10 text-gray-400 hover:text-white"
                              >
                                <Copy className="w-4 h-4" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Ladders Tab */}
            <TabsContent value="ladders" className="mt-6">
              <Card className="glass-panel border-0">
                <CardHeader className="border-b border-white/5 pb-4">
                  <CardTitle className="flex items-center gap-2 text-white">
                    <BarChart3 className="w-5 h-5 text-emerald-400" />
                    Ladder Inspector
                  </CardTitle>
                  <p className="text-xs text-gray-400">
                    Visualizing market structure across strike prices.
                  </p>
                </CardHeader>
                <CardContent className="pt-6">
                  {ladders.length === 0 ? (
                    <div className="text-center py-12 text-gray-500">
                      <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-4">
                        <BarChart3 className="w-8 h-8 opacity-50" />
                      </div>
                      <p className="text-lg font-medium text-gray-400">No ladder data available</p>
                      <p className="text-xs mt-2 max-w-sm mx-auto">Connect to a game with spread/total markets to view ladder analysis.</p>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      {ladders.map((ladder) => (
                        <div key={ladder.ladder_key} className="border border-white/5 bg-white/[0.02] rounded-xl p-5 hover:bg-white/[0.04] transition-colors">
                          {/* Ladder Header */}
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                            <div>
                              <h4 className="font-semibold text-lg text-white font-mono">
                                {ladder.ladder_type === 'spread' ? 'Spread' : 'Total'} <span className="text-gray-500">/</span> {ladder.team_or_direction}
                              </h4>
                              <div className="flex flex-wrap gap-2 mt-2">
                                <Badge variant="outline" className="text-[10px] bg-white/5 border-white/10 text-gray-300">
                                  {ladder.expected_direction === 'nonincreasing' ? 'Hypothesis: ↓ decreasing' : 'Hypothesis: ↑ increasing'}
                                </Badge>
                                <Badge variant="secondary" className="text-[10px] bg-blue-500/10 text-blue-300">
                                  {ladder.points.length} points
                                </Badge>
                                {ladder.diagnostics?.duplicates_dropped > 0 && (
                                  <Badge variant="outline" className="text-[10px] text-yellow-400 border-yellow-500/20 bg-yellow-500/5">
                                    {ladder.diagnostics.duplicates_dropped} dupes
                                  </Badge>
                                )}
                              </div>
                            </div>
                            <div className="flex gap-2">
                              {ladder.mono_violation_count > 0 && (
                                <Badge variant="destructive" className="bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20">
                                  {ladder.mono_violation_count} mono breaks
                                </Badge>
                              )}
                              {ladder.outlier_count > 0 && (
                                <Badge variant="warning" className="bg-amber-500/10 text-amber-400 border-amber-500/20 hover:bg-amber-500/20">
                                  {ladder.outlier_count} outliers
                                </Badge>
                              )}
                              {ladder.mono_violation_count === 0 && ladder.outlier_count === 0 && (
                                <Badge variant="success" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20 px-3">
                                  Clean Structure
                                </Badge>
                              )}
                            </div>
                          </div>

                          {/* Ladder Chart */}
                          <div className="h-64 w-full mb-4 bg-black/20 rounded-lg p-2 border border-white/5 relative">
                            {/* Graph Legend Overlay */}
                            <div className="absolute top-3 right-3 flex flex-col gap-1 text-[9px] text-gray-400 bg-black/40 p-2 rounded backdrop-blur-sm z-10 border border-white/5">
                              <div className="flex items-center gap-1"><div className="w-2 h-0.5 bg-blue-500"></div> Mid Prob (Actual)</div>
                              <div className="flex items-center gap-1"><div className="w-2 h-0.5 bg-emerald-500 border-t border-dashed"></div> Fitted Curve</div>
                              <div className="flex items-center gap-1"><div className="w-2 h-0.5 bg-rose-500 opacity-30"></div> Ask (Red) / Bid (Green)</div>
                              <div className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-red-500"></div> Mono Break</div>
                              <div className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-amber-500"></div> Outlier</div>
                            </div>

                            <ResponsiveContainer width="100%" height="100%">
                              <ComposedChart data={ladder.points} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                <XAxis
                                  dataKey="line"
                                  tick={{ fontSize: 10, fill: '#6b7280' }}
                                  type="number"
                                  domain={['dataMin', 'dataMax']}
                                  tickFormatter={(v) => String(v)}
                                />
                                <YAxis domain={[0, 1]} tick={{ fontSize: 10, fill: '#6b7280' }} tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} />
                                <RechartsTooltip
                                  contentStyle={{ background: 'rgba(9,9,11,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                                  formatter={(value, name) => [
                                    <span className={name === 'mid_prob' ? 'text-blue-400 font-bold' : name === 'ask_prob' ? 'text-rose-400' : name === 'bid_prob' ? 'text-emerald-400' : 'text-gray-400'}>
                                      {(Number(value) * 100).toFixed(1)}%
                                    </span>,
                                    name === 'mid_prob' ? 'Mid' : name === 'fitted_prob' ? 'Fitted' : name === 'ask_prob' ? 'Ask' : 'Bid'
                                  ]}
                                  labelFormatter={(line) => <span className="text-gray-400 font-mono">Line: {line}</span>}
                                />
                                {/* Bid/Ask Bands (Lines) */}
                                <Line type="stepAfter" dataKey="ask_prob" stroke="#f43f5e" strokeWidth={1} strokeOpacity={0.3} dot={false} name="ask_prob" />
                                <Line type="stepAfter" dataKey="bid_prob" stroke="#10b981" strokeWidth={1} strokeOpacity={0.3} dot={false} name="bid_prob" />

                                <Line
                                  type="monotone"
                                  dataKey="mid_prob"
                                  stroke="#3b82f6"
                                  strokeWidth={2}
                                  dot={(props: any) => {
                                    const { cx, cy, payload } = props;
                                    if (payload.is_violation) return <circle cx={cx} cy={cy} r={5} fill="#ef4444" stroke="none" />;
                                    if (payload.is_outlier) return <circle cx={cx} cy={cy} r={5} fill="#f59e0b" stroke="none" />;
                                    return <circle cx={cx} cy={cy} r={3} fill="#3b82f6" stroke="none" />;
                                  }}
                                  activeDot={{ r: 6, fill: '#60a5fa' }}
                                  name="mid_prob"
                                />
                                <Line
                                  type="stepAfter"
                                  dataKey="fitted_prob"
                                  stroke="#10b981"
                                  strokeWidth={2}
                                  strokeDasharray="4 4"
                                  dot={false}
                                  name="fitted_prob"
                                />
                                {/* Overlay violations just in case dot prop doesn't catch all states */}
                              </ComposedChart>
                            </ResponsiveContainer>
                          </div>

                          {/* Points Table */}
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b border-gray-700 bg-gray-800/50">
                                  <th className="text-left py-2 px-2">Line</th>
                                  <th className="text-left py-2 px-1">Mid%</th>
                                  <th className="text-left py-2 px-1">Bid/Ask</th>
                                  <th className="text-left py-2 px-1">Fitted%</th>
                                  <th className="text-left py-2 px-1">Residual</th>
                                  <th className="text-left py-2 px-1">Depth</th>
                                  <th className="text-left py-2 px-1">Flags</th>
                                </tr>
                              </thead>
                              <tbody>
                                {ladder.points.map((pt, idx) => (
                                  <Tooltip key={pt.market_ticker}>
                                    <TooltipTrigger asChild>
                                      <tr className={`border-b border-gray-800 cursor-help ${pt.is_violation || pt.is_outlier ? 'bg-red-900/20' : ''
                                        } ${pt.is_excluded ? 'opacity-40' : ''}`}>
                                        <td className="py-1.5 px-2 font-mono font-medium">{pt.line}</td>
                                        <td className="py-1.5 px-1 font-mono">{(pt.mid_prob * 100).toFixed(1)}%</td>
                                        <td className="py-1.5 px-1 font-mono text-gray-400">
                                          <span className="text-green-400">{(pt.bid_prob * 100).toFixed(0)}</span>
                                          <span className="text-gray-600">/</span>
                                          <span className="text-red-400">{(pt.ask_prob * 100).toFixed(0)}</span>
                                        </td>
                                        <td className="py-1.5 px-1 font-mono text-emerald-400">
                                          {pt.fitted_prob ? (pt.fitted_prob * 100).toFixed(1) + '%' : '—'}
                                        </td>
                                        <td className={`py-1.5 px-1 font-mono ${pt.residual && Math.abs(pt.residual) >= 5 ? 'text-red-400 font-bold' :
                                          pt.residual && Math.abs(pt.residual) >= 3 ? 'text-yellow-400' : 'text-gray-400'
                                          }`}>
                                          {pt.residual ? `${pt.residual > 0 ? '+' : ''}${pt.residual.toFixed(1)}¢` : '—'}
                                        </td>
                                        <td className="py-1.5 px-1 font-mono text-xs">
                                          <span className="text-green-400">{pt.depth_bid ?? 0}</span>
                                          <span className="text-gray-600">/</span>
                                          <span className="text-red-400">{pt.depth_ask ?? 0}</span>
                                        </td>
                                        <td className="py-1.5 px-1">
                                          <div className="flex gap-0.5 flex-wrap">
                                            {pt.is_violation && <Badge variant="destructive" className="text-[9px] px-1">MONO</Badge>}
                                            {pt.is_outlier && <Badge variant="warning" className="text-[9px] px-1">OUTLIER</Badge>}
                                            {pt.parse_source === 'unknown' && <Badge variant="outline" className="text-[9px] px-1 text-orange-400">UNPARSED</Badge>}
                                          </div>
                                        </td>
                                      </tr>
                                    </TooltipTrigger>
                                    <TooltipContent side="left" className="max-w-xs">
                                      <div className="text-xs space-y-1">
                                        <p className="font-mono text-blue-400">{pt.market_ticker}</p>
                                        {pt.title && <p className="text-gray-400">{pt.title}</p>}
                                        <p>Source: {pt.parse_source || 'unknown'}</p>
                                        {pt.is_violation && (
                                          <p className="text-red-400">
                                            Monotonic {ladder.expected_direction} violated vs adjacent line
                                          </p>
                                        )}
                                        {pt.is_outlier && (
                                          <p className="text-yellow-400">
                                            Residual {pt.residual?.toFixed(1)}¢ exceeds threshold (5¢)
                                          </p>
                                        )}
                                        {pt.is_excluded && (
                                          <p className="text-gray-500">Excluded: {pt.exclude_reason}</p>
                                        )}
                                      </div>
                                    </TooltipContent>
                                  </Tooltip>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          {/* Footer */}
          <footer className="text-center text-xs text-gray-500 py-4 border-t border-gray-800 mt-4">
            <p>Read-only viewer • No trading • Not financial advice • Data from Kalshi</p>
          </footer>
        </main>
      </div>
    </TooltipProvider>
  );
}
