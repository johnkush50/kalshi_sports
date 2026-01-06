import { GroupType } from './relatedSeries';
import { LadderKeyComponents, buildLadderKey } from './ladderConfig';

export interface ParsedMarketInfo {
  line: number | null;
  side: string;
  /** Confidence in parsing: 'ticker' (from market_ticker), 'title' (from title), 'unknown' */
  parseSource: 'ticker' | 'title' | 'unknown';
  /** Team abbreviation extracted from ticker suffix (e.g., 'BAL', 'PIT') */
  teamAbbrev?: string;
}

export interface LadderParseResult extends ParsedMarketInfo {
  ladderKey: string | null;
  ladderComponents: LadderKeyComponents | null;
  isParsed: boolean;
}

/** NFL team abbreviation to full name mapping */
const NFL_ABBREV_MAP: Record<string, string> = {
  'ARI': 'Cardinals', 'ATL': 'Falcons', 'BAL': 'Ravens', 'BUF': 'Bills',
  'CAR': 'Panthers', 'CHI': 'Bears', 'CIN': 'Bengals', 'CLE': 'Browns',
  'DAL': 'Cowboys', 'DEN': 'Broncos', 'DET': 'Lions', 'GB': 'Packers',
  'HOU': 'Texans', 'IND': 'Colts', 'JAX': 'Jaguars', 'KC': 'Chiefs',
  'LAC': 'Chargers', 'LAR': 'Rams', 'LV': 'Raiders', 'MIA': 'Dolphins',
  'MIN': 'Vikings', 'NE': 'Patriots', 'NO': 'Saints', 'NYG': 'Giants',
  'NYJ': 'Jets', 'PHI': 'Eagles', 'PIT': 'Steelers', 'SEA': 'Seahawks',
  'SF': '49ers', 'TB': 'Buccaneers', 'TEN': 'Titans', 'WAS': 'Commanders',
};

/** NBA team abbreviation to full name mapping */
const NBA_ABBREV_MAP: Record<string, string> = {
  'ATL': 'Hawks', 'BOS': 'Celtics', 'BKN': 'Nets', 'CHA': 'Hornets',
  'CHI': 'Bulls', 'CLE': 'Cavaliers', 'DAL': 'Mavericks', 'DEN': 'Nuggets',
  'DET': 'Pistons', 'GSW': 'Warriors', 'HOU': 'Rockets', 'IND': 'Pacers',
  'LAC': 'Clippers', 'LAL': 'Lakers', 'MEM': 'Grizzlies', 'MIA': 'Heat',
  'MIL': 'Bucks', 'MIN': 'Timberwolves', 'NOP': 'Pelicans', 'NYK': 'Knicks',
  'OKC': 'Thunder', 'ORL': 'Magic', 'PHI': '76ers', 'PHX': 'Suns',
  'POR': 'Trail Blazers', 'SAC': 'Kings', 'SAS': 'Spurs', 'TOR': 'Raptors',
  'UTA': 'Jazz', 'WAS': 'Wizards',
};

const ALL_ABBREV_MAP: Record<string, string> = { ...NFL_ABBREV_MAP, ...NBA_ABBREV_MAP };

/**
 * Parse market ticker suffix to extract team abbreviation and line
 * Example: "KXNFLSPREAD-26JAN04BALPIT-BAL3" → { teamAbbrev: 'BAL', line: 3 }
 * Example: "KXNFLSPREAD-26JAN04BALPIT-PIT7" → { teamAbbrev: 'PIT', line: 7 }
 */
export function parseTickerSuffix(ticker: string): { teamAbbrev: string | null; line: number | null } {
  if (!ticker) return { teamAbbrev: null, line: null };
  
  const upperTicker = ticker.toUpperCase();
  const parts = upperTicker.split('-');
  
  if (parts.length < 2) return { teamAbbrev: null, line: null };
  
  // Get last segment (e.g., "BAL3", "PIT7", "O45", "U42")
  const lastPart = parts[parts.length - 1];
  
  // Try to match team abbreviation + number
  // Pattern: 2-3 letter team code followed by optional number
  const match = lastPart.match(/^([A-Z]{2,3})(\d+\.?\d*)?$/);
  
  if (match) {
    const abbrev = match[1];
    const lineStr = match[2];
    
    // Check if it's a known team abbreviation
    if (ALL_ABBREV_MAP[abbrev]) {
      return {
        teamAbbrev: abbrev,
        line: lineStr ? parseFloat(lineStr) : null,
      };
    }
    
    // Check for Over/Under indicators
    if (abbrev === 'O' || abbrev === 'OV') {
      return { teamAbbrev: 'OVER', line: lineStr ? parseFloat(lineStr) : null };
    }
    if (abbrev === 'U' || abbrev === 'UN') {
      return { teamAbbrev: 'UNDER', line: lineStr ? parseFloat(lineStr) : null };
    }
  }
  
  // Try pattern for totals: O45, U42, OVER45, UNDER42
  const totalMatch = lastPart.match(/^(O|U|OVER|UNDER)(\d+\.?\d*)$/);
  if (totalMatch) {
    const side = totalMatch[1].startsWith('O') ? 'OVER' : 'UNDER';
    return { teamAbbrev: side, line: parseFloat(totalMatch[2]) };
  }
  
  return { teamAbbrev: null, line: null };
}

