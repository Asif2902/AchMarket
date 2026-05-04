import { sportsDbUrl, teamsMatch } from './_sportsdb.js';
import { extractSignedHeaders, verifySignedMessage } from './_signature.js';
import { normalizeSportsStatus } from './_sports-status.js';
import { searchCoinGeckoAssets, type CoinGeckoSearchCandidate } from './_coingecko.js';
import { LIVE_CRYPTO_ASSETS } from '../src/config/liveCryptoAssets.js';

const CORS_ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const FETCH_TIMEOUT_MS = 7000;

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

interface SuggestRequest {
  title: string;
  category: string;
  description: string;
  outcomeLabels: string[];
}

type LiveCryptoMetric = 'price' | 'market-cap' | 'volume-24h';

interface SportsCandidate {
  eventId: string;
  leagueName: string;
  homeTeam: string;
  awayTeam: string;
  kickoffAt: string | null;
  status: string;
  statusLabel: string;
  matchScore?: number;
}

const CRYPTO_ASSETS = LIVE_CRYPTO_ASSETS;

function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const DOLLAR_PREFIX_REGEX = new Map<string, RegExp>();
for (const asset of CRYPTO_ASSETS) {
  for (const alias of asset.aliases) {
    DOLLAR_PREFIX_REGEX.set(alias, new RegExp(`\\$${escapeRegExp(alias)}\\b`, 'i'));
  }
}

const AMBIGUOUS_ALIASES = new Set([
  'ton',
  'link',
  'dot',
  'op',
  'arb',
  'sui',
  'binance',
  'ripple',
  'optimism',
  'avalanche',
  'tron',
]);

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

const CRYPTO_STOP_WORDS = new Set([
  'will',
  'the',
  'and',
  'for',
  'with',
  'from',
  'have',
  'has',
  'had',
  'this',
  'that',
  'what',
  'when',
  'where',
  'price',
  'market',
  'crypto',
  'altcoin',
  'defi',
  'token',
  'coin',
  'reach',
  'hit',
  'above',
  'below',
  'under',
  'over',
  'before',
  'after',
  'end',
  'year',
  'month',
  'week',
  'today',
  'tomorrow',
  'yes',
  'no',
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

const MAX_TITLE_LEN = 300;
const MAX_CATEGORY_LEN = 200;
const MAX_DESCRIPTION_LEN = 5000;
const MAX_OUTCOME_LABELS = 20;
const MAX_LABEL_LEN = 100;

function parseRequestBody(raw: unknown): SuggestRequest {
  if (Array.isArray(raw)) {
    throw new ValidationError('Request body must be an object');
  }
  const body = (raw && typeof raw === 'object') ? (raw as Record<string, unknown>) : {};

  // Check raw sizes before any processing to reject oversized payloads early
  const rawTitle = typeof body.title === 'string' ? body.title : '';
  const rawCategory = typeof body.category === 'string' ? body.category : '';
  const rawDescription = typeof body.description === 'string' ? body.description : '';

  if (rawTitle.length > MAX_TITLE_LEN) {
    throw new ValidationError(`title exceeds ${MAX_TITLE_LEN} characters`);
  }
  if (rawCategory.length > MAX_CATEGORY_LEN) {
    throw new ValidationError(`category exceeds ${MAX_CATEGORY_LEN} characters`);
  }
  if (rawDescription.length > MAX_DESCRIPTION_LEN) {
    throw new ValidationError(`description exceeds ${MAX_DESCRIPTION_LEN} characters`);
  }

  const title = rawTitle.trim();
  const category = rawCategory.trim();
  const description = rawDescription.trim();

  const outcomeLabels = Array.isArray(body.outcomeLabels)
    ? body.outcomeLabels
        .filter((value): value is string => typeof value === 'string')
    : [];

  if (outcomeLabels.length > MAX_OUTCOME_LABELS) {
    throw new ValidationError(`outcomeLabels exceeds ${MAX_OUTCOME_LABELS} items`);
  }

  for (const label of outcomeLabels) {
    if (label.length > MAX_LABEL_LEN) {
      throw new ValidationError(`outcomeLabel exceeds ${MAX_LABEL_LEN} characters`);
    }
  }

  const trimmedLabels = outcomeLabels
    .map((value) => value.trim())
    .filter(Boolean);

  return { title, category, description, outcomeLabels: trimmedLabels };
}

function extractCryptoSearchTerms(input: SuggestRequest, categoryHint: boolean): string[] {
  const out: string[] = [];
  const push = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (trimmed.length < 2 || trimmed.length > 40) return;
    out.push(trimmed);
  };

  const rawSources = [input.title, ...input.outcomeLabels];
  const combined = rawSources.join(' ');
  const hasTickerEvidence =
    /\$[A-Za-z0-9-]+/.test(combined) ||
    /\b[A-Z][A-Z0-9]{1,9}\b/.test(combined);

  for (const match of combined.matchAll(/\$([a-zA-Z0-9][a-zA-Z0-9-]{1,19})/g)) {
    push(match[1]);
  }

  for (const match of combined.matchAll(/\b([A-Z][A-Z0-9]{1,9})\b/g)) {
    push(match[1]);
  }

  const normalizedWords = combined
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 3 && word.length <= 20 && !CRYPTO_STOP_WORDS.has(word) && !/^\d+$/.test(word));

  if (categoryHint || hasTickerEvidence) {
    for (const word of normalizedWords) {
      push(word);
    }
  }

  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const item of out) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped.slice(0, 6);
}

