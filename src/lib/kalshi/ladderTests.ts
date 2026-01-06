/**
 * Ladder Inspector Tests / Diagnostics
 * 
 * Run with: npx ts-node src/lib/kalshi/ladderTests.ts
 * Or import and call runLadderTests() in dev mode
 */

import { LADDER_CONFIG, getExpectedDirection, buildLadderKey, parseLadderKey } from './ladderConfig';
import { parseTickerSuffix, parseMarketForLadder } from './marketParsing';

// === Test Utilities ===

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    throw new Error(message);
  }
  console.log(`✅ PASS: ${message}`);
}

function assertApproxEqual(a: number, b: number, epsilon: number, message: string): void {
  if (Math.abs(a - b) > epsilon) {
    console.error(`❌ FAIL: ${message} (got ${a}, expected ${b})`);
    throw new Error(message);
  }
  console.log(`✅ PASS: ${message}`);
}

// === Isotonic Regression Tests ===

/**
 * Standalone PAV implementation for testing
 */
function isotonicRegression(values: number[], direction: 'nonincreasing' | 'nondecreasing'): number[] {
  const n = values.length;
  if (n === 0) return [];
  
  const input = direction === 'nondecreasing' 
    ? values.map(v => -v) 
    : [...values];
  
  const result = [...input];
  const weights = new Array(n).fill(1);
  
  let i = 0;
  while (i < n - 1) {
    if (result[i] < result[i + 1]) {
      const sumW = weights[i] + weights[i + 1];
      const avg = (result[i] * weights[i] + result[i + 1] * weights[i + 1]) / sumW;
      result[i] = avg;
      result[i + 1] = avg;
      weights[i] = sumW;
      weights[i + 1] = sumW;
      
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
  
  for (let j = 1; j < n; j++) {
    if (result[j] > result[j - 1]) {
      result[j] = result[j - 1];
    }
  }
  
  if (direction === 'nondecreasing') {
    return result.map(v => Math.max(0, Math.min(1, -v)));
  }
  
  return result.map(v => Math.max(0, Math.min(1, v)));
}

function testIsotonicNonincreasing(): void {
  console.log('\n=== Testing Isotonic Regression (Non-increasing) ===');
  
  // Test 1: Already monotone
  const input1 = [0.9, 0.7, 0.5, 0.3, 0.1];
  const result1 = isotonicRegression(input1, 'nonincreasing');
  for (let i = 0; i < result1.length - 1; i++) {
    assert(result1[i] >= result1[i + 1], `Already monotone stays monotone at ${i}`);
  }
  
  // Test 2: Violation in middle
  const input2 = [0.8, 0.4, 0.6, 0.3, 0.1]; // 0.6 > 0.4 is violation
  const result2 = isotonicRegression(input2, 'nonincreasing');
  for (let i = 0; i < result2.length - 1; i++) {
    assert(result2[i] >= result2[i + 1], `Fixed violation at ${i}: ${result2[i]} >= ${result2[i + 1]}`);
  }
  // The pooled value should be average of 0.4 and 0.6 = 0.5
  assertApproxEqual(result2[1], result2[2], 0.01, 'Pooled values are equal');
  
  // Test 3: Multiple violations
  const input3 = [0.5, 0.7, 0.3, 0.6, 0.2];
  const result3 = isotonicRegression(input3, 'nonincreasing');
  for (let i = 0; i < result3.length - 1; i++) {
    assert(result3[i] >= result3[i + 1], `Multiple violations fixed at ${i}`);
  }
}

function testIsotonicNondecreasing(): void {
  console.log('\n=== Testing Isotonic Regression (Non-decreasing) ===');
  
  // Test 1: Already monotone
  const input1 = [0.1, 0.3, 0.5, 0.7, 0.9];
  const result1 = isotonicRegression(input1, 'nondecreasing');
  for (let i = 0; i < result1.length - 1; i++) {
    assert(result1[i] <= result1[i + 1], `Already monotone stays monotone at ${i}`);
  }
  
  // Test 2: Violation in middle
  const input2 = [0.2, 0.6, 0.4, 0.7, 0.9]; // 0.4 < 0.6 is violation
  const result2 = isotonicRegression(input2, 'nondecreasing');
  for (let i = 0; i < result2.length - 1; i++) {
    assert(result2[i] <= result2[i + 1], `Fixed violation at ${i}: ${result2[i]} <= ${result2[i + 1]}`);
  }
}

// === Ticker Parsing Tests ===

function testTickerParsing(): void {
  console.log('\n=== Testing Ticker Suffix Parsing ===');
  
  // NFL spread examples
  const test1 = parseTickerSuffix('KXNFLSPREAD-26JAN04BALPIT-BAL3');
  assert(test1.teamAbbrev === 'BAL', 'Parse BAL from ticker');
  assert(test1.line === 3, 'Parse line 3 from ticker');
  
  const test2 = parseTickerSuffix('KXNFLSPREAD-26JAN04BALPIT-PIT7');
  assert(test2.teamAbbrev === 'PIT', 'Parse PIT from ticker');
  assert(test2.line === 7, 'Parse line 7 from ticker');
  
  // Total examples
  const test3 = parseTickerSuffix('KXNFLTOTAL-26JAN04BALPIT-O45');
  assert(test3.teamAbbrev === 'OVER', 'Parse OVER from O45');
  assert(test3.line === 45, 'Parse line 45 from ticker');
  
  const test4 = parseTickerSuffix('KXNFLTOTAL-26JAN04BALPIT-U42');
  assert(test4.teamAbbrev === 'UNDER', 'Parse UNDER from U42');
  assert(test4.line === 42, 'Parse line 42 from ticker');
  
  // Edge cases
  const test5 = parseTickerSuffix('');
  assert(test5.teamAbbrev === null, 'Empty ticker returns null');
  
  const test6 = parseTickerSuffix('KXNFLGAME-26JAN04BALPIT');
  assert(test6.teamAbbrev === null, 'Winner market has no suffix team');
}

function testLadderKeyGeneration(): void {
  console.log('\n=== Testing Ladder Key Generation ===');
  
  const parsed1 = parseMarketForLadder(
    'KXNFLSPREAD-26JAN04BALPIT-BAL3',
    'Ravens win by over 3 points',
    'spread',
    '26jan04balpit'
  );
  assert(parsed1.isParsed, 'Spread market is parsed');
  assert(parsed1.side === 'Ravens', 'Side is Ravens');
  assert(parsed1.ladderKey !== null, 'Ladder key is generated');
  assert(parsed1.ladderKey !== null && parsed1.ladderKey.includes('spread'), 'Ladder key contains spread');
  assert(parsed1.ladderKey !== null && parsed1.ladderKey.includes('Ravens'), 'Ladder key contains Ravens');
  
  const parsed2 = parseMarketForLadder(
    'KXNFLTOTAL-26JAN04BALPIT-O45',
    'Total over 45 points',
    'total',
    '26jan04balpit'
  );
  assert(parsed2.isParsed, 'Total market is parsed');
  assert(parsed2.side === 'Over', 'Side is Over');
  assert(parsed2.ladderComponents !== null && parsed2.ladderComponents.predicate === 'total_over', 'Predicate is total_over');
}

function testMonotonicDirection(): void {
  console.log('\n=== Testing Monotonic Direction ===');
  
  // Spreads should always be non-increasing
  assert(getExpectedDirection('spread', 'Ravens') === 'nonincreasing', 'Spread Ravens is nonincreasing');
  assert(getExpectedDirection('spread', 'Steelers') === 'nonincreasing', 'Spread Steelers is nonincreasing');
  
  // Totals: Over is non-increasing, Under is non-decreasing
  assert(getExpectedDirection('total', 'Over') === 'nonincreasing', 'Total Over is nonincreasing');
  assert(getExpectedDirection('total', 'Under') === 'nondecreasing', 'Total Under is nondecreasing');
}

function testMonoViolationBandComparison(): void {
  console.log('\n=== Testing Monotonic Violation Band Comparison ===');
  
  const epsilon = LADDER_CONFIG.MONO_EPSILON;
  
  // Non-increasing: violation if lower(j) > upper(i) + epsilon
  // Point i: bid=50, ask=55 -> lower=0.50, upper=0.55
  // Point j: bid=52, ask=57 -> lower=0.52, upper=0.57
  // Violation margin = (0.52 - 0.55 - 0.015) * 100 = -4.5 (no violation, margin negative)
  const lowerJ = 0.52;
  const upperI = 0.55;
  const margin1 = (lowerJ - upperI - epsilon) * 100;
  assert(margin1 < 0, `No violation when j.bid < i.ask (margin=${margin1.toFixed(1)})`);
  
  // Point i: bid=50, ask=52 -> upper=0.52
  // Point j: bid=58, ask=62 -> lower=0.58
  // Violation margin = (0.58 - 0.52 - 0.015) * 100 = 4.5 (violation!)
  const lowerJ2 = 0.58;
  const upperI2 = 0.52;
  const margin2 = (lowerJ2 - upperI2 - epsilon) * 100;
  assert(margin2 > LADDER_CONFIG.MONO_MIN_CENTS, `Violation detected when j.bid > i.ask (margin=${margin2.toFixed(1)})`);
}

function testDeduplication(): void {
  console.log('\n=== Testing Deduplication Logic ===');
  
  // Simulating two markets at same line with different liquidity
  const markets = [
    { line: 3, depth: 500, ticker: 'market-a' },
    { line: 3, depth: 2000, ticker: 'market-b' },
    { line: 5, depth: 1000, ticker: 'market-c' },
  ];
  
  // Group by line
  const lineToMarkets = new Map<number, typeof markets>();
  for (const m of markets) {
    if (!lineToMarkets.has(m.line)) {
      lineToMarkets.set(m.line, []);
    }
    lineToMarkets.get(m.line)!.push(m);
  }
  
  // Pick primary (highest depth)
  const primaries: typeof markets = [];
  let dupeCount = 0;
  for (const [, mks] of lineToMarkets) {
    mks.sort((a, b) => b.depth - a.depth);
    primaries.push(mks[0]);
    dupeCount += mks.length - 1;
  }
  
  assert(primaries.length === 2, 'Two unique lines');
  assert(dupeCount === 1, 'One duplicate dropped');
  assert(primaries[0].ticker === 'market-b', 'Higher depth market kept for line 3');
}

// === Run All Tests ===

export function runLadderTests(): boolean {
  console.log('🧪 Running Ladder Inspector Tests...\n');
  
  try {
    testIsotonicNonincreasing();
    testIsotonicNondecreasing();
    testTickerParsing();
    testLadderKeyGeneration();
    testMonotonicDirection();
    testMonoViolationBandComparison();
    testDeduplication();
    
    console.log('\n✅ All tests passed!');
    return true;
  } catch (error) {
    console.error('\n❌ Tests failed:', error);
    return false;
  }
}

// Run if executed directly
if (typeof require !== 'undefined' && require.main === module) {
  runLadderTests();
}
