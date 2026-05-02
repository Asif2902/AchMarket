import { getAddress, Contract, JsonRpcProvider } from 'ethers';
import { MongoClient, type Collection } from 'mongodb';
import { sportsDbUrl, teamsMatch } from './_sportsdb.js';
import { normalizeSportsStatus } from './_sports-status.js';

const LIVE_FEEDS_COLLECTION = 'live_feeds';
const MONGO_URI = process.env.MONGO_URI;
const MONGO_DB_NAME = process.env.MONGO_DB_NAME ?? 'achmarket';
const RPC_URL_RAW = process.env.RPC_URL;
let RPC_URL: string;
if (!RPC_URL_RAW && process.env.NODE_ENV === 'production') {
  throw new Error('RPC_URL is required in production. Configure RPC_URL with a valid URL.');
}
if (RPC_URL_RAW) {
  RPC_URL = RPC_URL_RAW;
} else {
  console.warn('RPC_URL not set, using default testnet URL. This is only appropriate for development.');
  RPC_URL = 'https://arc-testnet.drpc.org/';
}
const CORS_ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const FETCH_TIMEOUT_MS = 8000;
const CRYPTO_STALE_SECONDS = 60;
const SPORTS_STALE_SECONDS = 120;
const CRYPTO_MIN_REFRESH_SECONDS = 10;
const SPORTS_MIN_REFRESH_SECONDS = 15;
const CLOSED_MARKET_POLL_SECONDS = 3600;

const MARKET_STAGE_ABI = ['function stage() view returns (uint8)'];
const STAGE_ACTIVE = 0;
const STAGE_SUSPENDED = 1;
const STAGE_RESOLVED = 2;
const STAGE_CANCELLED = 3;
const STAGE_EXPIRED = 4;
const MARKET_STAGE_CACHE_MS = 15_000;

type LiveFeedKind = 'crypto-price' | 'sports-score';
type LiveCryptoMetric = 'price' | 'market-cap' | 'volume-24h';
type EffectiveStatus = 'upcoming' | 'live' | 'finished' | 'postponed' | 'cancelled' | 'unknown';

interface LiveCryptoDoc {
  coingeckoId: string;
  baseSymbol: string;
  quoteSymbol: string;
  vsCurrency: string;
  metric?: LiveCryptoMetric;
}

interface LiveSportsDoc {
  eventId: string;
  leagueName: string;
  homeTeam?: string;
  awayTeam?: string;
  forceUpcoming?: boolean;
}

interface LiveFeedDoc {
  marketAddress: string;
  enabled: boolean;
  kind: LiveFeedKind;
  crypto: LiveCryptoDoc | null;
  sports: LiveSportsDoc | null;
  createdAt?: Date;
  lastSnapshot?: CachedLiveSnapshot | null;
  lastSnapshotAt?: Date | null;
  updatedAt: Date;
  updatedBy: string;
}

interface LiveCryptoData {
  kind: 'crypto-price';
  provider: string;
  providerRef: string;
  baseSymbol: string;
  quoteSymbol: string;
  metric: LiveCryptoMetric;
  price: number;
  change24h: number | null;
  marketCap: number | null;
  volume24h: number | null;
}

interface LiveSportsData {
  kind: 'sports-score';
  provider: string;
  providerRef: string;
  leagueName: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  status: string;
  statusLabel: string;
  kickoffAt: string | null;
}

type LiveMarketData = LiveCryptoData | LiveSportsData;

interface CachedLiveSnapshot {
  asOf: string;
  fetchedAt: string;
  nextSuggestedPollSeconds: number;
  data: LiveMarketData;
  effectiveStatus?: EffectiveStatus;
}

interface LiveConfiguredResponse {
  configured: true;
  stale: boolean;
  asOf: string;
  fetchedAt: string;
  nextSuggestedPollSeconds: number;
  data: LiveMarketData;
  effectiveStatus?: EffectiveStatus;
  refreshFailed?: boolean;
}

interface LiveUnconfiguredResponse {
  configured: false;
  reason?: string;
}

let indexesReady = false;
let cachedClient: MongoClient | null = null;
let cachedClientPromise: Promise<MongoClient> | null = null;
let cachedReadProvider: JsonRpcProvider | null = null;
const marketStageCache = new Map<string, { stage: number; expiresAt: number }>();
const inFlight = new Map<string, Promise<CachedLiveSnapshot>>();

