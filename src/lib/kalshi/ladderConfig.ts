/**
 * Ladder Inspector Configuration Constants
 * 
 * All thresholds for signal gating, detection, and deduplication
 * are centralized here for easy tuning.
 */

export const LADDER_CONFIG = {
  // === Gating Thresholds ===
  // Minimum depth on both sides to consider market liquid enough for signals
  MIN_LIQUIDITY_DEPTH: 2000,
  // Alternative: minimum volume if depth is low
  MIN_LIQUIDITY_VOLUME: 5000,
  // Maximum spread (cents) for ladder signals
  MAX_SPREAD_CENTS: 3,
  // Maximum staleness (ms) before excluding from signals
  MAX_STALE_MS: 5000,

  // === Detection Thresholds ===
  // Minimum |residual_cents| to flag as OUTLIER
  OUTLIER_MIN_CENTS: 5,
  // Minimum violation margin (cents) for MONO_VIOLATION
  MONO_MIN_CENTS: 3,
  // Epsilon for band comparison (probability units, 0.015 = 1.5¢)
  MONO_EPSILON: 0.015,

  // === Persistence/Deduplication ===
  // Signal must persist this long (ms) before emitting
  PERSIST_MS: 3000,
  // Cooldown (ms) before re-emitting same signal
  COOLDOWN_MS: 30000,
  // Maximum signals on board
  TOP_K: 8,

  // === Parsing ===
  // Exclude markets with Unknown side from ladder signals
  UNKNOWN_SIDE_EXCLUDED: true,
} as const;

export type LadderConfig = typeof LADDER_CONFIG;

/**
 * Ladder type direction mapping
 * Returns the expected monotonic direction for P(YES) as line increases
 */
export type MonotonicDirection = 'nonincreasing' | 'nondecreasing';

export interface LadderKeyComponents {
  gameId: string;
  ladderType: 'spread' | 'total';
  side: string;
  predicate: string;
}

/**
 * Get expected monotonic direction for a ladder
 * 
 * - Spread "team wins by over X": harder as X increases → P(YES) decreasing
 * - Total Over "total over L": harder as L increases → P(YES) decreasing  
 * - Total Under "total under L": easier as L increases → P(YES) increasing
 */
export function getExpectedDirection(
  ladderType: 'spread' | 'total',
  side: string
): MonotonicDirection {
  if (ladderType === 'spread') {
    // All spreads: higher line = harder = lower probability
    return 'nonincreasing';
  }
  
  if (ladderType === 'total') {
    // Over: higher line = harder = lower probability
    // Under: higher line = easier = higher probability
    if (side.toLowerCase() === 'under') {
      return 'nondecreasing';
    }
    return 'nonincreasing';
  }
  
  // Default to nonincreasing
  return 'nonincreasing';
}

/**
 * Build a canonical ladder key string
 */
export function buildLadderKey(components: LadderKeyComponents): string {
  return `${components.gameId}|${components.ladderType}|${components.side}|${components.predicate}`;
}

/**
 * Parse a ladder key string back into components
 */
export function parseLadderKey(key: string): LadderKeyComponents | null {
  const parts = key.split('|');
  if (parts.length !== 4) return null;
  
  return {
    gameId: parts[0],
    ladderType: parts[1] as 'spread' | 'total',
    side: parts[2],
    predicate: parts[3],
  };
}