function scoreDynamicCryptoCandidate(term: string, candidate: CoinGeckoSearchCandidate, categoryHint: boolean): number {
  const normalizedTerm = term.trim().toLowerCase();
  const normalizedSymbol = candidate.symbol.trim().toLowerCase();
  const normalizedName = candidate.name.trim().toLowerCase();
  const normalizedId = candidate.id.trim().toLowerCase();
  const isTickerLikeTerm = /^[a-z0-9-]{2,10}$/i.test(term) && !/\s/.test(term);

  let confidence = 0.52;
  if (normalizedSymbol === normalizedTerm) confidence = 0.84;
  else if (normalizedName === normalizedTerm) confidence = 0.78;
  else if (normalizedId === normalizedTerm) confidence = 0.74;
  else if (normalizedSymbol.startsWith(normalizedTerm)) confidence = 0.7;
  else if (normalizedName.startsWith(normalizedTerm) || normalizedId.startsWith(normalizedTerm)) confidence = 0.66;
  else if (normalizedName.includes(normalizedTerm) || normalizedId.includes(normalizedTerm)) confidence = 0.61;

  if (!categoryHint && !isTickerLikeTerm) {
    if (normalizedName === normalizedTerm) confidence = Math.min(confidence, 0.64);
    else if (normalizedId === normalizedTerm) confidence = Math.min(confidence, 0.62);
    else if (normalizedName.startsWith(normalizedTerm) || normalizedId.startsWith(normalizedTerm)) confidence = Math.min(confidence, 0.58);
    else if (normalizedName.includes(normalizedTerm) || normalizedId.includes(normalizedTerm)) confidence = Math.min(confidence, 0.55);
  }

  if (candidate.marketCapRank !== null && candidate.marketCapRank <= 100) {
    confidence += 0.03;
  }
  if (categoryHint) {
    confidence += 0.04;
  }

  return Math.min(0.95, confidence);
}

