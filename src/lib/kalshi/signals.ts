import { MarketStats } from './stats';
import { GroupType } from './relatedSeries';
import { LADDER_CONFIG, getExpectedDirection, MonotonicDirection, LadderKeyComponents, buildLadderKey } from './ladderConfig';
import { parseMarketForLadder } from './marketParsing';

export type SignalType =
  | 'MONO_VIOLATION'
  | 'NEG_MASS'
  | 'SUM_GT_1'
  | 'OUTLIER_LINE'
  | 'STALE_QUOTE'
  | 'JUMP'
  | 'LOW_LIQUIDITY'
  | 'WIDE_SPREAD';

export type SignalConfidence = 'low' | 'medium' | 'high';

export interface SignalItem {
  id: string;
  ts: number;
  market_ticker: string;
  type: SignalType;
  confidence: SignalConfidence;
  suggested_action: string;
  reason: string;
  magnitude?: number;
  related_tickers?: string[];
  /** Severity score for ranking */
  severity_score?: number;
  /** Ladder key this signal belongs to */
  ladder_key?: string;
}

export interface LadderPoint {
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

export interface LadderDiagnostics {
  total_markets: number;
  parsed_markets: number;
  unparsed_markets: number;
  duplicates_dropped: number;
  excluded_by_liquidity: number;
  excluded_by_spread: number;
  excluded_by_staleness: number;
}

export interface LadderState {
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

export interface LadderSummarySignal {
  ladder_key: string;
  ladder_type: 'spread' | 'total';
  side: string;
  mono_count: number;
  outlier_count: number;
  max_violation_cents: number;
  severity_score: number;
  details: SignalItem[];
}

export interface EnrichedMarketStats extends MarketStats {
  group_type?: GroupType;
  line?: number | null;
  side?: string;
  liquidity_score?: number;
  staleness_score?: number;
  jump_score_5s?: number;
  jump_score_30s?: number;
  exitability_cents?: number;
  signals?: SignalType[];
  ladder_key?: string;
  parse_source?: 'ticker' | 'title' | 'unknown';
  is_parsed?: boolean;
}

export interface MarketMeta {
  ticker: string;
  title?: string;
  group_type?: GroupType;
  line?: number | null;
  side?: string;
  event_ticker?: string;
  ladder_key?: string;
  parse_source?: 'ticker' | 'title' | 'unknown';
  is_parsed?: boolean;
}

interface PendingSignal {
  signal: SignalItem;
  firstSeenTs: number;
  lastSeenTs: number;
  emittedTs?: number;
}

const WIDE_SPREAD_THRESHOLD_CENTS = 8;
const LOW_LIQUIDITY_THRESHOLD = 50;

export class SignalsEngine {
  private marketMeta: Map<string, MarketMeta> = new Map();
  private ladders: Map<string, LadderState> = new Map();
  private activeSignals: Map<string, SignalItem> = new Map();
  private pendingSignals: Map<string, PendingSignal> = new Map();
  private signalIdCounter = 0;
  private midHistory: Map<string, { ts: number; mid: number }[]> = new Map();
  private gameId: string = '';

  setGameId(gameId: string): void {
    this.gameId = gameId;
  }

  setMarketMeta(markets: MarketMeta[]): void {
    this.marketMeta.clear();
    for (const m of markets) {
      // Re-parse with ladder key generation
      if (m.group_type === 'spread' || m.group_type === 'total') {
        const parsed = parseMarketForLadder(
          m.ticker,
          m.title || '',
          m.group_type,
          this.gameId
        );
        this.marketMeta.set(m.ticker, {
          ...m,
          line: parsed.line,
          side: parsed.side,
          ladder_key: parsed.ladderKey ?? undefined,
          parse_source: parsed.parseSource,
          is_parsed: parsed.isParsed,
        });
      } else {
        this.marketMeta.set(m.ticker, m);
      }
    }
  }

