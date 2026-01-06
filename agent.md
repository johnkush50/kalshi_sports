# Kalshi Live-Market Viewer - Agent Notes

## Goal
Personal read-only dashboard to view Kalshi live data for a sports EVENT ticker input (e.g., `kxnflgame-26jan04balpit`).

## Local-First Note
This MVP is designed to run on localhost long-term. Vercel deployment is optional and not required.

## Tech Stack
- **Framework**: Next.js (App Router) + TypeScript
- **Styling**: Tailwind CSS
- **Streaming**: Server-Sent Events (SSE) for real-time updates
- **Backend**: Next.js API routes with WebSocket proxy to Kalshi

## Kalshi Documentation Referenced

| Topic | URL |
|-------|-----|
| Quick Start: Market Data (public REST endpoints) | https://docs.kalshi.com/getting_started/quick_start_market_data |
| Quick Start: WebSockets | https://docs.kalshi.com/getting_started/quick_start_websockets |
| WebSocket Connection | https://docs.kalshi.com/websockets/websocket-connection |
| Get Event (with_nested_markets) | https://docs.kalshi.com/api-reference/events/get-event |
| Orderbook Updates | https://docs.kalshi.com/websockets/orderbook-updates |
| Market Ticker | https://docs.kalshi.com/websockets/market-ticker |
| Public Trades | https://docs.kalshi.com/websockets/public-trades |
| API Keys (fallback if WS requires it) | https://docs.kalshi.com/getting_started/api_keys |

## Security Notes
- **Read-only only** - No trading, no order placement
- **No private key in browser** - All sensitive operations happen server-side
- WebSocket connections are proxied through the server

## Environment Variables

```bash
# Required
KALSHI_ENV="prod"  # or "demo" (default: "prod")

# OPTIONAL - Authentication credentials (automatically used when present)
KALSHI_ACCESS_KEY="your-access-key"
KALSHI_PRIVATE_KEY_PEM="-----BEGIN RSA PRIVATE KEY-----\n..."
# OR
KALSHI_PRIVATE_KEY_PATH="/path/to/private-key.pem"
```

## API Endpoints

### REST Base URLs
- **Production**: `https://api.elections.kalshi.com`
- **Demo**: `https://demo-api.kalshi.co`

### WebSocket URLs
- **Production**: `wss://api.elections.kalshi.com/trade-api/ws/v2`
- **Demo**: `wss://demo-api.kalshi.co/trade-api/ws/v2`