async function detectCrypto(input: SuggestRequest) {
  const title = normalizeText(input.title);
  const category = normalizeText(input.category);
  const description = normalizeText(input.description);
  const outcomes = normalizeText(input.outcomeLabels.join(' '));
  const categoryHint = /(crypto|btc|bitcoin|eth|ethereum|token|coin|altcoin|defi)/i.test(category);

  let best: {
    asset: (typeof CRYPTO_ASSETS)[number];
    confidence: number;
    reason: string;
  } | null = null;

  for (const asset of CRYPTO_ASSETS) {
    let score = 0;
    let reason = '';
    let ambiguousMatchCount = 0;
    let ambiguousHasDollarPrefix = false;

    for (const alias of asset.aliases) {
      const isAmbiguous = AMBIGUOUS_ALIASES.has(alias) && alias.length >= 3;
      const dollarRegex = DOLLAR_PREFIX_REGEX.get(alias);
      const hasDollarPrefix = dollarRegex
        ? dollarRegex.test(title) ||
          dollarRegex.test(category) ||
          dollarRegex.test(description) ||
          dollarRegex.test(outcomes)
        : false;
      const raiseScore = (ambiguousScore: number, strongScore: number) => {
        if (isAmbiguous && !hasDollarPrefix) {
          ambiguousMatchCount += 1;
          score = Math.max(score, ambiguousScore);
          return;
        }
        if (isAmbiguous && hasDollarPrefix) {
          ambiguousHasDollarPrefix = true;
        }
        score = Math.max(score, strongScore);
      };

      if (containsWord(title, alias)) {
        raiseScore(0.46, 0.9);
        reason = `Detected ${asset.symbol} in market title`;
      }
      if (containsWord(category, alias)) {
        raiseScore(0.4, 0.75);
        reason = reason || `Detected ${asset.symbol} in market category`;
      }
      if (containsWord(description, alias)) {
        raiseScore(0.38, 0.7);
        reason = reason || `Detected ${asset.symbol} in market description`;
      }
      if (containsWord(outcomes, alias)) {
        raiseScore(0.36, 0.68);
        reason = reason || `Detected ${asset.symbol} in outcome labels`;
      }
    }

    const ambiguousHasCorroboration = ambiguousHasDollarPrefix || ambiguousMatchCount >= 2;
    if (ambiguousHasCorroboration) {
      score = Math.max(score, ambiguousHasDollarPrefix ? 0.82 : 0.58);
    }

    if (score > 0 && categoryHint) {
      score = Math.min(0.98, score + (ambiguousMatchCount > 0 && !ambiguousHasCorroboration ? 0.02 : 0.05));
    }

    if (!best || score > best.confidence) {
      best = {
        asset,
        confidence: score,
        reason: reason || `Potential ${asset.symbol} market`,
      };
    }
  }

  const combinedText = `${title} ${category} ${description} ${outcomes}`;

  const metric: LiveCryptoMetric =
    /(market\s*cap|mcap|capitalization)/i.test(combinedText)
      ? 'market-cap'
      : /(24h\s*vol|volume|trading\s*volume)/i.test(combinedText)
        ? 'volume-24h'
        : 'price';

  if (best && best.confidence >= 0.55) {
    return {
      detected: true,
      confidence: best.confidence,
      reason: best.reason,
      coingeckoId: best.asset.id,
      baseSymbol: best.asset.symbol,
      quoteSymbol: 'USD',
      vsCurrency: 'usd',
      metric,
    };
  }

  const searchTerms = extractCryptoSearchTerms(input, categoryHint);
  let dynamicBest: {
    candidate: CoinGeckoSearchCandidate;
    confidence: number;
    reason: string;
  } | null = null;

  const searchResults = await Promise.allSettled(
    searchTerms.map((term) => searchCoinGeckoAssets(term, 5)),
  );

  for (const [index, result] of searchResults.entries()) {
    if (result.status !== 'fulfilled') continue;

    const term = searchTerms[index];
    const candidate = result.value.candidates[0];
    if (!candidate) continue;

    const confidence = scoreDynamicCryptoCandidate(term, candidate, categoryHint);
    if (!dynamicBest || confidence > dynamicBest.confidence) {
      dynamicBest = {
        candidate,
        confidence,
        reason: `Resolved ${candidate.symbol} from CoinGecko search for "${term}"`,
      };
    }
  }

  const dynamicBestConfidence = dynamicBest?.confidence ?? 0;

  const dynamicAcceptanceThreshold = categoryHint ? 0.6 : 0.72;

  if (!dynamicBest || dynamicBestConfidence < dynamicAcceptanceThreshold) {
    return {
      detected: false,
      confidence: Math.max(best?.confidence ?? 0, dynamicBestConfidence),
      reason: 'No strong crypto pair detected from market text.',
      coingeckoId: null,
      baseSymbol: null,
      quoteSymbol: 'USD',
      vsCurrency: 'usd',
      metric,
    };
  }

  return {
    detected: true,
    confidence: dynamicBest.confidence,
    reason: dynamicBest.reason,
    coingeckoId: dynamicBest.candidate.id,
    baseSymbol: dynamicBest.candidate.symbol,
    quoteSymbol: 'USD',
    vsCurrency: 'usd',
    metric,
  };
}