function normalizeAddress(address: string): string {
  return getAddress(address).toLowerCase();
}

function resolveCorsOrigin(originHeader: unknown): string | null {
  if (process.env.NODE_ENV !== 'production') return '*';
  if (typeof originHeader !== 'string' || !originHeader) return null;
  if (CORS_ALLOWED_ORIGINS.includes('*')) return originHeader;
  return CORS_ALLOWED_ORIGINS.includes(originHeader) ? originHeader : null;
}

function getRequiredRpcUrl(): string {
  try {
    new URL(RPC_URL);
  } catch {
    throw new Error('RPC_URL is invalid. Configure RPC_URL with a valid URL.');
  }
  return RPC_URL;
}

function getReadProvider(): JsonRpcProvider {
  if (!cachedReadProvider) {
    cachedReadProvider = new JsonRpcProvider(getRequiredRpcUrl(), undefined, { staticNetwork: true, batchMaxCount: 1 });
  }
  return cachedReadProvider;
}

function isClosedStage(stage: number): boolean {
  return stage === STAGE_RESOLVED || stage === STAGE_CANCELLED || stage === STAGE_EXPIRED;
}

function isLiveStage(stage: number): boolean {
  return stage === STAGE_ACTIVE || stage === STAGE_SUSPENDED;
}

function cleanupStageCache(): void {
  if (marketStageCache.size < 300) return;
  const now = Date.now();
  for (const [address, entry] of marketStageCache.entries()) {
    if (entry.expiresAt <= now) {
      marketStageCache.delete(address);
    }
  }
}

async function getMarketStage(marketAddress: string): Promise<number | null> {
  const now = Date.now();
  const cached = marketStageCache.get(marketAddress);
  if (cached && cached.expiresAt > now) {
    return cached.stage;
  }

  const market = new Contract(marketAddress, MARKET_STAGE_ABI, getReadProvider());
  const stageValue = Number(await market.stage());
  if (!Number.isFinite(stageValue)) return null;
  marketStageCache.set(marketAddress, {
    stage: stageValue,
    expiresAt: now + MARKET_STAGE_CACHE_MS,
  });
  cleanupStageCache();
  return stageValue;
}

async function getCollection(): Promise<Collection<LiveFeedDoc>> {
  const client = await getMongoClient();
  const collection = client.db(MONGO_DB_NAME).collection<LiveFeedDoc>(LIVE_FEEDS_COLLECTION);
  if (!indexesReady) {
    await collection.createIndex({ marketAddress: 1 }, { unique: true, name: 'uniq_market_address' });
    indexesReady = true;
  }
  return collection;
}

async function getMongoClient(): Promise<MongoClient> {
  if (!MONGO_URI) {
    throw new Error('MONGO_URI is not configured');
  }

  if (cachedClient) {
    try {
      await cachedClient.db(MONGO_DB_NAME).command({ ping: 1 });
      return cachedClient;
    } catch {
      try {
        await cachedClient?.close();
      } catch {
        // ignore close errors
      }
      cachedClient = null;
      cachedClientPromise = null;
      indexesReady = false;
    }
  }

  if (cachedClientPromise) {
    return cachedClientPromise;
  }

  cachedClientPromise = (async () => {
    try {
      const client = new MongoClient(MONGO_URI!, {
        maxPoolSize: 4,
        serverSelectionTimeoutMS: 10000,
        connectTimeoutMS: 10000,
      });
      await client.connect();
      cachedClient = client;
      return client;
    } catch (err) {
      cachedClientPromise = null;
      throw err;
    }
  })();

  return cachedClientPromise;
}

async function getFeedConfig(marketAddress: string): Promise<LiveFeedDoc | null> {
  const collection = await getCollection();
  return collection.findOne({ marketAddress });
}

