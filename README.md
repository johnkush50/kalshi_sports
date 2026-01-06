# Kalshi Live Market Viewer

A read-only dashboard for viewing Kalshi live market data for sports events.

## Features

- **Event Ticker Input**: Enter a Kalshi event ticker (e.g., `kxnflgame-26jan04balpit`)
- **Live Streaming**: Real-time market data via WebSocket → SSE proxy
- **Markets Table**: Sortable table with live prices, volume, and open interest
- **Raw Feed**: Filterable message feed showing ticker, orderbook, and trade updates
- **Auth Fallback**: Optional API key authentication if WebSocket requires it

## Quick Start

```bash
# Install dependencies
npm install

# Run development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Environment Variables

Create a `.env.local` file (optional):

```bash
# Environment: "prod" or "demo" (default: "prod")
KALSHI_ENV=prod

# OPTIONAL: Only needed if WebSocket requires authentication
KALSHI_ACCESS_KEY=your-access-key
KALSHI_PRIVATE_KEY_PEM="-----BEGIN RSA PRIVATE KEY-----\n..."
# OR
KALSHI_PRIVATE_KEY_PATH=/path/to/private-key.pem
```

## Architecture

```
Browser (React) ←── SSE ──→ Next.js API ←── WebSocket ──→ Kalshi API
```

1. User enters event ticker and clicks Connect
2. Server fetches event details via REST API to get market tickers
3. Server opens WebSocket to Kalshi and subscribes to channels
4. Server streams updates to browser via Server-Sent Events (SSE)
5. UI displays live market data in real-time

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/stream?eventTicker=...` | SSE stream for live market data |

## Kalshi Documentation

- [Quick Start: Market Data](https://docs.kalshi.com/getting_started/quick_start_market_data)
- [Quick Start: WebSockets](https://docs.kalshi.com/getting_started/quick_start_websockets)
- [WebSocket Connection](https://docs.kalshi.com/websockets/websocket-connection)
- [Get Event](https://docs.kalshi.com/api-reference/events/get-event)

## Security Notes

- **Read-only only** - No trading, no order placement
- **No private key in browser** - All sensitive operations happen server-side
- WebSocket connections are proxied through the server

## Known Limitations

- WebSocket may require API key authentication (fallback mode available)
- Large events with many markets are capped at 50 for performance
- This is a read-only viewer - no trading capabilities