  recordMid(ticker: string, mid: number, ts: number): void {
    let history = this.midHistory.get(ticker);
    if (!history) {
      history = [];
      this.midHistory.set(ticker, history);
    }
    history.push({ ts, mid });
    if (history.length > 100) {
      history.shift();
    }
  }

  computeEnrichedStats(
    baseStats: Record<string, MarketStats>,
    now: number
  ): Record<string, EnrichedMarketStats> {
    const result: Record<string, EnrichedMarketStats> = {};

    for (const [ticker, stats] of Object.entries(baseStats)) {
      const meta = this.marketMeta.get(ticker);
      const enriched: EnrichedMarketStats = {
        ...stats,
        group_type: meta?.group_type,
        line: meta?.line,
        side: meta?.side,
        signals: [],
      };

      enriched.liquidity_score = this.computeLiquidityScore(stats);
      enriched.staleness_score = this.computeStalenessScore(stats, now);

      const jumpScores = this.computeJumpScores(ticker, now);
      enriched.jump_score_5s = jumpScores.jump5s;
      enriched.jump_score_30s = jumpScores.jump30s;

      enriched.exitability_cents = this.computeExitability(stats);

      if (stats.mid !== undefined) {
        this.recordMid(ticker, stats.mid, now);
      }

      const signals: SignalType[] = [];

      if (enriched.staleness_score !== undefined && enriched.staleness_score > 0.7) {
        signals.push('STALE_QUOTE');
      }

      if (stats.jump_flag) {
        signals.push('JUMP');
      }

      if (enriched.liquidity_score !== undefined && enriched.liquidity_score < 0.2) {
        signals.push('LOW_LIQUIDITY');
      }

      if (stats.spread !== undefined && stats.spread >= WIDE_SPREAD_THRESHOLD_CENTS) {
        signals.push('WIDE_SPREAD');
      }

      enriched.signals = signals;
      result[ticker] = enriched;
    }

    return result;
  }

  private computeLiquidityScore(stats: MarketStats): number {
    const bidDepth = stats.sum_bid_top5 ?? 0;
    const askDepth = stats.sum_ask_top5 ?? 0;
    const minDepth = Math.min(bidDepth, askDepth);

    let score = Math.min(minDepth / 500, 1);

    if (stats.spread !== undefined && stats.spread > 0) {
      const spreadPenalty = Math.min(stats.spread / 20, 0.5);
      score = score * (1 - spreadPenalty);
    }

    return Math.max(0, Math.min(1, score));
  }

  private computeStalenessScore(stats: MarketStats, now: number): number {
    const ages = [
      stats.last_ticker_age_ms,
      stats.last_orderbook_age_ms,
      stats.last_trade_age_ms,
    ].filter((a): a is number => a !== undefined);

    if (ages.length === 0) return 1;

    const maxAge = Math.max(...ages);
    return Math.min(maxAge / 10000, 1);
  }

  private computeJumpScores(ticker: string, now: number): { jump5s: number; jump30s: number } {
    const history = this.midHistory.get(ticker);
    if (!history || history.length < 2) {
      return { jump5s: 0, jump30s: 0 };
    }

    const currentMid = history[history.length - 1].mid;
    let jump5s = 0;
    let jump30s = 0;

    for (let i = history.length - 1; i >= 0; i--) {
      const entry = history[i];
      const age = now - entry.ts;

      if (age >= 5000 && jump5s === 0) {
        jump5s = Math.abs(currentMid - entry.mid);
      }
      if (age >= 30000 && jump30s === 0) {
        jump30s = Math.abs(currentMid - entry.mid);
        break;
      }
    }

    return { jump5s, jump30s };
  }

