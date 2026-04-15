const CORS_ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const FETCH_TIMEOUT_MS = 7000;

interface SuggestRequest {
  title: string;
  category: string;
  description: string;
  outcomeLabels: string[];
}

interface CryptoAsset {
  id: string;
  symbol: string;
  aliases: string[];
}

interface SportsCandidate {
  eventId: string;
  leagueName: string;
  homeTeam: string;
  awayTeam: string;
  kickoffAt: string | null;
  status: string;
  statusLabel: string;
}

const CRYPTO_ASSETS: CryptoAsset[] = [
  { id: 'bitcoin', symbol: 'BTC', aliases: ['btc', 'bitcoin', 'xbt'] },
  { id: 'ethereum', symbol: 'ETH', aliases: ['eth', 'ethereum'] },
  { id: 'solana', symbol: 'SOL', aliases: ['sol', 'solana'] },
  { id: 'binancecoin', symbol: 'BNB', aliases: ['bnb', 'binance', 'binance coin'] },
  { id: 'ripple', symbol: 'XRP', aliases: ['xrp', 'ripple'] },
  { id: 'dogecoin', symbol: 'DOGE', aliases: ['doge', 'dogecoin'] },
  { id: 'cardano', symbol: 'ADA', aliases: ['ada', 'cardano'] },
  { id: 'avalanche-2', symbol: 'AVAX', aliases: ['avax', 'avalanche'] },
  { id: 'toncoin', symbol: 'TON', aliases: ['ton', 'toncoin'] },
  { id: 'chainlink', symbol: 'LINK', aliases: ['link', 'chainlink'] },
  { id: 'sui', symbol: 'SUI', aliases: ['sui'] },
  { id: 'polkadot', symbol: 'DOT', aliases: ['dot', 'polkadot'] },
  { id: 'tron', symbol: 'TRX', aliases: ['trx', 'tron'] },
  { id: 'arbitrum', symbol: 'ARB', aliases: ['arb', 'arbitrum'] },
  { id: 'optimism', symbol: 'OP', aliases: ['op', 'optimism'] },
];

