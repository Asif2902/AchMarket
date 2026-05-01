import { hashMessage, getAddress, Contract, JsonRpcProvider } from 'ethers';
import { MongoClient, type Collection } from 'mongodb';
import { extractSignedHeaders, verifySignedMessage, SIG_VALIDITY_MS, serializeLiveFeedPayload } from './_signature';

const LIVE_FEEDS_COLLECTION = 'live_feeds';

const FACTORY_OWNER_ABI = [
  'function owner() view returns (address)',
  'function isMarket(address) view returns (bool)',
];

type LiveFeedKind = 'crypto-price' | 'sports-score';
type LiveCryptoMetric = 'price' | 'market-cap' | 'volume-24h';

interface LiveCryptoDoc {
  coingeckoId: string;
  baseSymbol: string;
  quoteSymbol: string;
  vsCurrency: string;
  metric: LiveCryptoMetric;
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
  lastSnapshot?: unknown;
  lastSnapshotAt?: Date | null;
  updatedAt: Date;
  updatedBy: string;
}

interface LiveFeedPayload {
  marketAddress: string;
  enabled: boolean;
  kind: LiveFeedKind;
  crypto?: {
    coingeckoId?: unknown;
    baseSymbol?: unknown;
    quoteSymbol?: unknown;
    vsCurrency?: unknown;
    metric?: unknown;
  } | null;
  sports?: {
    eventId?: unknown;
    leagueName?: unknown;
    homeTeam?: unknown;
    awayTeam?: unknown;
    forceUpcoming?: unknown;
  } | null;
}

let indexesReady = false;
let cachedClient: MongoClient | null = null;
let cachedReadProvider: JsonRpcProvider | null = null;
let cachedFactoryContract: Contract | null = null;

function normalizeAddress(address: string): string {
  return getAddress(address).toLowerCase();
}

function resolveCorsOrigin(originHeader: unknown): string | null {
  if (process.env.NODE_ENV !== 'production') return '*';
  if (typeof originHeader !== 'string' || !originHeader) return null;
  if (CORS_ALLOWED_ORIGINS.includes('*')) return originHeader;
  return CORS_ALLOWED_ORIGINS.includes(originHeader) ? originHeader : null;
}

function parseBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  return false;
}

function parseTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function sanitizeSymbol(value: string): string {
  return value.trim().toUpperCase();
}

function sanitizePayload(input: LiveFeedPayload): LiveFeedPayload {
  const marketAddress = normalizeAddress(parseTrimmedString(input.marketAddress));
  const enabled = parseBoolean(input.enabled);
  const kind: LiveFeedKind = input.kind === 'sports-score' ? 'sports-score' : 'crypto-price';

  if (kind === 'crypto-price') {
    const coingeckoId = parseTrimmedString(input.crypto?.coingeckoId).toLowerCase();
    const baseSymbol = sanitizeSymbol(parseTrimmedString(input.crypto?.baseSymbol));
    const quoteSymbol = sanitizeSymbol(parseTrimmedString(input.crypto?.quoteSymbol));
    const vsCurrency = parseTrimmedString(input.crypto?.vsCurrency).toLowerCase();
    const metricRaw = parseTrimmedString(input.crypto?.metric).toLowerCase();
    const metric: LiveCryptoMetric =
      metricRaw === 'market-cap'
        ? 'market-cap'
        : metricRaw === 'volume-24h'
          ? 'volume-24h'
          : 'price';

    if (!coingeckoId) throw new Error('coingeckoId is required for crypto feeds.');
    if (!baseSymbol) throw new Error('baseSymbol is required for crypto feeds.');
    if (!quoteSymbol) throw new Error('quoteSymbol is required for crypto feeds.');
    if (!vsCurrency) throw new Error('vsCurrency is required for crypto feeds.');

    return {
      marketAddress,
      enabled,
      kind,
      crypto: { coingeckoId, baseSymbol, quoteSymbol, vsCurrency, metric },
      sports: null,
    };
  }

  const eventId = parseTrimmedString(input.sports?.eventId);
  const leagueName = parseTrimmedString(input.sports?.leagueName);
  const homeTeam = parseTrimmedString(input.sports?.homeTeam);
  const awayTeam = parseTrimmedString(input.sports?.awayTeam);
  const forceUpcoming = Boolean(input.sports?.forceUpcoming);

  if (!eventId) throw new Error('eventId is required for sports feeds.');
  if (!leagueName) throw new Error('leagueName is required for sports feeds.');

  return {
    marketAddress,
    enabled,
    kind,
    crypto: null,
    sports: { eventId, leagueName, homeTeam: homeTeam || undefined, awayTeam: awayTeam || undefined, forceUpcoming },
  };
}

async function getCollection(): Promise<Collection<LiveFeedDoc>> {
  const client = await getMongoClient();
  const collection = client.db(MONGO_DB_NAME).collection<LiveFeedDoc>(LIVE_FEEDS_COLLECTION);
  if (!indexesReady) {
    await collection.createIndex({ marketAddress: 1 }, { unique: true, name: 'uniq_market_address' });
    await collection.createIndex({ updatedAt: -1 }, { name: 'idx_updated_at' });
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
        await cachedClient.close();
      } catch {
        // ignore close errors
      }
      cachedClient = null;
      indexesReady = false;
    }
  }

  cachedClient = new MongoClient(MONGO_URI, {
    maxPoolSize: 4,
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000,
  });

  await cachedClient.connect();
  return cachedClient;
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