  private computeExitability(stats: MarketStats): number {
    const bidSize = stats.bid_size_top ?? 0;
    const askSize = stats.ask_size_top ?? 0;
    const spread = stats.spread ?? 0;

    if (bidSize === 0 && askSize === 0) return 99;

    const avgTopSize = (bidSize + askSize) / 2;
    const slippage = spread / 2 + (100 / Math.max(avgTopSize, 1));

    return Math.min(slippage, 50);
  }

  computeLadders(
    enrichedStats: Record<string, EnrichedMarketStats>,
    gameId: string,
    now: number
  ): LadderState[] {
    // Group markets by ladder_key
    const ladderGroups = new Map<string, EnrichedMarketStats[]>();
    let unparsedCount = 0;

    for (const stats of Object.values(enrichedStats)) {
      if (stats.group_type !== 'spread' && stats.group_type !== 'total') continue;
      if (stats.line === null || stats.line === undefined) continue;

      const meta = this.marketMeta.get(stats.market_ticker);
      const ladderKey = meta?.ladder_key || stats.ladder_key;

      if (!ladderKey) {
        unparsedCount++;
        continue;
      }

      // Skip Unknown sides if configured
      if (LADDER_CONFIG.UNKNOWN_SIDE_EXCLUDED && (stats.side === 'Unknown' || !stats.side)) {
        unparsedCount++;
        continue;
      }

      if (!ladderGroups.has(ladderKey)) {
        ladderGroups.set(ladderKey, []);
      }
      ladderGroups.get(ladderKey)!.push(stats);
    }

    const ladders: LadderState[] = [];

    for (const [ladderKey, markets] of ladderGroups) {
      if (markets.length < 2) continue;

      // Determine ladder type and side from first market
      const firstMeta = this.marketMeta.get(markets[0].market_ticker);
      const ladderType = markets[0].group_type as 'spread' | 'total';
      const side = firstMeta?.side || markets[0].side || 'Unknown';

      const ladder = this.buildLadder(markets, gameId, ladderType, side, ladderKey, now);
      ladders.push(ladder);
      this.ladders.set(ladder.ladder_key, ladder);
    }

    // Detect cross-ladder arbitrage
    const arbSignals = this.detectCrossLadderArb(ladders, now);
    for (const signal of arbSignals) {
      const emittedSignals: SignalItem[] = [];
      this.handleSignalPersistence(signal, emittedSignals, now);

      // Only push to ladder if persistence check passed and signal was emitted
      if (emittedSignals.length > 0) {
        const ladder = this.ladders.get(signal.ladder_key || '');
        if (ladder) {
          ladder.violations.push(emittedSignals[0]);
        }
      }
    }

    return ladders;
  }