## Local Development Commands

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Open browser
# http://localhost:3000
```

## Architecture Overview

```
┌─────────────────┐     SSE      ┌─────────────────┐     WS      ┌─────────────────┐
│                 │ ◄─────────── │                 │ ◄────────── │                 │
│  Browser/React  │              │  Next.js API    │             │  Kalshi API     │
│                 │ ───────────► │  /api/stream    │ ──────────► │  WebSocket      │
└─────────────────┘   Request    └─────────────────┘  Subscribe  └─────────────────┘
```

1. User enters event ticker (e.g., `kxnflgame-26jan04balpit`)
2. Client opens EventSource to `/api/stream?eventTicker=...`
3. Server fetches event details via REST to get market tickers
4. Server opens WebSocket to Kalshi and subscribes to channels
5. Server streams updates to client via SSE
6. On disconnect, server closes WebSocket

## Known Limitations
- WebSocket may require API key authentication (fallback mode available)
- Large events with many markets may be capped for performance
- This is a read-only viewer - no trading capabilities

---

## Live Stats v1

### What Stats Are Computed

Per-market statistics computed in real-time from ticker/orderbook/trade data:

| Category | Stats |
|----------|-------|
| **Price/Spread** | best_bid, best_ask, mid, spread (¢ + bps), implied_prob |
| **Microprice** | microprice, imbalance_top (from top-of-book sizes) |
| **Orderbook Depth** | sum_bid/ask_topN, book_imbalance_topN, wall detection |
| **Trade Flow** | trades_per_min, buy/sell pressure, vwap_60s, last_trade_age |
| **Volatility** | realized_vol_mid_60s, jump_flag |
| **Data Health** | last_update_age, feed_status (fresh/stale), processing_lag |

### Update Frequency

- Stats emitted via SSE every **500ms** (configurable)
- Only markets with changes are included in each update
- Client merges updates by `market_ticker`

### How Stats Are Derived

1. **Price/Spread**: From ticker message `yes_bid`/`yes_ask`, or computed from orderbook best levels
2. **Microprice**: `(ask × bid_size + bid × ask_size) / (bid_size + ask_size)` using top-of-book
3. **Imbalance**: `(bid_size - ask_size) / (bid_size + ask_size)`
4. **Trade Flow**: Rolling window of last 60s trades, VWAP from `yes_price × count`
5. **Volatility**: Stddev of mid price changes over rolling window
6. **Jump Detection**: `|mid_now - mid_5s_ago| >= threshold`

### Performance Notes

- **Ring Buffers**: Trades and mid prices stored in fixed-size ring buffers (max 500 points or 60s)
- **Incremental Updates**: Only affected market's stats recomputed on each message
- **Top-N Levels**: Orderbook depth limited to top 5 levels per side
- **Memory Bounded**: Per-connection state capped; old data evicted automatically
- **Server-Side Computation**: Browser stays light; all stats computed on server

---

## Related Events (Spreads/Totals) v1

### Concept

For a given NFL game, Kalshi uses **multiple series tickers** for different bet types:

| Bet Type | Series Prefix | Example Event Ticker |
|----------|---------------|---------------------|
| Winner (Moneyline) | `kxnflgame` | `kxnflgame-26jan04balpit` |
| Spread | `kxnflspread` | `kxnflspread-26jan04balpit` |
| Total (O/U) | `kxnfltotal` | `kxnfltotal-26jan04balpit` |

All three share the same **gameId** suffix (e.g., `26jan04balpit`), which encodes the date and teams.

### How It Works

1. **Parse Input**: Extract `{seriesPrefix, gameId}` from user input
   - Example: `kxnflgame-26jan04balpit` → `seriesPrefix=kxnflgame`, `gameId=26jan04balpit`

2. **Build Candidate Events**: For NFL, generate all related event tickers:
   - `kxnflgame-{gameId}`
   - `kxnflspread-{gameId}`
   - `kxnfltotal-{gameId}`

3. **Fetch All**: Call REST API for each candidate (skip 404s gracefully)

4. **Union Markets**: Combine all markets from successfully fetched events

5. **Stream All**: Subscribe to all market tickers via WebSocket

### Group Types

Each market is tagged with a `group_type`:

| Group Type | Source Series | Description |
|------------|---------------|-------------|
| `winner` | `kxnflgame` | Moneyline / game winner |
| `spread` | `kxnflspread` | Point spread markets |
| `total` | `kxnfltotal` | Over/Under totals |
| `other` | fallback | Unknown series type |

### Line & Side Parsing

For spread/total markets, we parse the title to extract:

- **Line**: The numeric spread or total (e.g., `-3.5`, `44.5`)
- **Side**: The bet direction (`Over`, `Under`, team name, or `Unknown`)

Parsing rules:
- **Totals**: First float in title = line; "Over"/"Under" in title = side
- **Spreads**: Signed float (e.g., `-3.5`) = line; team name from title = side
- Falls back to `line=null, side="Unknown"` if parse fails

### UI Features

- **Group Tabs**: All | Winner | Spread | Total
- **Additional Columns**: Line, Side (for spread/total views)
- **Sorting**: Winner by volume; Spread/Total by line then volume

### Future: NBA Support

Placeholder mapping (not yet confirmed):
- `kxnbagame-{gameId}` (Winner)
- `kxnbaspread-{gameId}` (Spread)
- `kxnbatotal-{gameId}` (Total)

NBA series tickers will be added once confirmed via API discovery.

### Notes

- **Read-only**: No trading, no order placement
- **Local-first**: Designed for localhost usage
- **Graceful degradation**: Missing events (404) are skipped, not errors

---

## UI/Signals v1

### Goals

1. **Modern Dashboard UX**: Clean hierarchy, less noisy columns, shadcn/ui components
2. **Edge-Grade Signals**: Replace generic stats with actionable trading signals
3. **Charts/Graphs**: Sparklines, spread charts, ladder visualizations
4. **Signal Board**: Aggregated notification panel suggesting candidate positions (read-only)

### ⚠️ Disclaimer

**This tool is for informational purposes only. It does NOT constitute financial advice.**
- No guaranteed profits
- No order placement functionality
- User is solely responsible for any trading decisions
- Always do your own research before trading

### New Stats/Signals (Why They're Better)

#### Removed from Default Table (Still in Details Panel)
| Old Stat | Why Removed |
|----------|-------------|
| μPrice (Microprice) | Noisy; depends on reliable top sizes which flicker |
| ImbTop | Quote flicker makes it unreliable for decisions |

#### Kept (Moved to Details)
| Stat | Why Useful |
|------|------------|
| VWAP | Actual execution price benchmark |
| Imb5 (Book Imbalance Top 5) | More stable than top-1 |
| Vol (Mid Volatility) | Shows price uncertainty |

#### NEW Per-Market Stats
| Stat | Description | Edge Value |
|------|-------------|------------|
| TopDepthBid/Ask | Size at best bid/ask | Shows immediate liquidity |
| Depth5Bid/Ask | Sum of top 5 levels | Shows market depth |
| LiquidityScore | min(Depth5Bid, Depth5Ask) with spread penalty | Quick exitability gauge |
| StalenessScore | Age-based score (ticker/orderbook/trade) | Detect stale quotes |
| JumpScore | |Δmid| over 5s and 30s | Momentum/news detection |
| ExitabilityHint | Estimated slippage to exit position | Risk assessment |

#### NEW Ladder Signals (Spread/Total - The Big Edge)

These detect **arbitrage-free violations** in spread/total markets:

| Signal | What It Detects | Example |
|--------|-----------------|---------|
| **MONO_VIOLATION** | P(>line) should decrease as line increases | P(BAL >+3.5) < P(BAL >+2.5) is wrong |
| **NEG_MASS** | Probability mass in interval should be ≥0 | P(>2.5) - P(>3.5) < 0 is impossible |
| **SUM_GT_1** | Cross-team probabilities exceed 100% | P(BAL >x) + P(PIT >x) > 1 is arb |
| **OUTLIER_LINE** | Single line deviates from fitted curve | Mispriced market vs neighbors |

##### Monotonicity Check Details
- Uses **conservative bounds**: lower = bid/100, upper = ask/100
- Violation exists if: `lower_bound(harder_line) > upper_bound(easier_line) + margin`
- Margin accounts for spread noise (default: 1.5¢)

##### Ladder Fitting
- Isotonic regression to enforce monotonicity
- Residual = actual - fitted
- Flag outliers when |residual| > threshold (4-6¢) AND liquidity adequate

### UI Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ TOP BAR (sticky)                                                │
│ [Title] [Env Badge] [Ticker Input] [Connect] [Connection Status]│
├─────────────────────────────────────────────────────────────────┤
│ OVERVIEW CARDS                                                  │
│ [Active] [Stale] [Msg/s] [Trades/min] [Signals Firing]         │
├─────────────────────────────────────────────────────────────────┤
│ TABS: [Winner] [Spread] [Total] [All] [Signal Board]           │
├────────────────────────────────┬────────────────────────────────┤
│ MARKETS TABLE (compact)        │ MARKET DETAILS PANEL           │
│ - Line, Side, Mid, Spread     │ - Sparkline (mid over time)    │
│ - TopDepth, Trd/m, Staleness  │ - Spread chart                 │
│ - Edge Score / Signal badges  │ - Trades histogram             │
│                                │ - Ladder chart (spread/total)  │
│                                │ - Deep stats + raw feed        │
└────────────────────────────────┴────────────────────────────────┘
```