function cleanTeamName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\bathletico\b/gi, 'atletico')
    .replace(/\s[–—-]\s.*$/g, ' ')
    .replace(/\(([^)]*)\)/g, ' ')
    .replace(/\b(first|second)\s+leg\b/gi, ' ')
    .replace(/\bleg\s*(1|2)\b/gi, ' ')
    .replace(/\b(round of 16|round of sixteen|quarter[\s-]?finals?|semi[\s-]?finals?|play[\s-]?offs?|group stage)\b/gi, ' ')
    .replace(/\b(paris saint germain|paris st germain|psg)\b/gi, 'Paris SG')
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

  const segments = splitTitleSegments(compact);

  // First, try matching patterns on segments
  for (const segment of segments) {
    for (const pattern of patterns) {
      const match = segment.match(pattern);
      if (!match) continue;
      let home, away;
      if (pattern.source.includes('@')) {
        home = cleanTeamName(match[2]);
        away = cleanTeamName(match[1]);
      } else {
        home = cleanTeamName(match[1]);
        away = cleanTeamName(match[2]);
      }
      if (home && away && home.toLowerCase() !== away.toLowerCase()) {
        return { home, away };
      }
    }
  }

  // If no match on segments, try on compact with leading qualifiers stripped
  const stripped = compact.replace(/^[^:]+:\s*/, '');
  if (stripped !== compact) {
    for (const pattern of patterns) {
      const match = stripped.match(pattern);
      if (!match) continue;
      let home, away;
      if (pattern.source.includes('@')) {
        home = cleanTeamName(match[2]);
        away = cleanTeamName(match[1]);
      } else {
        home = cleanTeamName(match[1]);
        away = cleanTeamName(match[2]);
      }
      if (home && away && home.toLowerCase() !== away.toLowerCase()) {
        return { home, away };
      }
    }
  }

  // Fall back to the segment combination approach
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
  // Use matchScore if available (more accurate)
  if (candidate.matchScore !== undefined) {
    const base = scoreSportsCandidate(candidate);
    return candidate.matchScore * 0.6 + base * 0.4;
  }

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
  if (candidate.status === 'live') return 1;
  if (!Number.isFinite(kickoffMs)) return candidate.status === 'finished' ? 0.15 : 0;

  const hoursFromNow = (kickoffMs - Date.now()) / (1000 * 60 * 60);
  const absHours = Math.abs(hoursFromNow);

  if (candidate.status === 'scheduled') {
    if (hoursFromNow >= -1) {
      if (hoursFromNow < 6) return 1;
      if (hoursFromNow < 24) return 0.94;
      if (hoursFromNow < 72) return 0.86;
      if (hoursFromNow < 14 * 24) return 0.72;
      return 0.58;
    }
    return absHours < 24 ? 0.15 : 0.05;
  }

  if (candidate.status === 'finished') {
    if (absHours < 6) return 0.4;
    if (absHours < 24) return 0.25;
    return 0.12;
  }

  if (absHours < 24) return 0.5;
  if (absHours < 72) return 0.38;
  return 0.25;
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

  // Calculate match score if fallback pair is provided
  let matchScore = 0.5;
  if (fallbackPair) {
    matchScore = teamsMatch(homeTeam, awayTeam, fallbackPair.home, fallbackPair.away);
  }

  return {
    eventId,
    leagueName: typeof event?.strLeague === 'string' ? event.strLeague : input.category || 'Sports',
    homeTeam,
    awayTeam,
    kickoffAt,
    status: status.status,
    statusLabel: status.statusLabel,
    matchScore,
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
  if (!normalizedQuery || normalizedQuery.length < 2) return [];

  const endpoint = sportsDbUrl(`searchevents.php?e=${encodeURIComponent(normalizeSportsSearchText(normalizedQuery).replace(/\s+/g, '_'))}`);
  const json = await fetchJsonWithTimeout(endpoint);
  const events = Array.isArray(json?.event) ? json.event : [];
  const candidates = events
    .map((event: any) => mapEventToSportsCandidate(event, input, fallbackPair))
    .filter((candidate: SportsCandidate | null): candidate is SportsCandidate => candidate !== null);

  return candidates.filter((candidate: SportsCandidate) => fallbackPair ? (candidate.matchScore ?? 0) >= 0.55 : (candidate.matchScore ?? 0) > 0.3);
}

function normalizeSportsSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\bathletico\b/gi, 'atletico')
    .replace(/[–—-]/g, ' ')
    .replace(/[|:,;()\[\]{}]/g, ' ')
    .replace(/\b(friendly|qualifier|qualifying|prediction|market|odds|line)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildSportsQueryVariants(title: string, teamPair: { home: string; away: string } | null): string[] {
  const list: string[] = [];
  const push = (value: string) => {
    const clean = normalizeSportsSearchText(value);
    if (!clean) return;
    if (clean.length < 2) return;
    list.push(clean);
  };

  if (teamPair) {
    push(`${teamPair.home} vs ${teamPair.away}`);
    push(`${teamPair.away} vs ${teamPair.home}`);
    push(`${teamPair.home} ${teamPair.away}`);
    push(`${teamPair.home}`);
    push(`${teamPair.away}`);
  }

  push(title);

  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped.slice(0, 7);
}

async function detectSports(input: SuggestRequest) {
  const categoryHint = /(sport|soccer|football|nba|nfl|mlb|tennis|match|game|league)/i.test(input.category);
  const titleTeams = extractTeamsFromTitle(input.title);
  const outcomeTeams = extractTeamsFromOutcomes(input.outcomeLabels);
  const teamPair = titleTeams || outcomeTeams;

  let candidates: SportsCandidate[] = [];

  if (teamPair) {
    const queries = buildSportsQueryVariants(input.title.trim(), teamPair);

    const settled = await Promise.allSettled(
      queries.map((query) => fetchSportsCandidatesByQuery(query, input, teamPair)),
    );
    const fetchedGroups = settled
      .filter((r): r is PromiseFulfilledResult<SportsCandidate[]> => r.status === 'fulfilled')
      .map((r) => r.value);

    candidates = dedupeSportsCandidates(fetchedGroups.flat())
      .sort((a, b) => enrichSportsCandidateScore(b, teamPair) - enrichSportsCandidateScore(a, teamPair))
      .slice(0, 5);
  } else if (categoryHint && input.title.trim()) {
    const queries = buildSportsQueryVariants(input.title.trim(), null);
    const settled = await Promise.allSettled(
      queries.map((query) => fetchSportsCandidatesByQuery(query, input, null)),
    );
    const titleOnlyCandidates = settled
      .filter((r): r is PromiseFulfilledResult<SportsCandidate[]> => r.status === 'fulfilled')
      .map((r) => r.value)
      .flat();
    candidates = dedupeSportsCandidates(titleOnlyCandidates)
      .sort((a, b) => scoreSportsCandidate(b) - scoreSportsCandidate(a))
      .slice(0, 5);
  }

  if (teamPair && candidates.length === 0) {
    return {
      detected: false,
      confidence: 0,
      reason: 'Teams detected but no matching events found; please enter Event ID or review.',
      homeTeam: teamPair.home,
      awayTeam: teamPair.away,
      selectedEventId: null,
      selectedLeagueName: null,
      candidates: [],
    };
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
    return {
      detected: true,
      confidence: 0.3,
      reason: 'Found sports event candidates from market title. Review and confirm before saving.',
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Wallet-Address, X-Timestamp, X-Signature');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') return res.status(200).json({ ok: true });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    let address = '';
    let timestamp = 0;
    let signature = '';
    let signed = false;

    let rawBody = req.body;
    if (typeof rawBody === 'string') {
      try {
        rawBody = JSON.parse(rawBody);
        req.body = rawBody;
      } catch {
        return res.status(400).json({ error: 'Invalid JSON' });
      }
    }

    try {
      const extracted = extractSignedHeaders(req);
      address = extracted.address;
      timestamp = extracted.timestamp;
      signature = extracted.signature;
      signed = !!(address && signature);
    } catch (headerErr: any) {
      const walletHeader = req.headers?.['x-wallet-address'] || req.body?.address;
      const signatureHeader = req.headers?.['x-signature'] || req.body?.signature;
      const hasWalletHeader = typeof walletHeader === 'string' && walletHeader.trim().length > 0;
      const hasSignatureHeader = typeof signatureHeader === 'string' && signatureHeader.trim().length > 0;

      if (!hasWalletHeader && !hasSignatureHeader) {
        signed = false;
      } else {
        return res.status(400).json({ error: headerErr?.message || 'Invalid signing headers' });
      }
    }

    if (signed) {
      let canonicalBody: Record<string, any> = {};
      if (typeof rawBody === 'object' && rawBody !== null) {
        canonicalBody = { ...rawBody };
      } else if (rawBody === undefined || rawBody === null) {
        canonicalBody = {};
      } else {
        return res.status(400).json({ error: 'Invalid request body type' });
      }

      delete canonicalBody.address;
      delete canonicalBody.timestamp;
      delete canonicalBody.signature;

      const message = [
        'AchMarket Live Feed Suggest',
        `Address: ${address}`,
        `Timestamp: ${timestamp}`,
        `Body: ${JSON.stringify(canonicalBody)}`,
      ].join('\n');

      try {
        verifySignedMessage(address, timestamp, signature, message);
      } catch (sigErr: any) {
        const msg = sigErr?.message || '';
        const isTimestampOrMalformed = 
          msg.includes('timestamp') || 
          msg.includes('Timestamp') || 
          msg.includes('Signature expired') || 
          msg.includes('Invalid signature format') ||
          msg.includes('required');
          
        if (isTimestampOrMalformed) {
          return res.status(400).json({ error: msg });
        } else if (msg.includes('Invalid signature for wallet address')) {
          return res.status(401).json({ error: msg });
        }
        return res.status(500).json({ error: msg || 'Internal signature error' });
      }
    }

    const input = parseRequestBody(rawBody);
    if (!input.title) {
      return res.status(400).json({ error: 'title is required' });
    }

    const [crypto, sports] = await Promise.all([detectCrypto(input), detectSports(input)]);

    return res.status(200).json({ crypto, sports });
  } catch (err: any) {
    if (err instanceof ValidationError) {
      return res.status(400).json({ error: err.message });
    }

    const msg = err?.message || 'Unexpected error';
    const lower = msg.toLowerCase();

    // Auth/signature failures
    if (lower.includes('expired') || lower.includes('invalid signature for wallet')) {
      return res.status(401).json({ error: msg });
    }
    // Malformed header/validation problems
    if (lower.includes('wallet address') || lower.includes('signature') || lower.includes('timestamp') || lower.includes('invalid')) {
      return res.status(400).json({ error: msg });
    }

    return res.status(500).json({ error: msg });
  }
}
