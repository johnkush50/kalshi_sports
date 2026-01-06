export type GroupType = 'winner' | 'spread' | 'total' | 'other';

export interface SeriesConfig {
  groupKey: string;
  relatedSeries: { prefix: string; groupType: GroupType }[];
}

const NFL_CONFIG: SeriesConfig = {
  groupKey: 'kxnfl',
  relatedSeries: [
    { prefix: 'kxnflgame', groupType: 'winner' },
    { prefix: 'kxnflspread', groupType: 'spread' },
    { prefix: 'kxnfltotal', groupType: 'total' },
  ],
};

const NBA_CONFIG: SeriesConfig = {
  groupKey: 'kxnba',
  relatedSeries: [
    { prefix: 'kxnbagame', groupType: 'winner' },
    { prefix: 'kxnbaspread', groupType: 'spread' },
    { prefix: 'kxnbatotal', groupType: 'total' },
  ],
};

const SERIES_CONFIGS: SeriesConfig[] = [NFL_CONFIG, NBA_CONFIG];

export interface ParsedEventTicker {
  seriesPrefix: string;
  gameId: string;
  groupKey: string | null;
}

export function parseEventTicker(eventTicker: string): ParsedEventTicker {
  const normalized = eventTicker.toLowerCase().trim();
  const dashIndex = normalized.indexOf('-');
  
  if (dashIndex === -1) {
    return {
      seriesPrefix: normalized,
      gameId: '',
      groupKey: null,
    };
  }
  
  const seriesPrefix = normalized.slice(0, dashIndex);
  const gameId = normalized.slice(dashIndex + 1);
  
  let groupKey: string | null = null;
  for (const config of SERIES_CONFIGS) {
    if (seriesPrefix.startsWith(config.groupKey)) {
      groupKey = config.groupKey;
      break;
    }
  }
  
  return { seriesPrefix, gameId, groupKey };
}

export function getRelatedEventTickers(eventTicker: string): string[] {
  const { seriesPrefix, gameId, groupKey } = parseEventTicker(eventTicker);
  
  if (!gameId) {
    return [eventTicker.toLowerCase()];
  }
  
  if (!groupKey) {
    return [eventTicker.toLowerCase()];
  }
  
  const config = SERIES_CONFIGS.find((c) => c.groupKey === groupKey);
  if (!config) {
    return [eventTicker.toLowerCase()];
  }
  
  return config.relatedSeries.map((s) => `${s.prefix}-${gameId}`);
}

export function getGroupTypeForSeries(seriesPrefix: string): GroupType {
  const normalized = seriesPrefix.toLowerCase();
  
  for (const config of SERIES_CONFIGS) {
    for (const series of config.relatedSeries) {
      if (normalized === series.prefix) {
        return series.groupType;
      }
    }
  }
  
  return 'other';
}

export function getGroupTypeForEventTicker(eventTicker: string): GroupType {
  const { seriesPrefix } = parseEventTicker(eventTicker);
  return getGroupTypeForSeries(seriesPrefix);
}

export function getSupportedSports(): string[] {
  return SERIES_CONFIGS.map((c) => c.groupKey);
}