  private buildLadder(
    markets: EnrichedMarketStats[],
    gameId: string,
    ladderType: 'spread' | 'total',
    teamOrDirection: string,
    ladderKey: string,
    now: number
  ): LadderState {
    const expectedDirection = getExpectedDirection(ladderType, teamOrDirection);

    const diagnostics: LadderDiagnostics = {
      total_markets: markets.length,
      parsed_markets: 0,
      unparsed_markets: 0,
      duplicates_dropped: 0,
      excluded_by_liquidity: 0,
      excluded_by_spread: 0,
      excluded_by_staleness: 0,
    };

    // Build initial points with all data
    const rawPoints: LadderPoint[] = markets
      .filter(m => m.line !== null && m.line !== undefined)
      .map(m => {
        const meta = this.marketMeta.get(m.market_ticker);
        const minDepth = Math.min(m.sum_bid_top5 ?? 0, m.sum_ask_top5 ?? 0);
        const spread = m.spread ?? 100;
        const maxAge = Math.max(
          m.last_ticker_age_ms ?? 0,
          m.last_orderbook_age_ms ?? 0
        );

        let isExcluded = false;
        let excludeReason: string | undefined;

        // Check gating thresholds
        if (minDepth < LADDER_CONFIG.MIN_LIQUIDITY_DEPTH && (m.volume ?? 0) < LADDER_CONFIG.MIN_LIQUIDITY_VOLUME) {
          isExcluded = true;
          excludeReason = 'low_liquidity';
          diagnostics.excluded_by_liquidity++;
        } else if (spread > LADDER_CONFIG.MAX_SPREAD_CENTS) {
          isExcluded = true;
          excludeReason = 'wide_spread';
          diagnostics.excluded_by_spread++;
        } else if (maxAge > LADDER_CONFIG.MAX_STALE_MS) {
          isExcluded = true;
          excludeReason = 'stale';
          diagnostics.excluded_by_staleness++;
        }

        if (meta?.is_parsed) {
          diagnostics.parsed_markets++;
        } else {
          diagnostics.unparsed_markets++;
        }

        return {
          line: m.line!,
          side: m.side ?? 'Unknown',
          market_ticker: m.market_ticker,
          title: meta?.title,
          mid: m.mid,
          bid: m.best_bid,
          ask: m.best_ask,
          bid_prob: (m.best_bid ?? 0) / 100,
          ask_prob: (m.best_ask ?? 100) / 100,
          mid_prob: (m.mid ?? 50) / 100,
          depth_bid: m.sum_bid_top5,
          depth_ask: m.sum_ask_top5,
          volume: m.volume,
          spread_cents: spread,
          parse_source: meta?.parse_source,
          is_excluded: isExcluded,
          exclude_reason: excludeReason,
          is_primary: true,
        };
      })
      .sort((a, b) => a.line - b.line);

    // Dedupe by line - keep highest liquidity
    const lineToPoints = new Map<number, LadderPoint[]>();
    for (const pt of rawPoints) {
      if (!lineToPoints.has(pt.line)) {
        lineToPoints.set(pt.line, []);
      }
      lineToPoints.get(pt.line)!.push(pt);
    }

    const points: LadderPoint[] = [];
    for (const [line, pts] of lineToPoints) {
      if (pts.length > 1) {
        // Sort by liquidity (min depth), take best
        pts.sort((a, b) => {
          const aLiq = Math.min(a.depth_bid ?? 0, a.depth_ask ?? 0);
          const bLiq = Math.min(b.depth_bid ?? 0, b.depth_ask ?? 0);
          return bLiq - aLiq;
        });
        diagnostics.duplicates_dropped += pts.length - 1;
        pts[0].is_primary = true;
        for (let i = 1; i < pts.length; i++) {
          pts[i].is_primary = false;
        }
      }
      // Only include primary, non-excluded points in analysis
      const primary = pts[0];
      if (primary.is_primary && !primary.is_excluded) {
        points.push(primary);
      }
    }

    // Sort again after deduplication
    points.sort((a, b) => a.line - b.line);

    const violations: SignalItem[] = [];
    let monoCount = 0;
    let outlierCount = 0;
    let maxViolationCents = 0;

    // Check monotonicity with direction
    const monoResult = this.checkMonotonicity(points, violations, ladderKey, expectedDirection, now);
    monoCount = monoResult.count;
    maxViolationCents = Math.max(maxViolationCents, monoResult.maxCents);

    // Fit and detect outliers with direction
    const outlierResult = this.fitAndDetectOutliers(points, violations, ladderKey, expectedDirection, now);
    outlierCount = outlierResult.count;
    maxViolationCents = Math.max(maxViolationCents, outlierResult.maxCents);

    return {
      ladder_key: ladderKey,
      game_id: gameId,
      ladder_type: ladderType,
      team_or_direction: teamOrDirection,
      expected_direction: expectedDirection,
      points,
      violations,
      diagnostics,
      mono_violation_count: monoCount,
      outlier_count: outlierCount,
      max_violation_cents: maxViolationCents,
      last_updated: now,
    };
  }