### Signal Board

Aggregates signals across markets with:
- **Timestamp**: When signal fired
- **Market**: Ticker
- **Type**: MONO_VIOLATION, OUTLIER_LINE, SUM_GT_1, STALE_QUOTE, JUMP
- **Suggested Action**: Read-only suggestion (e.g., "Check buying YES on BAL >+3.5")
- **Confidence**: Low/Med/High based on liquidity, staleness, signal magnitude
- **Reason**: 1-2 line explanation
- **Copy Button**: CSV-like row for Google Sheets

### SSE Payload Extensions

```typescript
// New fields in stats emission
{
  type: 'stats',
  ts: number,
  markets: Record<string, MarketStats>,
  signals: SignalItem[],        // NEW: aggregated signals
  ladders: LadderState[],       // NEW: ladder data for charts
}
```

### Performance Considerations

- Ladder computation only for active game (selected tab)
- Ring buffers bounded (60s / 500 points max)
- Signals batched and deduped before emission
- Incremental updates where possible
- Server-side computation keeps browser light

### Stale/Reconnect UX

- **Stale Badge**: "stale (Xs)" with grayed row
- **Reconnect Toast**: Duration + retry count
- **Health Tooltip**: Last ticker/orderbook/trade update ages

---

## Ladder Inspector Correctness v1

