import { getAddress } from 'ethers';
import type { Collection } from 'mongodb';
import { getMongoClient, MONGO_DB_NAME } from './_mongo';

const LIVE_FEEDS_COLLECTION = 'live_feeds';
const CORS_ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const FETCH_TIMEOUT_MS = 8000;
const CRYPTO_STALE_SECONDS = 60;
const SPORTS_STALE_SECONDS = 120;
const CRYPTO_MIN_REFRESH_SECONDS = 10;
const SPORTS_MIN_REFRESH_SECONDS = 15;

type LiveFeedKind = 'crypto-price' | 'sports-score';

interface LiveCryptoDoc {
  coingeckoId: string;
  baseSymbol: string;
  quoteSymbol: string;
  vsCurrency: string;
}

interface LiveSportsDoc {
  eventId: string;
  leagueName: string;
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
  price: number;
  change24h: number | null;
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
}

interface LiveConfiguredResponse {
  configured: true;
  stale: boolean;
  asOf: string;
  fetchedAt: string;
  nextSuggestedPollSeconds: number;
  data: LiveMarketData;
}

interface LiveUnconfiguredResponse {
  configured: false;
  reason?: string;
}

let indexesReady = false;

function normalizeAddress(address: string): string {
  return getAddress(address).toLowerCase();
}

function resolveCorsOrigin(originHeader: unknown): string | null {
  if (process.env.NODE_ENV !== 'production') return '*';
  if (typeof originHeader !== 'string' || !originHeader) return null;
  if (CORS_ALLOWED_ORIGINS.includes('*')) return originHeader;
  return CORS_ALLOWED_ORIGINS.includes(originHeader) ? originHeader : null;
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

function buildConfiguredResponse(snapshot: CachedLiveSnapshot, stale: boolean): LiveConfiguredResponse {
  return {
    configured: true,
    stale,
    asOf: snapshot.asOf,
    fetchedAt: snapshot.fetchedAt,
    nextSuggestedPollSeconds: snapshot.nextSuggestedPollSeconds,
    data: snapshot.data,
  };
}

function normalizeSportsStatus(statusRaw: string): { status: string; statusLabel: string } {
  const clean = statusRaw.trim();
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

async function fetchCryptoSnapshot(config: LiveFeedDoc): Promise<CachedLiveSnapshot> {
  if (!config.crypto) throw new Error('Crypto feed config is missing.');

  const id = config.crypto.coingeckoId.trim().toLowerCase();
  const vs = config.crypto.vsCurrency.trim().toLowerCase();
  const endpoint = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=${encodeURIComponent(vs)}&include_24hr_change=true`;
  const json = await fetchJsonWithTimeout(endpoint);

  const coin = json?.[id];
  const price = toFiniteNumber(coin?.[vs]);
  const change24h = toFiniteNumber(coin?.[`${vs}_24h_change`]);
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
      price,
      change24h,
    },
  };
}

async function fetchSportsSnapshot(config: LiveFeedDoc): Promise<CachedLiveSnapshot> {
  if (!config.sports) throw new Error('Sports feed config is missing.');

  const eventId = config.sports.eventId.trim();
  const endpoint = `https://www.thesportsdb.com/api/v1/json/3/lookupevent.php?id=${encodeURIComponent(eventId)}`;
  const json = await fetchJsonWithTimeout(endpoint);
  const event = Array.isArray(json?.events) ? json.events[0] : null;
  if (!event) {
    throw new Error('Sports event not found for this eventId.');
  }

  const statusRaw = typeof event.strStatus === 'string' ? event.strStatus : '';
  const status = normalizeSportsStatus(statusRaw);
  const kickoffRaw = typeof event.strTimestamp === 'string' ? event.strTimestamp : '';
  const kickoffAt = kickoffRaw && Number.isFinite(Date.parse(kickoffRaw)) ? new Date(kickoffRaw).toISOString() : null;

  const fetchedAt = nowIso();
  return {
    asOf: fetchedAt,
    fetchedAt,
    nextSuggestedPollSeconds: SPORTS_MIN_REFRESH_SECONDS,
    data: {
      kind: 'sports-score',
      provider: 'TheSportsDB',
      providerRef: eventId,
      leagueName: config.sports.leagueName || (typeof event.strLeague === 'string' ? event.strLeague : ''),
      homeTeam: typeof event.strHomeTeam === 'string' ? event.strHomeTeam : 'Home',
      awayTeam: typeof event.strAwayTeam === 'string' ? event.strAwayTeam : 'Away',
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

function normalizeMarketAddressInput(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error('marketAddress query parameter is required.');
  }
  return normalizeAddress(raw.trim());
}

async function resolveLiveData(marketAddress: string): Promise<LiveConfiguredResponse | LiveUnconfiguredResponse> {
  const config = await getFeedConfig(marketAddress);
  if (!config) {
    return { configured: false, reason: 'No live feed configured for this market.' };
  }
  if (!config.enabled) {
    return { configured: false, reason: 'Live feed is disabled for this market.' };
  }

  const cachedSnapshot = config.lastSnapshot || null;
  const cachedAt = config.lastSnapshotAt instanceof Date ? config.lastSnapshotAt : null;
  if (cachedSnapshot && cachedAt) {
    const ageSeconds = (Date.now() - cachedAt.getTime()) / 1000;
    if (ageSeconds < getMinRefreshSeconds(config.kind) && !isSnapshotStale(cachedSnapshot)) {
      return buildConfiguredResponse(cachedSnapshot, false);
    }
  }

  try {
    const fresh = await fetchFreshSnapshot(config);

    const collection = await getCollection();
    await collection.updateOne(
      { marketAddress },
      {
        $set: {
          lastSnapshot: fresh,
          lastSnapshotAt: new Date(),
        },
      },
    );

    return buildConfiguredResponse(fresh, false);
  } catch (fetchErr) {
    if (cachedSnapshot) {
      return buildConfiguredResponse(cachedSnapshot, true);
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
    if (lower.includes('required') || lower.includes('invalid')) code = 400;
    else if (lower.includes('not found')) code = 404;
    else if (lower.includes('timed out')) code = 504;
    else if (lower.includes('mongo_uri') || lower.includes('enotfound')) code = 503;
    return res.status(code).json({ error: msg });
  }
}