  /**
   * Detect cross-ladder arbitrage opportunities (e.g. Spread vs Spread, Over vs Under)
   * Condition: P(A) + P(B) > 1 (implied probability > 100%)
   */
  detectCrossLadderArb(ladders: LadderState[], now: number): SignalItem[] {
    const arbSignals: SignalItem[] = [];
    const processedPairs = new Set<string>();

    for (let i = 0; i < ladders.length; i++) {
      for (let j = i + 1; j < ladders.length; j++) {
        const l1 = ladders[i];
        const l2 = ladders[j];

        // Must be same ladder type
        if (l1.ladder_type !== l2.ladder_type) continue;

        // Spread Arb: Team A vs Team B (Opposing sides)
        // Total Arb: Over vs Under
        const isOpposing =
          (l1.ladder_type === 'total' && ((l1.team_or_direction === 'Over' && l2.team_or_direction === 'Under') || (l1.team_or_direction === 'Under' && l2.team_or_direction === 'Over'))) ||
          (l1.ladder_type === 'spread' && l1.team_or_direction !== l2.team_or_direction);

        if (!isOpposing) continue;

        // Check for line overlaps
        // For Spreads: Team A at Line X vs Team B at Line -X
        // For Totals: Over X vs Under X

        for (const p1 of l1.points) {
          // Find matching point in p2
          const targetLine = l1.ladder_type === 'spread' ? -p1.line : p1.line;
          const p2 = l2.points.find(p => Math.abs(p.line - targetLine) < 0.01); // Float tolerance check

          if (p2) {
            // Check Sum > 1
            // Use Bid probabilities (sell to market A, sell to market B? No, you wrap via YES)
            // To Arb: Buy YES on A (cost p1.ask), Buy YES on B (cost p2.ask). 
            // If p1.ask + p2.ask < 100 cents (1.00), you risk-free profit? 
            // Wait, Arb is usually: Market implies > 100%. 
            // Buying YES on both means you win on A OR B? No, mutually exclusive.
            // If outcomes are exhaustive (one MUST happen), then P(A) + P(B) = 1.
            // If P(A, ask) + P(B, ask) < 1, you buy both for < $1 and get returned $1.

            // Wait, the signal says SUM_GT_1. 
            // "P(Home > X) + P(Away > -X) >= 1" -> This means Market is pricing it > 100%. 
            // This is "Sum of Probabilities > 1". It usually means markets are inefficiently high? 
            // Or does it mean Neg Mass? 

            // Actually, for ARBITRAGE (profit), we want Ask + Ask < 1.
            // If Bids sum > 1: Sell YES on A (receive p1.bid), Sell YES on B (receive p2.bid).
            // Total received > $1. Payout is exactly $1 (since exhaustive). Profit!

            // Let's implement BOTH "Sum > 1 on Bids" (Profit Arb) and "Sum < 1 on Asks" (Profit Arb? No, Buying both).

            const sumBids = p1.bid_prob + p2.bid_prob;

            if (sumBids > 1.01) { // 1% buffer
              const profitCents = (sumBids - 1) * 100;
              const signal: SignalItem = {
                id: `arb-${++this.signalIdCounter}`,
                ts: now,
                market_ticker: p1.market_ticker,
                type: 'SUM_GT_1',
                confidence: 'high',
                suggested_action: `Arb: Sell YES on ${l1.team_or_direction} ${p1.line} & ${l2.team_or_direction} ${p2.line}`,
                reason: `Cross-ladder sum > 100% (Profit: +${profitCents.toFixed(1)}¢)`,
                magnitude: profitCents,
                related_tickers: [p1.market_ticker, p2.market_ticker],
                severity_score: profitCents * 10, // High priority
                ladder_key: l1.ladder_key,
              }
              arbSignals.push(signal);
            }
          }
        }
      }
    }
    return arbSignals;
  }