const SPORTS_STOP_WORDS = new Set([
  'will',
  'be',
  'is',
  'the',
  'a',
  'an',
  'to',
  'of',
  'in',
  'on',
  'at',
  'by',
  'for',
  'and',
  'or',
  'market',
  'match',
  'game',
  'final',
  'playoff',
  'season',
  'today',
  'tomorrow',
  'week',
  'this',
  'that',
  'team',
]);

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[|/\\,:;()[\]{}!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsWord(text: string, word: string): boolean {
  if (!text || !word) return false;
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(^|\\s)${escaped}(\\s|$)`, 'i');
  return regex.test(text);
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = normalizeText(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value.trim());
  }
  return out;
}

function normalizeSportsStatus(statusRaw: string): { status: string; statusLabel: string } {
  const clean = (statusRaw || '').trim();
  const lower = clean.toLowerCase();

  if (!clean) return { status: 'unknown', statusLabel: 'Status unavailable' };
  if (lower.includes('in play') || lower.includes('live') || lower.includes('half') || lower.includes('extra')) {
    return { status: 'live', statusLabel: clean };
  }
  if (lower.includes('finished') || lower.includes('full time') || lower.includes('ft')) {
    return { status: 'finished', statusLabel: clean };
  }
  if (lower.includes('not started') || lower.includes('scheduled') || lower.includes('ns')) {
    return { status: 'scheduled', statusLabel: clean };
  }
  if (lower.includes('postponed')) {
    return { status: 'postponed', statusLabel: clean };
  }
  if (lower.includes('cancelled') || lower.includes('abandoned')) {
    return { status: 'cancelled', statusLabel: clean };
  }

  return { status: 'unknown', statusLabel: clean };
}

function parseRequestBody(raw: unknown): SuggestRequest {
  const body = (raw && typeof raw === 'object') ? (raw as Record<string, unknown>) : {};
  return {
    title: typeof body.title === 'string' ? body.title.trim() : '',
    category: typeof body.category === 'string' ? body.category.trim() : '',
    description: typeof body.description === 'string' ? body.description.trim() : '',
    outcomeLabels: Array.isArray(body.outcomeLabels)
      ? body.outcomeLabels.map((value) => (typeof value === 'string' ? value.trim() : '')).filter(Boolean)
      : [],
  };
}

function detectCrypto(input: SuggestRequest) {
  const title = normalizeText(input.title);
  const category = normalizeText(input.category);
  const description = normalizeText(input.description);
  const outcomes = normalizeText(input.outcomeLabels.join(' '));
  const categoryHint = /(crypto|btc|bitcoin|eth|ethereum|token|coin|altcoin|defi)/i.test(category);

  let best: {
    asset: CryptoAsset;
    confidence: number;
    reason: string;
  } | null = null;

  for (const asset of CRYPTO_ASSETS) {
    let score = 0;
    let reason = '';

    for (const alias of asset.aliases) {
      if (containsWord(title, alias)) {
        score = Math.max(score, 0.9);
        reason = `Detected ${asset.symbol} in market title`;
      }
      if (containsWord(category, alias)) {
        score = Math.max(score, 0.75);
        reason = reason || `Detected ${asset.symbol} in market category`;
      }
      if (containsWord(description, alias)) {
        score = Math.max(score, 0.7);
        reason = reason || `Detected ${asset.symbol} in market description`;
      }
      if (containsWord(outcomes, alias)) {
        score = Math.max(score, 0.68);
        reason = reason || `Detected ${asset.symbol} in outcome labels`;
      }
    }

    if (score > 0 && categoryHint) {
      score = Math.min(0.98, score + 0.05);
    }

    if (!best || score > best.confidence) {
      best = {
        asset,
        confidence: score,
        reason: reason || `Potential ${asset.symbol} market`,
      };
    }
  }

  if (!best || best.confidence < 0.55) {
    return {
      detected: false,
      confidence: best?.confidence ?? 0,
      reason: 'No strong crypto pair detected from market text.',
      coingeckoId: null,
      baseSymbol: null,
      quoteSymbol: 'USD',
      vsCurrency: 'usd',
    };
  }

  return {
    detected: true,
    confidence: best.confidence,
    reason: best.reason,
    coingeckoId: best.asset.id,
    baseSymbol: best.asset.symbol,
    quoteSymbol: 'USD',
    vsCurrency: 'usd',
  };
}

function cleanTeamName(value: string): string {
  return value
    .replace(/\b(will|be|is|are|the|a|an|to|of|in|on|at|by|for|market|match|game|final|playoff|season|today|tomorrow)\b/gi, '')
    .replace(/\b(fc|afc|cf|sc|ac|club|team)\b/gi, '')
    .replace(/\b(win|wins|winner|to win|draw|yes|no|over|under)\b/gi, '')
    .replace(/\b(\d{1,2}:\d{2}|\d{1,2}(st|nd|rd|th)|20\d{2})\b/gi, '')
    .replace(/[()\[\]{}]/g, ' ')
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitTitleSegments(title: string): string[] {
  return title
    .split(/[|:;,]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function tokenizeCandidateWords(value: string): string[] {
  return value
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.replace(/[^a-z0-9]/g, '').trim())
    .filter((token) => token.length >= 2 && !SPORTS_STOP_WORDS.has(token));
}

function pickBestTeamPhrase(segment: string): string {
  const cleaned = cleanTeamName(segment);
  if (!cleaned) return '';

  const words = tokenizeCandidateWords(cleaned);
  if (words.length === 0) return '';
  if (words.length <= 4) {
    return words.map((word) => word[0].toUpperCase() + word.slice(1)).join(' ');
  }

  const condensed = words.slice(0, 4);
  return condensed.map((word) => word[0].toUpperCase() + word.slice(1)).join(' ');
}

function extractTeamsFromTitle(title: string): { home: string; away: string } | null {
  const compact = title.replace(/\s+/g, ' ').trim();
  if (!compact) return null;

  const patterns = [
    /(.+?)\s+vs\.?\s+(.+)/i,
    /(.+?)\s+v\s+(.+)/i,
    /(.+?)\s+versus\s+(.+)/i,
    /(.+?)\s*@\s*(.+)/i,
  ];

  for (const pattern of patterns) {
    const match = compact.match(pattern);
    if (!match) continue;
    const home = cleanTeamName(match[1]);
    const away = cleanTeamName(match[2]);
    if (home && away && home.toLowerCase() !== away.toLowerCase()) {
      return { home, away };
    }
  }

  const segments = splitTitleSegments(compact);
  if (segments.length >= 2) {
    const first = pickBestTeamPhrase(segments[0]);
    const second = pickBestTeamPhrase(segments[1]);
    if (first && second && first.toLowerCase() !== second.toLowerCase()) {
      return { home: first, away: second };
    }
  }

  return null;
}

function textSimilarityScore(a: string, b: string): number {
  const aTokens = new Set(tokenizeCandidateWords(a));
  const bTokens = new Set(tokenizeCandidateWords(b));
  if (!aTokens.size || !bTokens.size) return 0;

  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) overlap += 1;
  }

  const denom = Math.max(aTokens.size, bTokens.size);
  return denom > 0 ? overlap / denom : 0;
}

function enrichSportsCandidateScore(candidate: SportsCandidate, pair: { home: string; away: string }): number {
  const base = scoreSportsCandidate(candidate);
  const directOrder =
    textSimilarityScore(candidate.homeTeam, pair.home) +
    textSimilarityScore(candidate.awayTeam, pair.away);
  const reverseOrder =
    textSimilarityScore(candidate.homeTeam, pair.away) +
    textSimilarityScore(candidate.awayTeam, pair.home);
  const teamScore = Math.max(directOrder, reverseOrder) / 2;
  return base * 0.45 + teamScore * 0.55;
}

function extractTeamsFromOutcomes(outcomeLabels: string[]): { home: string; away: string } | null {
  if (outcomeLabels.length < 2) return null;

  const tokens = uniqueStrings(
    outcomeLabels
      .map(cleanTeamName)
      .filter((value) => value.length >= 2),
  );

  const candidates = tokens.filter((value) => {
    const lower = value.toLowerCase();
    return lower !== 'draw' && lower !== 'yes' && lower !== 'no';
  });

  if (candidates.length >= 2) {
    return {
      home: candidates[0],
      away: candidates[1],
    };
  }

  return null;
}

async function fetchJsonWithTimeout(url: string): Promise<any> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    });
    if (!response.ok) {
      throw new Error(`Provider returned ${response.status}`);
    }
    return await response.json();
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error('Provider request timed out.');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

function scoreSportsCandidate(candidate: SportsCandidate): number {
  const kickoffMs = candidate.kickoffAt ? Date.parse(candidate.kickoffAt) : NaN;
  if (!Number.isFinite(kickoffMs)) return 0;

  const now = Date.now();
  const diffHours = Math.abs(kickoffMs - now) / (1000 * 60 * 60);
  if (diffHours < 6) return 1;
  if (diffHours < 24) return 0.9;
  if (diffHours < 72) return 0.8;
  if (diffHours < 14 * 24) return 0.65;
  return 0.5;
}

function mapEventToSportsCandidate(
  event: any,
  input: SuggestRequest,
  fallbackPair: { home: string; away: string } | null,
): SportsCandidate | null {
  const eventId = typeof event?.idEvent === 'string' ? event.idEvent : '';
  if (!eventId) return null;

  const homeTeam =
    typeof event?.strHomeTeam === 'string' && event.strHomeTeam.trim()
      ? event.strHomeTeam.trim()
      : (fallbackPair?.home || 'Home');
  const awayTeam =
    typeof event?.strAwayTeam === 'string' && event.strAwayTeam.trim()
      ? event.strAwayTeam.trim()
      : (fallbackPair?.away || 'Away');

  const kickoffRaw = typeof event?.strTimestamp === 'string' ? event.strTimestamp : '';
  const kickoffAt = kickoffRaw && Number.isFinite(Date.parse(kickoffRaw)) ? new Date(kickoffRaw).toISOString() : null;
  const status = normalizeSportsStatus(typeof event?.strStatus === 'string' ? event.strStatus : '');

  return {
    eventId,
    leagueName: typeof event?.strLeague === 'string' ? event.strLeague : input.category || 'Sports',
    homeTeam,
    awayTeam,
    kickoffAt,
    status: status.status,
    statusLabel: status.statusLabel,
  };
}

function dedupeSportsCandidates(candidates: SportsCandidate[]): SportsCandidate[] {
  const seen = new Set<string>();
  const out: SportsCandidate[] = [];
  for (const candidate of candidates) {
    const key = candidate.eventId.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
  }
  return out;
}

async function fetchSportsCandidatesByQuery(
  query: string,
  input: SuggestRequest,
  fallbackPair: { home: string; away: string } | null,
): Promise<SportsCandidate[]> {
  const normalizedQuery = query.replace(/\s+/g, ' ').trim();
  if (!normalizedQuery) return [];

  const endpoint = `https://www.thesportsdb.com/api/v1/json/3/searchevents.php?e=${encodeURIComponent(normalizedQuery.replace(/\s+/g, '_'))}`;
  const json = await fetchJsonWithTimeout(endpoint);
  const events = Array.isArray(json?.event) ? json.event : [];
  return events
    .map((event: any) => mapEventToSportsCandidate(event, input, fallbackPair))
    .filter((candidate: SportsCandidate | null): candidate is SportsCandidate => Boolean(candidate));
}

async function detectSports(input: SuggestRequest) {
  const categoryHint = /(sport|soccer|football|nba|nfl|mlb|tennis|match|game|league)/i.test(input.category);
  const titleTeams = extractTeamsFromTitle(input.title);
  const outcomeTeams = extractTeamsFromOutcomes(input.outcomeLabels);
  const teamPair = titleTeams || outcomeTeams;

  let candidates: SportsCandidate[] = [];

  if (teamPair) {
    const pairQuery = `${teamPair.home} vs ${teamPair.away}`;
    const reversePairQuery = `${teamPair.away} vs ${teamPair.home}`;
    const titleQuery = input.title.trim();
    const queries = [pairQuery, reversePairQuery, titleQuery].filter(Boolean);

    const fetchedGroups = await Promise.all(
      queries.map((query) => fetchSportsCandidatesByQuery(query, input, teamPair).catch(() => [])),
    );

    candidates = dedupeSportsCandidates(fetchedGroups.flat())
      .sort((a, b) => enrichSportsCandidateScore(b, teamPair) - enrichSportsCandidateScore(a, teamPair))
      .slice(0, 5);
  } else if (categoryHint && input.title.trim()) {
    const titleOnlyCandidates = await fetchSportsCandidatesByQuery(input.title.trim(), input, null).catch(() => []);
    candidates = dedupeSportsCandidates(titleOnlyCandidates)
      .sort((a, b) => scoreSportsCandidate(b) - scoreSportsCandidate(a))
      .slice(0, 5);
  }

  if (!teamPair && candidates.length === 0) {
    return {
      detected: false,
      confidence: 0,
      reason: categoryHint
        ? 'No sports events found from this title yet. You can still enter Event ID manually.'
        : 'No clear team-vs-team pattern detected from title/outcomes.',
      homeTeam: null,
      awayTeam: null,
      selectedEventId: null,
      selectedLeagueName: null,
      candidates: [] as SportsCandidate[],
    };
  }

  if (!teamPair && candidates.length > 0) {
    const first = candidates[0];
    return {
      detected: true,
      confidence: 0.58,
      reason: 'Found sports event candidates from market title. Review and confirm before saving.',
      homeTeam: first.homeTeam,
      awayTeam: first.awayTeam,
      selectedEventId: first.eventId,
      selectedLeagueName: first.leagueName,
      candidates,
    };
  }

  if (!teamPair) {
    return {
      detected: false,
      confidence: 0,
      reason: 'Could not determine teams from this market text.',
      homeTeam: null,
      awayTeam: null,
      selectedEventId: null,
      selectedLeagueName: null,
      candidates,
    };
  }

  let confidence = titleTeams ? 0.82 : 0.66;
  if (categoryHint) confidence += 0.06;
  if (candidates.length > 0) confidence += 0.08;

  if (candidates.length > 0) {
    const bestScore = enrichSportsCandidateScore(candidates[0], teamPair);
    if (bestScore < 0.35) {
      confidence = Math.min(confidence, 0.58);
    } else if (bestScore < 0.5) {
      confidence = Math.min(confidence, 0.68);
    } else {
      confidence = Math.min(0.98, confidence + 0.05);
    }
  }

  confidence = Math.min(0.98, confidence);

  return {
    detected: true,
    confidence,
    reason: titleTeams
      ? `Detected teams from title: ${teamPair.home} vs ${teamPair.away}`
      : `Detected teams from outcomes: ${teamPair.home} vs ${teamPair.away}`,
    homeTeam: teamPair.home,
    awayTeam: teamPair.away,
    selectedEventId: candidates[0]?.eventId ?? null,
    selectedLeagueName: candidates[0]?.leagueName ?? null,
    candidates,
  };
}

function resolveCorsOrigin(originHeader: unknown): string | null {
  if (process.env.NODE_ENV !== 'production') return '*';
  if (typeof originHeader !== 'string' || !originHeader) return null;
  if (CORS_ALLOWED_ORIGINS.includes('*')) return originHeader;
  return CORS_ALLOWED_ORIGINS.includes(originHeader) ? originHeader : null;
}

export default async function handler(req: any, res: any) {
  const corsOrigin = resolveCorsOrigin(req.headers?.origin);
  if (corsOrigin) {
    res.setHeader('Access-Control-Allow-Origin', corsOrigin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') return res.status(200).json({ ok: true });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        return res.status(400).json({ error: 'Invalid JSON' });
      }
    }

    const input = parseRequestBody(body);
    if (!input.title) {
      return res.status(400).json({ error: 'title is required' });
    }

    const [crypto, sports] = await Promise.all([
      Promise.resolve(detectCrypto(input)),
      detectSports(input),
    ]);

    return res.status(200).json({ crypto, sports });
  } catch (err: any) {
    const msg = err?.message || 'Unexpected error';
    return res.status(500).json({ error: msg });
  }
}