function nowIso(): string {
  return new Date().toISOString();
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    if (value.trim() === '') return null;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function parseOptionalScore(value: unknown): number | null {
  const numeric = toFiniteNumber(value);
  if (numeric === null) return null;
  return Math.max(0, Math.trunc(numeric));
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

function getStaleThresholdSeconds(kind: LiveFeedKind): number {
  return kind === 'crypto-price' ? CRYPTO_STALE_SECONDS : SPORTS_STALE_SECONDS;
}

function getMinRefreshSeconds(kind: LiveFeedKind): number {
  return kind === 'crypto-price' ? CRYPTO_MIN_REFRESH_SECONDS : SPORTS_MIN_REFRESH_SECONDS;
}

function isSnapshotStale(snapshot: CachedLiveSnapshot): boolean {
  const fetchedAtMs = Date.parse(snapshot.fetchedAt);
  if (!Number.isFinite(fetchedAtMs)) return true;
  const ageSeconds = (Date.now() - fetchedAtMs) / 1000;
  const threshold = getStaleThresholdSeconds(snapshot.data.kind);
  return ageSeconds > threshold;
}

function buildConfiguredResponse(snapshot: CachedLiveSnapshot, stale: boolean, refreshFailed?: boolean): LiveConfiguredResponse {
  return {
    configured: true,
    stale,
    asOf: snapshot.asOf,
    fetchedAt: snapshot.fetchedAt,
    nextSuggestedPollSeconds: snapshot.nextSuggestedPollSeconds,
    data: snapshot.data,
    effectiveStatus: snapshot.effectiveStatus,
    ...(refreshFailed !== undefined ? { refreshFailed } : {}),
  };
}



async function fetchCryptoSnapshot(config: LiveFeedDoc): Promise<CachedLiveSnapshot> {
  if (!config.crypto) throw new Error('Crypto feed config is missing.');

  const id = config.crypto.coingeckoId.trim().toLowerCase();
  const vs = config.crypto.vsCurrency.trim().toLowerCase();
  const metric: LiveCryptoMetric = config.crypto.metric || 'price';
  const endpoint = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=${encodeURIComponent(vs)}&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`;
  const json = await fetchJsonWithTimeout(endpoint);

  const coin = json?.[id];
  const price = toFiniteNumber(coin?.[vs]);
  const change24h = toFiniteNumber(coin?.[`${vs}_24h_change`]);
  const marketCap = toFiniteNumber(coin?.[`${vs}_market_cap`]);
  const volume24h = toFiniteNumber(coin?.[`${vs}_24h_vol`]);
  if (price === null) {
    throw new Error('CoinGecko returned no price for this pair.');
  }

  const fetchedAt = nowIso();
  return {
    asOf: fetchedAt,
    fetchedAt,
    nextSuggestedPollSeconds: CRYPTO_MIN_REFRESH_SECONDS,
    data: {
      kind: 'crypto-price',
      provider: 'CoinGecko',
      providerRef: id,
      baseSymbol: config.crypto.baseSymbol,
      quoteSymbol: config.crypto.quoteSymbol,
      metric,
      price,
      change24h,
      marketCap,
      volume24h,
    },
  };
}

async function fetchSportsSnapshot(config: LiveFeedDoc): Promise<CachedLiveSnapshot> {
  if (!config.sports) throw new Error('Sports feed config is missing.');

  const eventId = config.sports.eventId.trim();
  const endpoint = sportsDbUrl(`lookupevent.php?id=${encodeURIComponent(eventId)}`);
  const json = await fetchJsonWithTimeout(endpoint);
  const event = Array.isArray(json?.events) ? json.events[0] : null;
  if (!event) {
    throw new Error('Sports event not found for this eventId.');
  }

  const returnedEventId = typeof event?.idEvent === 'string' ? event.idEvent.trim() : '';
  if (returnedEventId && returnedEventId !== eventId) {
    throw new Error(`Sports event mismatch: requested "${eventId}" but provider returned "${returnedEventId}".`);
  }

  // Validate that returned event matches expected teams
  const returnedHome = typeof event?.strHomeTeam === 'string' ? event.strHomeTeam : '';
  const returnedAway = typeof event?.strAwayTeam === 'string' ? event.strAwayTeam : '';
  const expectedHome = config.sports.homeTeam || '';
  const expectedAway = config.sports.awayTeam || '';

  if (expectedHome && expectedAway &&
      teamsMatch(returnedHome, returnedAway, expectedHome, expectedAway) < 0.8) {
    throw new Error(`Event data mismatch: expected "${expectedHome} vs ${expectedAway}", but got "${returnedHome} vs ${returnedAway}". The eventId may be incorrect.`);
  }

  const statusRaw = typeof event.strStatus === 'string' ? event.strStatus : '';
  const status = normalizeSportsStatus(statusRaw);
  const kickoffRaw = typeof event.strTimestamp === 'string' ? event.strTimestamp : '';
  const kickoffAt = kickoffRaw && Number.isFinite(Date.parse(kickoffRaw)) ? new Date(kickoffRaw).toISOString() : null;

  let effectiveStatus: EffectiveStatus | undefined;

  // If forceUpcoming is set, show as upcoming only if match hasn't started yet
  if (config.sports.forceUpcoming && status.status === 'scheduled' && kickoffAt) {
    const kickoffTime = new Date(kickoffAt).getTime();
    const now = Date.now();
    effectiveStatus = kickoffTime > now ? 'upcoming' : 'live';
  } else if (config.sports.forceUpcoming) {
    // forceUpcoming is set but match is no longer scheduled (live/finished/etc.) - use actual status
    // Map 'scheduled' to 'upcoming' since it's not a valid EffectiveStatus
    effectiveStatus = status.status === 'scheduled' ? 'upcoming' : status.status as EffectiveStatus;
  } else if (status.status === 'scheduled') {
    if (kickoffAt) {
      const kickoffTime = new Date(kickoffAt).getTime();
      const now = Date.now();
      effectiveStatus = kickoffTime > now ? 'upcoming' : 'live';
    } else {
      effectiveStatus = 'upcoming';
    }
  } else {
    effectiveStatus = status.status as EffectiveStatus;
  }

  const fetchedAt = nowIso();
  return {
    asOf: fetchedAt,
    fetchedAt,
    nextSuggestedPollSeconds: SPORTS_MIN_REFRESH_SECONDS,
    effectiveStatus,
    data: {
      kind: 'sports-score',
      provider: 'TheSportsDB',
      providerRef: eventId,
      leagueName: config.sports.leagueName || (typeof event.strLeague === 'string' ? event.strLeague : ''),
      homeTeam: returnedHome || 'Home',
      awayTeam: returnedAway || 'Away',
      homeScore: parseOptionalScore(event.intHomeScore),
      awayScore: parseOptionalScore(event.intAwayScore),
      status: status.status,
      statusLabel: status.statusLabel,
      kickoffAt,
    },
  };
}

async function fetchFreshSnapshot(config: LiveFeedDoc): Promise<CachedLiveSnapshot> {
  if (config.kind === 'crypto-price') {
    return fetchCryptoSnapshot(config);
  }
  return fetchSportsSnapshot(config);
}

async function fetchSharedFreshSnapshot(config: LiveFeedDoc): Promise<CachedLiveSnapshot> {
  const key = `${config.marketAddress}:${config.updatedAt.toISOString()}`;
  const existing = inFlight.get(key);
  if (existing) {
    return existing;
  }

  const promise = fetchFreshSnapshot(config).finally(() => {
    inFlight.delete(key);
  });

  inFlight.set(key, promise);
  return promise;
}

function normalizeMarketAddressInput(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error('marketAddress query parameter is required.');
  }
  try {
    return normalizeAddress(raw.trim());
  } catch {
    throw new Error('marketAddress is invalid.');
  }
}

async function resolveLiveData(
  marketAddress: string,
  allowConfigRefreshRetry = true,
): Promise<LiveConfiguredResponse | LiveUnconfiguredResponse> {
  const config = await getFeedConfig(marketAddress);
  if (!config) {
    return { configured: false, reason: 'This market does not use an external reference feed.' };
  }
  if (!config.enabled) {
    return { configured: false, reason: 'Live feed is disabled for this market.' };
  }

  const marketStage = await getMarketStage(marketAddress);
  const marketIsClosed = typeof marketStage === 'number' ? isClosedStage(marketStage) : true;
  const marketIsLiveOrUnknown = typeof marketStage === 'number' ? isLiveStage(marketStage) : false;

  const cachedSnapshot = config.lastSnapshot || null;
  const cachedAt = config.lastSnapshotAt instanceof Date ? config.lastSnapshotAt : null;
  const isParityMatch = cachedSnapshot ? cachedSnapshot.data.kind === config.kind : false;

  if (marketIsClosed) {
    if (cachedSnapshot && isParityMatch) {
      const frozenSnapshot: CachedLiveSnapshot = {
        ...cachedSnapshot,
        nextSuggestedPollSeconds: CLOSED_MARKET_POLL_SECONDS,
      };
      return buildConfiguredResponse(frozenSnapshot, true);
    }
    return {
      configured: false,
      reason: 'Market is resolved/cancelled, so live updates are locked.',
    };
  }

  if (cachedSnapshot && cachedAt && isParityMatch) {
    const ageSeconds = (Date.now() - cachedAt.getTime()) / 1000;
    if (ageSeconds < getMinRefreshSeconds(config.kind) && !isSnapshotStale(cachedSnapshot)) {
      return buildConfiguredResponse(cachedSnapshot, false);
    }
  }

  if (!marketIsLiveOrUnknown) {
    if (cachedSnapshot && isParityMatch) {
      return buildConfiguredResponse(cachedSnapshot, true);
    }
    return {
      configured: false,
      reason: 'Live updates are unavailable in current market stage.',
    };
  }

  try {
    const fresh = await fetchSharedFreshSnapshot(config);

    const collection = await getCollection();
    const updateResult = await collection.updateOne(
      { marketAddress, updatedAt: config.updatedAt },
      {
        $set: {
          lastSnapshot: fresh,
          lastSnapshotAt: new Date(),
        },
      },
    );

    if (updateResult.matchedCount === 0) {
      if (!allowConfigRefreshRetry) {
        const conflictErr: any = new Error('Live feed configuration changed during refresh. Retry request.');
        conflictErr.statusCode = 409;
        throw conflictErr;
      }
      return await resolveLiveData(marketAddress, false);
    }

    return buildConfiguredResponse(fresh, false);
  } catch (fetchErr: any) {
    const errMsg = fetchErr?.message || '';
    // Don't fall back to cache for validation errors (wrong event data)
    const isValidationError = errMsg.includes('Event data mismatch') || errMsg.includes('eventId may be incorrect') || errMsg.includes('Sports event mismatch');
    const isConfigRaceError = fetchErr?.statusCode === 409;
    if (cachedSnapshot && isParityMatch && !isValidationError && !isConfigRaceError) {
      return buildConfiguredResponse(cachedSnapshot, true, true);
    }
    throw fetchErr;
  }
}

export default async function handler(req: any, res: any) {
  const corsOrigin = resolveCorsOrigin(req.headers?.origin);
  if (corsOrigin) {
    res.setHeader('Access-Control-Allow-Origin', corsOrigin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') return res.status(200).json({ ok: true });
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const marketAddress = normalizeMarketAddressInput(req.query?.marketAddress);
    const data = await resolveLiveData(marketAddress);
    return res.status(200).json(data);
  } catch (err: any) {
    const msg = err?.message || 'Unexpected error';
    const lower = msg.toLowerCase();
    let code = 500;

    // Check for explicit status code on error object first
    if (err.statusCode && typeof err.statusCode === 'number') {
      code = err.statusCode;
    } else if (
      lower.includes('missing required')
      || lower.includes('is required')
      || lower.includes('required')
      || (lower.includes('field') && lower.includes('invalid'))
      || ((lower.includes('marketaddress') || lower.includes('market address')) && lower.includes('invalid'))
    ) {
      // Only mark as 400 if it's a specific field validation error
      code = 400;
    } else if (lower.includes('sports event mismatch') || lower.includes('event data mismatch') || lower.includes('mismatch')) {
      // Event/feed validation failures are client errors
      code = 400;
    } else if (lower.includes('not found') || lower.includes('no price') || lower.includes('returned no price')) {
      code = 404;
    } else if (lower.includes('timed out')) {
      code = 504;
    } else if (
      lower.includes('mongo_uri') ||
      lower.includes('rpc_url') ||
      lower.includes('provider') ||
      lower.includes('connection') ||
      lower.includes('network') ||
      lower.includes('timeout') ||
      lower.includes('econnrefused') ||
      lower.includes('econnreset') ||
      lower.includes('enotfound')
    ) {
      code = 503;
    }
    // Note: Generic "invalid" phrases like "RPC_URL is invalid" will correctly get 500

    console.error('live-market handler error', { code, message: msg, err });
    if (code >= 500) {
      return res.status(code).json({ error: 'Internal server error' });
    }
    return res.status(code).json({ error: msg });
  }
}