  private checkMonotonicity(
    points: LadderPoint[],
    violations: SignalItem[],
    ladderKey: string,
    direction: MonotonicDirection,
    now: number
  ): { count: number; maxCents: number } {
    let count = 0;
    let maxCents = 0;

    for (let i = 0; i < points.length - 1; i++) {
      const ptI = points[i];
      const ptJ = points[i + 1];

      let violationMargin = 0;

      // Dynamic Epsilon: Half of the average spread width, but at least config minimum
      const avgSpread = ((ptI.spread_cents || 0) + (ptJ.spread_cents || 0)) / 2;
      const dynamicEpsilon = Math.max(LADDER_CONFIG.MONO_EPSILON, (avgSpread / 100) * 0.5);

      if (direction === 'nonincreasing') {
        // P(YES) should decrease as line increases
        // Violation if lower(j) > upper(i) + epsilon
        const lowerJ = ptJ.bid_prob;
        const upperI = ptI.ask_prob;
        violationMargin = (lowerJ - upperI - dynamicEpsilon) * 100;
      } else {
        // nondecreasing: P(YES) should increase as line increases
        // Violation if upper(j) < lower(i) - epsilon
        const upperJ = ptJ.ask_prob;
        const lowerI = ptI.bid_prob;
        violationMargin = (lowerI - upperJ - dynamicEpsilon) * 100;
      }

      if (violationMargin >= LADDER_CONFIG.MONO_MIN_CENTS) {
        ptI.is_violation = true;
        ptJ.is_violation = true;
        count++;
        maxCents = Math.max(maxCents, violationMargin);

        const severityScore = this.computeSeverityScore(violationMargin, ptI, ptJ);

        const signal: SignalItem = {
          id: `signal-${++this.signalIdCounter}`,
          ts: now,
          market_ticker: ptJ.market_ticker,
          type: 'MONO_VIOLATION',
          confidence: this.assessConfidence(ptI, ptJ),
          suggested_action: `Check: line ${ptJ.line} vs ${ptI.line} - possible ${direction === 'nonincreasing' ? 'underpriced' : 'overpriced'}`,
          reason: `Monotonic ${direction} violated by ${violationMargin.toFixed(1)}¢ (bid/ask bands)`,
          magnitude: violationMargin,
          related_tickers: [ptI.market_ticker, ptJ.market_ticker],
          severity_score: severityScore,
          ladder_key: ladderKey,
        };

        // Apply persistence check
        this.handleSignalPersistence(signal, violations, now);
      }
    }

    return { count, maxCents };
  }

  private fitAndDetectOutliers(
    points: LadderPoint[],
    violations: SignalItem[],
    ladderKey: string,
    direction: MonotonicDirection,
    now: number
  ): { count: number; maxCents: number } {
    if (points.length < 3) return { count: 0, maxCents: 0 };

    const midProbs = points.map(p => p.mid_prob);
    const fitted = this.isotonicRegression(midProbs, direction);

    let count = 0;
    let maxCents = 0;

    for (let i = 0; i < points.length; i++) {
      points[i].fitted_prob = fitted[i];
      points[i].residual = (points[i].mid_prob - fitted[i]) * 100;

      const residualCents = Math.abs(points[i].residual!);
      const minDepth = Math.min(points[i].depth_bid ?? 0, points[i].depth_ask ?? 0);
      const hasLiquidity = minDepth >= LADDER_CONFIG.MIN_LIQUIDITY_DEPTH || (points[i].volume ?? 0) >= LADDER_CONFIG.MIN_LIQUIDITY_VOLUME;
      const tightSpread = (points[i].spread_cents ?? 100) <= LADDER_CONFIG.MAX_SPREAD_CENTS;

      if (residualCents >= LADDER_CONFIG.OUTLIER_MIN_CENTS && hasLiquidity && tightSpread) {
        points[i].is_outlier = true;
        count++;
        maxCents = Math.max(maxCents, residualCents);

        const dir = points[i].residual! > 0 ? 'high' : 'low';
        const severityScore = this.computeSeverityScore(residualCents, points[i], points[i]);

        const signal: SignalItem = {
          id: `signal-${++this.signalIdCounter}`,
          ts: now,
          market_ticker: points[i].market_ticker,
          type: 'OUTLIER_LINE',
          confidence: residualCents >= 8 ? 'high' : residualCents >= 6 ? 'medium' : 'low',
          suggested_action: `Check: market looks ${dir} vs fitted ladder (${points[i].residual! > 0 ? '+' : ''}${points[i].residual!.toFixed(1)}¢)`,
          reason: `Line ${points[i].line} deviates ${residualCents.toFixed(1)}¢ from monotone fit`,
          magnitude: residualCents,
          severity_score: severityScore,
          ladder_key: ladderKey,
        };

        // Apply persistence check
        this.handleSignalPersistence(signal, violations, now);
      }
    }

    return { count, maxCents };
  }

