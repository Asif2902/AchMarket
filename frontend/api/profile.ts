import { ethers, JsonRpcProvider, Contract } from 'ethers';
import { MongoClient } from 'mongodb';
import { FACTORY_ADDRESS, LENS_ADDRESS, STAGE } from '../src/config/network';
import { FACTORY_ABI, LENS_ABI } from '../src/config/abis';
import {
  buildProfileSigningMessage,
  EMPTY_PROFILE_PAYLOAD,
  normalizeAddress,
  normalizeProfileSlug,
  sanitizeProfilePayload,
  type ProfilePayload,
} from '../src/utils/profileAuth';

const RPC_URL = process.env.OG_RPC_URL ?? process.env.VITE_RPC_URL ?? 'https://arc-testnet.drpc.org/';
const MONGO_URI = process.env.MONGO_URI;
const MONGO_DB_NAME = process.env.MONGO_DB_NAME ?? 'achmarket';
const PROFILES_COLLECTION = 'profiles';
const SIG_VALIDITY_MS = 10 * 60 * 1000;

let cachedClient: MongoClient | null = null;

type PortfolioStats = {
  totalPositions: number;
  totalMarkets: number;
  activePositions: number;
  resolvedPositions: number;
  totalDepositedWei: string;
  activeDepositsWei: string;
};

type PortfolioPosition = {
  market?: string;
  stage?: number | bigint;
  netDepositedWei?: bigint | string | number;
};

type ProfileDocument = ProfilePayload & {
  address: string;
  profileSlug: string;
  createdAt: Date;
  updatedAt: Date;
};

interface ApiRequest {
  method?: string;
  query?: { address?: string; slug?: string };
  body?: {
    address?: string;
    payload?: ProfilePayload;
    timestamp?: number;
    signature?: string;
  };
}

interface ApiResponse {
  status: (code: number) => { json: (body: unknown) => void };
  setHeader: (name: string, value: string) => void;
}