### What is a Ladder?

A **ladder** is a group of related markets that represent the same underlying bet at different strike points (lines). For ladders to produce meaningful signals, they must contain **one series of comparable events** — markets that differ only by their line value.

**Ladder Key (Group Key)**:
Each ladder is uniquely identified by:
```typescript
LadderKey = {
  gameId: string,        // e.g., "26jan04balpit"
  ladderType: "spread" | "total",
  side: string,          // e.g., "Ravens" | "Steelers" | "Over" | "Under"
  predicate: string      // e.g., "wins_by_over" | "total_over" | "total_under"
}
```

**Correct Grouping Examples**:
- BAL spread ladder: all "Ravens win by over X" markets → one ladder
- PIT spread ladder: all "Steelers win by over X" markets → separate ladder
- Over total ladder: all "Total over L" markets → one ladder
- Under total ladder: all "Total under L" markets → separate ladder

**Wrong (causes violations)**: Mixing Ravens and Steelers spreads, or mixing Over and Under totals in the same ladder.

### Expected Monotonic Direction per Ladder Type

| Ladder Type | Predicate | As Line Increases | Expected P(YES) Direction |
|-------------|-----------|-------------------|---------------------------|
| Spread | "Team wins by over X" | Event harder | **Non-increasing** (decreasing) |
| Total Over | "Total over L" | Event harder | **Non-increasing** (decreasing) |
| Total Under | "Total under L" | Event easier | **Non-decreasing** (increasing) |

### Isotonic Regression (PAV Algorithm)

**Purpose**: Fit a monotone curve to noisy probability estimates to detect outliers.

**Pool Adjacent Violators (PAV)**:
1. Start with raw mid probabilities sorted by line
2. For non-increasing constraint:
   - Scan left-to-right; if `y[i+1] > y[i]`, pool them and average
   - Repeat until monotone
3. For non-decreasing constraint:
   - Run PAV on negated values, then negate back, OR scan checking `y[i+1] < y[i]`
4. Clip fitted values to `[0, 1]`

**Residual**: `residual_cents = (midProb - fittedProb) * 100`
- Positive residual = market appears overpriced vs ladder
- Negative residual = market appears underpriced vs ladder

### Signal Gating Rules

To reduce spam, signals must pass **all** gating rules:

| Rule | Threshold | Description |
|------|-----------|-------------|
| **Liquidity** | `min(Depth5Bid, Depth5Ask) >= 2000` OR `volume >= 5000` | Adequate depth to act |
| **Spread** | `spread <= 3¢` | Tight enough to trade |
| **Freshness** | `max_age < 5000ms` | Not stale (debug mode allows stale) |
| **Magnitude (OUTLIER)** | `|residual_cents| >= 5` | Meaningful deviation |
| **Magnitude (MONO)** | `violation_margin >= 3¢` after band comparison | Real violation not spread noise |

