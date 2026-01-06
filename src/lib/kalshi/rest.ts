import { KalshiEvent, KalshiMarket, EventWithMarkets, getRestBaseUrl } from './types';
import { getRelatedEventTickers, getGroupTypeForEventTicker, parseEventTicker, GroupType } from './relatedSeries';
import { parseMarketTitle } from './marketParsing';

export interface EnrichedMarket extends KalshiMarket {
  event_ticker: string;
  group_type: GroupType;
  line: number | null;
  side: string;
}

export interface ResolvedEventInfo {
  eventTicker: string;
  title: string;
  category?: string;
  marketCount: number;
}

export interface RelatedEventsResult {
  inputTicker: string;
  gameId: string;
  resolvedEvents: ResolvedEventInfo[];
  primaryEvent: KalshiEvent | null;
  markets: EnrichedMarket[];
}

export async function fetchEventWithMarkets(eventTicker: string): Promise<EventWithMarkets> {
  const baseUrl = getRestBaseUrl();
  const normalizedTicker = eventTicker.trim().toUpperCase();
  
  const url = `${baseUrl}/trade-api/v2/events/${encodeURIComponent(normalizedTicker)}?with_nested_markets=true`;
  
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Event not found: ${eventTicker}`);
    }
    const text = await response.text();
    throw new Error(`Failed to fetch event: ${response.status} - ${text}`);
  }

  const data = await response.json();
  
  const event: KalshiEvent = {
    event_ticker: data.event?.event_ticker || normalizedTicker,
    title: data.event?.title || 'Unknown Event',
    subtitle: data.event?.subtitle,
    category: data.event?.category,
    mutually_exclusive: data.event?.mutually_exclusive,
  };

  let markets: KalshiMarket[] = [];

  if (data.event?.markets && Array.isArray(data.event.markets)) {
    markets = data.event.markets.map((m: Record<string, unknown>) => ({
      ticker: (m.ticker as string) || (m.market_ticker as string) || '',
      market_ticker: (m.ticker as string) || (m.market_ticker as string) || '',
      title: (m.title as string) || '',
      subtitle: m.subtitle as string | undefined,
      status: m.status as string | undefined,
      yes_bid: m.yes_bid as number | undefined,
      yes_ask: m.yes_ask as number | undefined,
      last_price: m.last_price as number | undefined,
      volume: m.volume as number | undefined,
      volume_24h: m.volume_24h as number | undefined,
      open_interest: m.open_interest as number | undefined,
      result: m.result as string | undefined,
    }));
  } else if (data.markets && Array.isArray(data.markets)) {
    markets = data.markets.map((m: Record<string, unknown>) => ({
      ticker: (m.ticker as string) || (m.market_ticker as string) || '',
      market_ticker: (m.ticker as string) || (m.market_ticker as string) || '',
      title: (m.title as string) || '',
      subtitle: m.subtitle as string | undefined,
      status: m.status as string | undefined,
      yes_bid: m.yes_bid as number | undefined,
      yes_ask: m.yes_ask as number | undefined,
      last_price: m.last_price as number | undefined,
      volume: m.volume as number | undefined,
      volume_24h: m.volume_24h as number | undefined,
      open_interest: m.open_interest as number | undefined,
      result: m.result as string | undefined,
    }));
  }

  if (markets.length === 0) {
    throw new Error(`No markets found for event: ${eventTicker}`);
  }

  event.markets = markets;

  return { event, markets };
}

export function extractMarketTickers(markets: KalshiMarket[]): string[] {
  return markets
    .map(m => m.ticker || m.market_ticker || '')
    .filter(t => t.length > 0);
}

async function fetchSingleEvent(eventTicker: string): Promise<{ event: KalshiEvent; markets: KalshiMarket[] } | null> {
  const baseUrl = getRestBaseUrl();
  const normalizedTicker = eventTicker.trim().toUpperCase();
  
  const url = `${baseUrl}/trade-api/v2/events/${encodeURIComponent(normalizedTicker)}?with_nested_markets=true`;
  
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      console.warn(`Failed to fetch event ${eventTicker}: ${response.status}`);
      return null;
    }

    const data = await response.json();
    
    const event: KalshiEvent = {
      event_ticker: data.event?.event_ticker || normalizedTicker,
      title: data.event?.title || 'Unknown Event',
      subtitle: data.event?.subtitle,
      category: data.event?.category,
      mutually_exclusive: data.event?.mutually_exclusive,
    };

    let markets: KalshiMarket[] = [];

    if (data.event?.markets && Array.isArray(data.event.markets)) {
      markets = data.event.markets.map((m: Record<string, unknown>) => ({
        ticker: (m.ticker as string) || (m.market_ticker as string) || '',
        market_ticker: (m.ticker as string) || (m.market_ticker as string) || '',
        title: (m.title as string) || '',
        subtitle: m.subtitle as string | undefined,
        status: m.status as string | undefined,
        yes_bid: m.yes_bid as number | undefined,
        yes_ask: m.yes_ask as number | undefined,
        last_price: m.last_price as number | undefined,
        volume: m.volume as number | undefined,
        volume_24h: m.volume_24h as number | undefined,
        open_interest: m.open_interest as number | undefined,
        result: m.result as string | undefined,
      }));
    } else if (data.markets && Array.isArray(data.markets)) {
      markets = data.markets.map((m: Record<string, unknown>) => ({
        ticker: (m.ticker as string) || (m.market_ticker as string) || '',
        market_ticker: (m.ticker as string) || (m.market_ticker as string) || '',
        title: (m.title as string) || '',
        subtitle: m.subtitle as string | undefined,
        status: m.status as string | undefined,
        yes_bid: m.yes_bid as number | undefined,
        yes_ask: m.yes_ask as number | undefined,
        last_price: m.last_price as number | undefined,
        volume: m.volume as number | undefined,
        volume_24h: m.volume_24h as number | undefined,
        open_interest: m.open_interest as number | undefined,
        result: m.result as string | undefined,
      }));
    }

    event.markets = markets;
    return { event, markets };
  } catch (err) {
    console.warn(`Error fetching event ${eventTicker}:`, err);
    return null;
  }
}

export async function fetchRelatedEvents(inputTicker: string): Promise<RelatedEventsResult> {
  const { gameId } = parseEventTicker(inputTicker);
  const relatedTickers = getRelatedEventTickers(inputTicker);
  
  console.log(`[RelatedEvents] Input: ${inputTicker}, GameId: ${gameId}`);
  console.log(`[RelatedEvents] Fetching candidates:`, relatedTickers);
  
  const fetchPromises = relatedTickers.map((ticker) => fetchSingleEvent(ticker));
  const results = await Promise.all(fetchPromises);
  
  const resolvedEvents: ResolvedEventInfo[] = [];
  const allMarkets: EnrichedMarket[] = [];
  let primaryEvent: KalshiEvent | null = null;
  
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const eventTicker = relatedTickers[i];
    
    if (!result) continue;
    
    const groupType = getGroupTypeForEventTicker(eventTicker);
    
    resolvedEvents.push({
      eventTicker: result.event.event_ticker,
      title: result.event.title,
      category: result.event.category,
      marketCount: result.markets.length,
    });
    
    if (!primaryEvent) {
      primaryEvent = result.event;
    }
    
    for (const market of result.markets) {
      const parsed = parseMarketTitle(market.title, groupType);
      
      allMarkets.push({
        ...market,
        event_ticker: result.event.event_ticker,
        group_type: groupType,
        line: parsed.line,
        side: parsed.side,
      });
    }
  }
  
  console.log(`[RelatedEvents] Resolved ${resolvedEvents.length} events with ${allMarkets.length} total markets`);
  
  if (allMarkets.length === 0) {
    throw new Error(`No markets found for event: ${inputTicker} (checked: ${relatedTickers.join(', ')})`);
  }
  
  return {
    inputTicker,
    gameId,
    resolvedEvents,
    primaryEvent,
    markets: allMarkets,
  };
}