export function parseMarketTitle(title: string, groupType: GroupType): ParsedMarketInfo {
  if (!title) {
    return { line: null, side: 'Unknown', parseSource: 'unknown' };
  }

  try {
    if (groupType === 'total') {
      return parseTotalMarket(title);
    } else if (groupType === 'spread') {
      return parseSpreadMarket(title);
    }
  } catch {
    // Fall through to default
  }

  return { line: null, side: 'Unknown', parseSource: 'unknown' };
}

/**
 * Full market parsing with ticker suffix priority
 * Returns ladder key components for proper grouping
 */
export function parseMarketForLadder(
  ticker: string,
  title: string,
  groupType: GroupType,
  gameId: string
): LadderParseResult {
  // First try to parse from ticker suffix
  const tickerParsed = parseTickerSuffix(ticker);
  
  // Then parse from title as fallback
  const titleParsed = parseMarketTitle(title, groupType);
  
  // Determine best source
  let side = 'Unknown';
  let line: number | null = null;
  let parseSource: 'ticker' | 'title' | 'unknown' = 'unknown';
  let teamAbbrev: string | undefined;
  
  // Prefer ticker-derived values
  if (tickerParsed.teamAbbrev) {
    teamAbbrev = tickerParsed.teamAbbrev;
    // Convert abbreviation to full name for spreads, keep as-is for totals
    if (groupType === 'spread') {
      side = ALL_ABBREV_MAP[tickerParsed.teamAbbrev] || tickerParsed.teamAbbrev;
    } else if (groupType === 'total') {
      side = tickerParsed.teamAbbrev === 'OVER' ? 'Over' : 
             tickerParsed.teamAbbrev === 'UNDER' ? 'Under' : tickerParsed.teamAbbrev;
    }
    parseSource = 'ticker';
  }
  
  // Use ticker line if available, otherwise title line
  line = tickerParsed.line ?? titleParsed.line;
  
  // Fallback to title-parsed side if ticker didn't provide one
  if (side === 'Unknown' && titleParsed.side !== 'Unknown') {
    side = titleParsed.side;
    parseSource = parseSource === 'unknown' ? 'title' : parseSource;
  }
  
  // Build ladder key if we have valid side
  const isParsed = side !== 'Unknown';
  let ladderKey: string | null = null;
  let ladderComponents: LadderKeyComponents | null = null;
  
  if (isParsed && (groupType === 'spread' || groupType === 'total')) {
    const predicate = groupType === 'spread' 
      ? 'wins_by_over'
      : side.toLowerCase() === 'over' ? 'total_over' : 'total_under';
    
    ladderComponents = {
      gameId,
      ladderType: groupType,
      side,
      predicate,
    };
    ladderKey = buildLadderKey(ladderComponents);
  }
  
  return {
    line,
    side,
    parseSource,
    teamAbbrev,
    ladderKey,
    ladderComponents,
    isParsed,
  };
}

function parseTotalMarket(title: string): ParsedMarketInfo {
  const floatMatch = title.match(/(\d+\.?\d*)/);
  const line = floatMatch ? parseFloat(floatMatch[1]) : null;

  let side = 'Unknown';
  const lowerTitle = title.toLowerCase();
  if (lowerTitle.includes('over')) {
    side = 'Over';
  } else if (lowerTitle.includes('under')) {
    side = 'Under';
  }

  return { line, side, parseSource: 'title' };
}