  /**
   * Pool Adjacent Violators (PAV) algorithm for isotonic regression
   * Supports both non-increasing and non-decreasing constraints
   */
  private isotonicRegression(values: number[], direction: MonotonicDirection): number[] {
    const n = values.length;
    if (n === 0) return [];

    // For non-decreasing, we can negate, run non-increasing PAV, then negate back
    const input = direction === 'nondecreasing'
      ? values.map(v => -v)
      : [...values];

    // PAV for non-increasing
    const result = [...input];
    const weights = new Array(n).fill(1);

    let i = 0;
    while (i < n - 1) {
      if (result[i] < result[i + 1]) {
        // Violation: pool i and i+1
        const sumW = weights[i] + weights[i + 1];
        const avg = (result[i] * weights[i] + result[i + 1] * weights[i + 1]) / sumW;
        result[i] = avg;
        result[i + 1] = avg;
        weights[i] = sumW;
        weights[i + 1] = sumW;

        // Check backwards for new violations
        while (i > 0 && result[i - 1] < result[i]) {
          const sw = weights[i - 1] + weights[i];
          const av = (result[i - 1] * weights[i - 1] + result[i] * weights[i]) / sw;
          result[i - 1] = av;
          result[i] = av;
          weights[i - 1] = sw;
          weights[i] = sw;
          i--;
        }
      }
      i++;
    }

    // Propagate pooled values
    for (let j = 1; j < n; j++) {
      if (result[j] > result[j - 1]) {
        result[j] = result[j - 1];
      }
    }

    // For non-decreasing, negate back and clip to [0, 1]
    if (direction === 'nondecreasing') {
      return result.map(v => Math.max(0, Math.min(1, -v)));
    }

    // Clip to [0, 1]
    return result.map(v => Math.max(0, Math.min(1, v)));
  }

  /**
   * Handle signal persistence - only emit after PERSIST_MS, respect cooldown
   */
  private handleSignalPersistence(signal: SignalItem, violations: SignalItem[], now: number): void {
    // Create a canonical key for this signal type + market
    const persistKey = `${signal.type}:${signal.market_ticker}:${signal.ladder_key || ''}`;

    const pending = this.pendingSignals.get(persistKey);

    if (!pending) {
      // First time seeing this signal
      this.pendingSignals.set(persistKey, {
        signal,
        firstSeenTs: now,
        lastSeenTs: now,
      });
      return;
    }

    // Update last seen
    pending.lastSeenTs = now;
    pending.signal = signal; // Update with latest data

    const persistedDuration = now - pending.firstSeenTs;
    const sinceLastEmit = pending.emittedTs ? now - pending.emittedTs : Infinity;

    if (persistedDuration >= LADDER_CONFIG.PERSIST_MS && sinceLastEmit >= LADDER_CONFIG.COOLDOWN_MS) {
      // Emit the signal
      violations.push(signal);
      this.activeSignals.set(signal.id, signal);
      pending.emittedTs = now;
    }
  }