### Monotonic Violation Detection (Bounds-Aware)

Use conservative bid/ask bounds to avoid false flags:
- For non-increasing ladder at adjacent points `i < j`:
  - Violation if: `lowerProb(j) > upperProb(i) + epsilon`
  - Where `lowerProb = bid_cents/100`, `upperProb = ask_cents/100`
  - `epsilon = 0.015` (1.5¢ margin)

### Signal Persistence and Deduplication

| Parameter | Value | Description |
|-----------|-------|-------------|
| `PERSIST_MS` | 3000 | Signal must persist this long before posting |
| `COOLDOWN_MS` | 30000 | Don't re-emit same signal within cooldown |
| `TOP_K` | 8 | Max signals displayed on board |

**Ladder-Level Aggregation**: Instead of 10 separate MONO flags, show one card:
> "BAL spread ladder: 3 monotonic breaks (max +7.2¢), 2 outliers"

### Severity Score (Ranking)

```
score = |residual_cents| * log10(1 + minDepth5/1000) - 0.5 * spread_cents
```

Used to rank and select top-K signals.

### Configuration Constants

```typescript
// Signal thresholds (lib/kalshi/ladderConfig.ts)
export const LADDER_CONFIG = {
  // Gating
  MIN_LIQUIDITY_DEPTH: 2000,
  MIN_LIQUIDITY_VOLUME: 5000,
  MAX_SPREAD_CENTS: 3,
  MAX_STALE_MS: 5000,
  
  // Detection
  OUTLIER_MIN_CENTS: 5,
  MONO_MIN_CENTS: 3,
  MONO_EPSILON: 0.015,
  
  // Deduplication
  PERSIST_MS: 3000,
  COOLDOWN_MS: 30000,
  TOP_K: 8,
  
  // Parsing
  UNKNOWN_SIDE_EXCLUDED: true,
};
```

### Team/Side Parsing Priority

1. **Prefer market_ticker suffix** (e.g., `KXNFLSPREAD-26JAN04BALPIT-BAL3` → side=BAL, line=3)
2. **Fallback: title parsing** (e.g., "Baltimore wins by over 3.5" → side=Ravens)
3. **If unparsed**: `side = "Unknown"`, mark with `UNPARSED` badge, exclude from ladder signals by default

### Deduplication within Ladder

If multiple markets map to same `(ladderKey, line)`:
- Keep **primary** with highest `min(Depth5Bid, Depth5Ask)` or highest volume
- Record duplicates in `ladderDiagnostics` for Debug view
- Do not compute violations on duplicated rows
### Cross-Ladder Arbitrage (SUM_GT_1)

True arbitrage exists when the sum of mutually exclusive outcomes exceeds 100%.

1. **Spread Arb**: `P(Home > X) + P(Away > -X) >= 1`
   - Example: Ravens -3.5 (Implied 55%) + Steelers +3.5 (Implied 46%) = 101% -> Risk-free profit.
2. **Total Arb**: `P(Over X) + P(Under X) >= 1`

**Persistence**: Cross-ladder signals share the same 3s persistence / 30s cooldown logic as other signals to prevent flickering.


### Graph Visualization Improvements

To better visualize these opportunities, the graph should display:
- **Bid/Ask Bands**: Shaded region between Bid and Ask probabilities, not just Mid.
  - *Why*: Visualizes the "no-trade zone". If fitted curve is outside this band, it's a strong signal.
- **Violation Highlights**:
  - **Red Segments**: Connect points that violate monotonicity.
  - **Yellow Dots**: Outlier markers.
- **Cross-Ladder Overlay** (Future): Overlay the opposing ladder (inverted) to see arb gaps visually.

### Dynamic Monotonicity Epsilon
Instead of a fixed `1.5¢` margin, use `max(1.5¢, 0.5 * spread)`.
- *Why*: Prevents false flags in wide markets where "violations" are just noise.