function parseSpreadMarket(title: string): ParsedMarketInfo {
  // Look for "wins by" pattern to find the line
  // Examples: "Ravens win by over 3.5", "wins by over 7 points"
  let line: number | null = null;
  
  const winsMatch = title.match(/wins?\s+by\s+(?:over\s+)?(\d+\.?\d*)/i);
  if (winsMatch) {
    line = parseFloat(winsMatch[1]);
  } else {
    // Fallback to first number
    const spreadMatch = title.match(/([+-]?\d+\.?\d*)/);
    line = spreadMatch ? parseFloat(spreadMatch[1]) : null;
  }

  let side = 'Unknown';
  
  const lowerTitle = title.toLowerCase();
  
  const teamPatterns = [
    // NFL teams
    { pattern: /ravens?/i, name: 'Ravens' },
    { pattern: /steelers?/i, name: 'Steelers' },
    { pattern: /chiefs?/i, name: 'Chiefs' },
    { pattern: /bills?/i, name: 'Bills' },
    { pattern: /eagles?/i, name: 'Eagles' },
    { pattern: /cowboys?/i, name: 'Cowboys' },
    { pattern: /49ers?|niners?/i, name: '49ers' },
    { pattern: /packers?/i, name: 'Packers' },
    { pattern: /lions?/i, name: 'Lions' },
    { pattern: /vikings?/i, name: 'Vikings' },
    { pattern: /bears?/i, name: 'Bears' },
    { pattern: /dolphins?/i, name: 'Dolphins' },
    { pattern: /jets?/i, name: 'Jets' },
    { pattern: /patriots?/i, name: 'Patriots' },
    { pattern: /bengals?/i, name: 'Bengals' },
    { pattern: /browns?/i, name: 'Browns' },
    { pattern: /texans?/i, name: 'Texans' },
    { pattern: /colts?/i, name: 'Colts' },
    { pattern: /jaguars?/i, name: 'Jaguars' },
    { pattern: /titans?/i, name: 'Titans' },
    { pattern: /broncos?/i, name: 'Broncos' },
    { pattern: /raiders?/i, name: 'Raiders' },
    { pattern: /chargers?/i, name: 'Chargers' },
    { pattern: /commanders?/i, name: 'Commanders' },
    { pattern: /giants?/i, name: 'Giants' },
    { pattern: /cardinals?/i, name: 'Cardinals' },
    { pattern: /rams?/i, name: 'Rams' },
    { pattern: /seahawks?/i, name: 'Seahawks' },
    { pattern: /buccaneers?|bucs?/i, name: 'Buccaneers' },
    { pattern: /falcons?/i, name: 'Falcons' },
    { pattern: /panthers?/i, name: 'Panthers' },
    { pattern: /saints?/i, name: 'Saints' },
    // NBA teams (for future)
    { pattern: /lakers?/i, name: 'Lakers' },
    { pattern: /celtics?/i, name: 'Celtics' },
    { pattern: /warriors?/i, name: 'Warriors' },
    { pattern: /bucks?/i, name: 'Bucks' },
    { pattern: /heat/i, name: 'Heat' },
    { pattern: /nuggets?/i, name: 'Nuggets' },
    { pattern: /suns?/i, name: 'Suns' },
    { pattern: /76ers?|sixers?/i, name: '76ers' },
    { pattern: /nets?/i, name: 'Nets' },
    { pattern: /knicks?/i, name: 'Knicks' },
    { pattern: /clippers?/i, name: 'Clippers' },
    { pattern: /mavericks?|mavs?/i, name: 'Mavericks' },
    { pattern: /grizzlies?/i, name: 'Grizzlies' },
    { pattern: /pelicans?/i, name: 'Pelicans' },
    { pattern: /timberwolves?|wolves?/i, name: 'Timberwolves' },
    { pattern: /thunder/i, name: 'Thunder' },
    { pattern: /trail ?blazers?|blazers?/i, name: 'Trail Blazers' },
    { pattern: /kings?/i, name: 'Kings' },
    { pattern: /spurs?/i, name: 'Spurs' },
    { pattern: /jazz/i, name: 'Jazz' },
    { pattern: /rockets?/i, name: 'Rockets' },
    { pattern: /pistons?/i, name: 'Pistons' },
    { pattern: /pacers?/i, name: 'Pacers' },
    { pattern: /cavaliers?|cavs?/i, name: 'Cavaliers' },
    { pattern: /bulls?/i, name: 'Bulls' },
    { pattern: /hawks?/i, name: 'Hawks' },
    { pattern: /hornets?/i, name: 'Hornets' },
    { pattern: /magic/i, name: 'Magic' },
    { pattern: /wizards?/i, name: 'Wizards' },
    { pattern: /raptors?/i, name: 'Raptors' },
  ];

  for (const { pattern, name } of teamPatterns) {
    if (pattern.test(title)) {
      side = name;
      break;
    }
  }

  if (side === 'Unknown') {
    if (lowerTitle.includes('home')) {
      side = 'Home';
    } else if (lowerTitle.includes('away')) {
      side = 'Away';
    }
  }

  return { line, side, parseSource: side !== 'Unknown' ? 'title' : 'unknown' };
}

export function formatLine(line: number | null, groupType: GroupType): string {
  if (line === null) return '—';
  
  if (groupType === 'spread') {
    return line >= 0 ? `+${line}` : `${line}`;
  }
  
  return `${line}`;
}