function getFactoryContract(): Contract {
  if (!cachedFactoryContract) {
    cachedFactoryContract = new Contract(FACTORY_ADDRESS, FACTORY_OWNER_ABI, getReadProvider());
  }
  return cachedFactoryContract;
}

async function assertOwnerAddress(address: string): Promise<void> {
  const ownerOnChain = normalizeAddress(await getFactoryContract().owner());
  if (ownerOnChain !== address) {
    throw new Error('Only the factory owner can manage live feed configs.');
  }
}

async function assertKnownMarket(marketAddress: string): Promise<void> {
  const exists = await getFactoryContract().isMarket(marketAddress);
  if (!exists) {
    throw new Error('Unknown market address.');
  }
}

function toResponseConfig(doc: LiveFeedDoc | null) {
  if (!doc) return null;
  return {
    marketAddress: doc.marketAddress,
    enabled: doc.enabled,
    kind: doc.kind,
    crypto: doc.crypto,
    sports: doc.sports ? {
      eventId: doc.sports.eventId,
      leagueName: doc.sports.leagueName,
      homeTeam: doc.sports.homeTeam,
      awayTeam: doc.sports.awayTeam,
      forceUpcoming: doc.sports.forceUpcoming,
    } : null,
    updatedAt: doc.updatedAt.toISOString(),
    updatedBy: doc.updatedBy,
  };
}

async function listConfigsByMarkets(raw: unknown): Promise<LiveFeedDoc[]> {
  if (typeof raw !== 'string') return [];
  const parts = raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (!parts.length) return [];

  const normalized = Array.from(new Set(parts.map((item) => normalizeAddress(item))));
  if (!normalized.length) return [];

  const collection = await getCollection();
  return collection.find({ marketAddress: { $in: normalized } }).toArray();
}

async function getSingleConfig(rawMarketAddress: unknown): Promise<LiveFeedDoc | null> {
  if (typeof rawMarketAddress !== 'string' || !rawMarketAddress.trim()) return null;
  const marketAddress = normalizeAddress(rawMarketAddress.trim());
  const collection = await getCollection();
  return collection.findOne({ marketAddress });
}

async function upsertConfig(address: string, payloadRaw: unknown) {
  const payload = sanitizePayload((payloadRaw || {}) as LiveFeedPayload);

  await assertOwnerAddress(address);
  await assertKnownMarket(payload.marketAddress);

  const collection = await getCollection();
  const updatedAt = new Date();
  await collection.updateOne(
    { marketAddress: payload.marketAddress },
    {
      $set: {
        marketAddress: payload.marketAddress,
        enabled: payload.enabled,
        kind: payload.kind,
        crypto: payload.kind === 'crypto-price' ? (payload.crypto as LiveCryptoDoc) : null,
        sports: payload.kind === 'sports-score' ? (payload.sports as LiveSportsDoc) : null,
        lastSnapshot: null,
        lastSnapshotAt: null,
        updatedAt,
        updatedBy: address,
      },
      $setOnInsert: {
        createdAt: updatedAt,
      },
    },
    { upsert: true },
  );

  const next = await collection.findOne({ marketAddress: payload.marketAddress });
  return toResponseConfig(next);
}

export default async function handler(req: any, res: any) {
  const corsOrigin = resolveCorsOrigin(req.headers?.origin);
  if (corsOrigin) {
    res.setHeader('Access-Control-Allow-Origin', corsOrigin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Wallet-Address, X-Timestamp, X-Signature');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') return res.status(200).json({ ok: true });

  try {
    if (req.method === 'GET') {
      const marketAddressesRaw = req.query?.marketAddresses;
      if (typeof marketAddressesRaw === 'string' && marketAddressesRaw.trim()) {
        const docs = await listConfigsByMarkets(marketAddressesRaw);
        return res.status(200).json({ configs: docs.map(toResponseConfig).filter(Boolean) });
      }

      const doc = await getSingleConfig(req.query?.marketAddress);
      return res.status(200).json({ config: toResponseConfig(doc) });
    }

    if (req.method === 'POST') {
      const { address, timestamp, signature } = extractSignedHeaders(req);

      let body = req.body;
      if (typeof body === 'string') {
        try {
          body = JSON.parse(body);
        } catch {
          return res.status(400).json({ error: 'Invalid JSON' });
        }
      }

      const payload = body?.payload;
      const message = [
        'AchMarket Live Feed Config',
        `Address: ${address}`,
        `Timestamp: ${timestamp}`,
        `Payload: ${serializeLiveFeedPayload(payload)}`,
        'No gas fee. Sign only if you trust this request.',
      ].join('\n');

      verifySignedMessage(address, timestamp, signature, message);

      const config = await upsertConfig(address, payload);
      return res.status(200).json({ config });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err: any) {
    const msg = err?.message || 'Unexpected error';
    const lower = msg.toLowerCase();
    let code = 500;
    if (lower.includes('expired') || lower.includes('signature')) code = 401;
    else if (lower.includes('owner')) code = 403;
    else if (lower.includes('unknown market')) code = 404;
    else if (lower.includes('required') || lower.includes('invalid') || lower.includes('timestamp') || lower.includes('rpc_url')) code = 400;
    else if (lower.includes('mongo_uri') || lower.includes('timeout') || lower.includes('enotfound')) code = 503;
    return res.status(code).json({ error: msg });
  }
}