function setCors(res: ApiResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function getMongoClient(): Promise<MongoClient> {
  if (!MONGO_URI) {
    throw new Error('MONGO_URI is not configured.');
  }

  if (cachedClient) return cachedClient;

  cachedClient = new MongoClient(MONGO_URI, {
    maxPoolSize: 8,
    minPoolSize: 1,
  });

  await cachedClient.connect();

  const db = cachedClient.db(MONGO_DB_NAME);
  const collection = db.collection<ProfileDocument>(PROFILES_COLLECTION);
  await collection.createIndex({ address: 1 }, { unique: true });
  await collection.createIndex(
    { profileSlug: 1 },
    {
      unique: true,
      partialFilterExpression: {
        profileSlug: { $exists: true, $type: 'string', $ne: '' },
      },
    },
  );

  return cachedClient;
}

function validateFreshTimestamp(timestamp: number): boolean {
  if (!Number.isFinite(timestamp)) return false;
  const diff = Math.abs(Date.now() - timestamp);
  return diff <= SIG_VALIDITY_MS;
}

function emptyStats(): PortfolioStats {
  return {
    totalPositions: 0,
    totalMarkets: 0,
    activePositions: 0,
    resolvedPositions: 0,
    totalDepositedWei: '0',
    activeDepositsWei: '0',
  };
}

async function getPortfolioStats(address: string): Promise<PortfolioStats> {
  try {
    const provider = new JsonRpcProvider(RPC_URL);
    const factory = new Contract(FACTORY_ADDRESS, FACTORY_ABI, provider);
    const lens = new Contract(LENS_ADDRESS, LENS_ABI, provider);

    const [portfolio, totalMarketsRaw] = await Promise.all([
      lens.getUserPortfolio(address),
      factory.totalMarkets(),
    ]);

    const positions = (Array.isArray(portfolio) ? portfolio : []) as PortfolioPosition[];

    let totalDeposited = 0n;
    let activeDeposits = 0n;
    let activePositions = 0;
    let resolvedPositions = 0;

    for (const position of positions) {
      const stage = Number(position.stage ?? 0);
      const rawDeposited = position.netDepositedWei ?? 0;
      const deposited = typeof rawDeposited === 'bigint' ? rawDeposited : BigInt(rawDeposited);
      totalDeposited += deposited;

      if (stage === STAGE.Active) {
        activePositions += 1;
        activeDeposits += deposited;
      }
      if (stage === STAGE.Resolved) {
        resolvedPositions += 1;
      }
    }

    const uniqueMarkets = new Set(positions.map((entry) => String(entry.market ?? '').toLowerCase()).filter(Boolean));

    return {
      totalPositions: positions.length,
      totalMarkets: uniqueMarkets.size,
      activePositions,
      resolvedPositions,
      totalDepositedWei: totalDeposited.toString(),
      activeDepositsWei: activeDeposits.toString(),
    };
  } catch {
    return emptyStats();
  }
}

async function getProfile(address: string) {
  const client = await getMongoClient();
  const collection = client.db(MONGO_DB_NAME).collection<ProfileDocument>(PROFILES_COLLECTION);
  const normalized = normalizeAddress(address);

  const [profile, stats] = await Promise.all([
    collection.findOne({ address: normalized }),
    getPortfolioStats(normalized),
  ]);

  if (!profile) {
    return {
      profile: null,
      stats,
    };
  }

  return {
    profile: {
      address: profile.address,
      profileSlug: profile.profileSlug ?? '',
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      twitterUrl: profile.twitterUrl,
      discordUrl: profile.discordUrl,
      telegramUrl: profile.telegramUrl,
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
    },
    stats,
  };
}

async function upsertProfile(
  address: string,
  payload: Partial<ProfilePayload>,
  timestamp: number,
  signature: string,
) {
  if (!validateFreshTimestamp(timestamp)) {
    throw new Error('Signature expired. Please try again.');
  }

  const normalizedAddress = normalizeAddress(address);
  const sanitizedPayload = sanitizeProfilePayload(payload);
  const message = buildProfileSigningMessage(normalizedAddress, sanitizedPayload, timestamp);
  const recovered = ethers.verifyMessage(message, signature);

  if (normalizeAddress(recovered) !== normalizedAddress) {
    throw new Error('Invalid signature for wallet address.');
  }

  const client = await getMongoClient();
  const collection = client.db(MONGO_DB_NAME).collection<ProfileDocument>(PROFILES_COLLECTION);

  const now = new Date();
  const existing = await collection.findOne({ address: normalizedAddress });
  const preferredSlug = normalizeProfileSlug(
    sanitizedPayload.displayName || existing?.displayName || normalizedAddress.slice(2, 10),
  );

  if (!preferredSlug) {
    throw new Error('Display name must include letters or numbers.');
  }

  const conflicting = await collection.findOne({ profileSlug: preferredSlug });
  if (conflicting && conflicting.address !== normalizedAddress) {
    throw new Error('That display name is already taken.');
  }

  const finalPayload: ProfilePayload = {
    ...EMPTY_PROFILE_PAYLOAD,
    ...(existing ?? {}),
    ...sanitizedPayload,
  };

  await collection.updateOne(
    { address: normalizedAddress },
    {
      $set: {
        address: normalizedAddress,
        profileSlug: preferredSlug,
        ...finalPayload,
        updatedAt: now,
      },
      $setOnInsert: {
        createdAt: now,
      },
    },
    { upsert: true },
  );

  return getProfile(normalizedAddress);
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).json({ ok: true });
  }

  try {
    if (req.method === 'GET') {
      const address = req.query?.address;
      const slug = req.query?.slug;

      if (slug) {
        const normalizedSlug = normalizeProfileSlug(slug);
        if (!normalizedSlug) {
          return res.status(400).json({ error: 'invalid slug' });
        }
        const client = await getMongoClient();
        const collection = client.db(MONGO_DB_NAME).collection<ProfileDocument>(PROFILES_COLLECTION);
        const profileBySlug = await collection.findOne({ profileSlug: normalizedSlug });
        if (!profileBySlug) {
          return res.status(404).json({ error: 'Profile not found' });
        }
        const data = await getProfile(profileBySlug.address);
        return res.status(200).json(data);
      }

      if (!address) {
        return res.status(400).json({ error: 'address or slug query param is required' });
      }
      const data = await getProfile(address);
      return res.status(200).json(data);
    }

    if (req.method === 'POST') {
      let body: ApiRequest['body'] = req.body ?? {};
      if (typeof body === 'string') {
        try {
          body = JSON.parse(body) as ApiRequest['body'];
        } catch {
          return res.status(400).json({ error: 'Invalid JSON body' });
        }
      }
      const parsedBody = body ?? {};
      const address = parsedBody.address;
      const payload = parsedBody.payload ?? EMPTY_PROFILE_PAYLOAD;
      const timestamp = Number(parsedBody.timestamp);
      const signature = parsedBody.signature ?? '';

      if (!address || !signature) {
        return res.status(400).json({ error: 'address and signature are required' });
      }

      const data = await upsertProfile(address, payload, timestamp, signature);
      return res.status(200).json(data);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error';
    return res.status(500).json({ error: message });
  }
}