  /**
   * Compute severity score for ranking signals
   */
  private computeSeverityScore(magnitudeCents: number, pt1: LadderPoint, pt2: LadderPoint): number {
    const minDepth = Math.min(
      Math.min(pt1.depth_bid ?? 0, pt1.depth_ask ?? 0),
      Math.min(pt2.depth_bid ?? 0, pt2.depth_ask ?? 0)
    );
    const avgSpread = ((pt1.spread_cents ?? 10) + (pt2.spread_cents ?? 10)) / 2;

    // score = magnitude * log10(1 + depth/1000) - 0.5 * spread
    const depthFactor = Math.log10(1 + minDepth / 1000);
    return magnitudeCents * depthFactor - 0.5 * avgSpread;
  }

  /**
   * Clean up stale pending signals
   */
  private cleanPendingSignals(now: number): void {
    for (const [key, pending] of this.pendingSignals) {
      // Remove if not seen in last 2 seconds
      if (now - pending.lastSeenTs > 2000) {
        this.pendingSignals.delete(key);
      }
    }
  }

  private assessConfidence(easier: LadderPoint, harder: LadderPoint): SignalConfidence {
    const minDepth = Math.min(
      easier.depth_bid ?? 0,
      easier.depth_ask ?? 0,
      harder.depth_bid ?? 0,
      harder.depth_ask ?? 0
    );

    if (minDepth < 20) return 'low';
    if (minDepth < 100) return 'medium';
    return 'high';
  }

  getActiveSignals(): SignalItem[] {
    // Get all active signals, sort by severity, return top K
    const signals = Array.from(this.activeSignals.values())
      .sort((a, b) => (b.severity_score ?? 0) - (a.severity_score ?? 0))
      .slice(0, LADDER_CONFIG.TOP_K);

    return signals;
  }

  /**
   * Get aggregated ladder-level signals for cleaner display
   */
  getLadderSummaries(): LadderSummarySignal[] {
    const summaries: LadderSummarySignal[] = [];

    for (const ladder of this.ladders.values()) {
      if (ladder.mono_violation_count === 0 && ladder.outlier_count === 0) continue;

      const details = ladder.violations.slice(0, 5); // Max 5 details per ladder
      const avgSeverity = details.length > 0
        ? details.reduce((sum, s) => sum + (s.severity_score ?? 0), 0) / details.length
        : 0;

      summaries.push({
        ladder_key: ladder.ladder_key,
        ladder_type: ladder.ladder_type,
        side: ladder.team_or_direction,
        mono_count: ladder.mono_violation_count,
        outlier_count: ladder.outlier_count,
        max_violation_cents: ladder.max_violation_cents,
        severity_score: avgSeverity,
        details,
      });
    }

    return summaries
      .sort((a, b) => b.severity_score - a.severity_score)
      .slice(0, LADDER_CONFIG.TOP_K);
  }

  clearOldSignals(maxAgeMs: number = 60000): void {
    const now = Date.now();
    for (const [id, signal] of this.activeSignals) {
      if (now - signal.ts > maxAgeMs) {
        this.activeSignals.delete(id);
      }
    }
    this.cleanPendingSignals(now);
  }

  getLadders(): LadderState[] {
    return Array.from(this.ladders.values());
  }

  /**
   * Get diagnostics for debug view
   */
  getDiagnostics(): { ladders: Map<string, LadderDiagnostics>; unparsedMarkets: string[] } {
    const ladderDiags = new Map<string, LadderDiagnostics>();
    for (const ladder of this.ladders.values()) {
      ladderDiags.set(ladder.ladder_key, ladder.diagnostics);
    }

    const unparsed: string[] = [];
    for (const [ticker, meta] of this.marketMeta) {
      if (!meta.is_parsed && (meta.group_type === 'spread' || meta.group_type === 'total')) {
        unparsed.push(ticker);
      }
    }

    return { ladders: ladderDiags, unparsedMarkets: unparsed };
  }
}
