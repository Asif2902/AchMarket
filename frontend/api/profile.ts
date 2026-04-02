import { ethers } from 'ethers';
import { MongoClient, MongoServerError } from 'mongodb';
import {
  buildProfileSigningMessage,
  EMPTY_PROFILE_PAYLOAD,
  normalizeAddress,
  normalizeProfileSlug,
  sanitizeProfilePayload,
  type ProfilePayload,
} from '../src/utils/profileAuth';

const MONGO_URI = process.env.MONGO_URI;
const MONGO_DB_NAME = process.env.MONGO_DB_NAME ?? 'achmarket';
const PROFILES_COLLECTION = 'profiles';
const SIG_VALIDITY_MS = 10 * 60 * 1000;

let cachedClient: MongoClient | null = null;
let indexesReady = false;
let clientInitPromise: Promise<MongoClient> | null = null;

type PortfolioStats = {
  totalPositions: number;
  totalMarkets: number;
  activePositions: number;
  resolvedPositions: number;
  totalDepositedWei: string;
  activeDepositsWei: string;
};

type ProfileDocument = ProfilePayload & {
  address: string;
  profileSlug?: string;
  createdAt: Date;
  updatedAt: Date;
};

interface ApiRequest {
  method?: string;
  query?: { address?: string; slug?: string };
  body?: unknown;
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

function parseMongoUri(rawUri: string): URL {
  try {
    return new URL(rawUri);
  } catch {
    throw new Error('MONGO_URI is not a valid URL');
  }
}

function validateMongoUri(rawUri: string): void {
  const parsed = parseMongoUri(rawUri);

  if (parsed.protocol !== 'mongodb+srv:' && parsed.protocol !== 'mongodb:') {
    throw new Error('MONGO_URI must start with mongodb+srv:// or mongodb://');
  }

  if (!parsed.username || !parsed.password) {
    throw new Error('MONGO_URI must include username and password');
  }

  if (!parsed.hostname) {
    throw new Error('MONGO_URI must include a cluster hostname');
  }
}

async function getMongoClient(): Promise<MongoClient> {
  if (!MONGO_URI) {
    throw new Error('MONGO_URI is not configured');
  }

  validateMongoUri(MONGO_URI);

  if (!cachedClient) {
    if (!clientInitPromise) {
      clientInitPromise = (async () => {
        const client = new MongoClient(MONGO_URI, {
          maxPoolSize: 8,
          minPoolSize: 1,
          serverSelectionTimeoutMS: 12000,
          connectTimeoutMS: 12000,
          socketTimeoutMS: 12000,
          retryWrites: true,
          tls: true,
        });
        await client.connect();
        cachedClient = client;
        return client;
      })().catch((error) => {
        clientInitPromise = null;
        throw error;
      });
    }

    cachedClient = await clientInitPromise;
  }

  if (!indexesReady) {
    const db = cachedClient.db(MONGO_DB_NAME);
    const collection = db.collection<ProfileDocument>(PROFILES_COLLECTION);
    await collection.createIndex({ address: 1 }, { unique: true, name: 'uniq_address' });
    await collection.createIndex(
      { profileSlug: 1 },
      {
        unique: true,
        name: 'uniq_profile_slug',
        partialFilterExpression: {
          profileSlug: { $exists: true, $type: 'string', $ne: '' },
        },
      },
    );
    indexesReady = true;
  }

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

function serializeProfile(profile: ProfileDocument) {
  return {
    address: profile.address,
    profileSlug: profile.profileSlug ?? '',
    displayName: profile.displayName,
    avatarUrl: profile.avatarUrl,
    twitterUrl: profile.twitterUrl,
    discordUrl: profile.discordUrl,
    telegramUrl: profile.telegramUrl,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}

async function getProfileByAddress(address: string) {
  const client = await getMongoClient();
  const collection = client.db(MONGO_DB_NAME).collection<ProfileDocument>(PROFILES_COLLECTION);
  const normalized = normalizeAddress(address);

  const profile = await collection.findOne({ address: normalized });

  return {
    profile: profile ? serializeProfile(profile) : null,
    stats: emptyStats(),
  };
}

async function getProfileBySlug(slug: string) {
  const normalizedSlug = normalizeProfileSlug(slug);
  if (!normalizedSlug) {
    throw new Error('Invalid profile slug');
  }

  const client = await getMongoClient();
  const collection = client.db(MONGO_DB_NAME).collection<ProfileDocument>(PROFILES_COLLECTION);
  const profile = await collection.findOne({ profileSlug: normalizedSlug });

  if (!profile) {
    return null;
  }

  return getProfileByAddress(profile.address);
}

function ensureUniqueSlug(baseSlug: string, attempt: number): string {
  if (attempt <= 0) return baseSlug;
  const suffix = `-${attempt + 1}`;
  const trimmedBase = baseSlug.slice(0, Math.max(1, 40 - suffix.length));
  return `${trimmedBase}${suffix}`;
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

  const finalPayload: ProfilePayload = {
    ...EMPTY_PROFILE_PAYLOAD,
    ...(existing ?? {}),
    ...sanitizedPayload,
  };

  const baseSlug = normalizeProfileSlug(
    finalPayload.displayName || existing?.profileSlug || normalizedAddress.slice(2, 10),
  );

  if (!baseSlug) {
    throw new Error('Display name must include letters or numbers.');
  }

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidateSlug = ensureUniqueSlug(baseSlug, attempt);

    try {
      await collection.updateOne(
        { address: normalizedAddress },
        {
          $set: {
            address: normalizedAddress,
            profileSlug: candidateSlug,
            ...finalPayload,
            updatedAt: now,
          },
          $setOnInsert: {
            createdAt: now,
          },
        },
        { upsert: true },
      );

      return getProfileByAddress(normalizedAddress);
    } catch (error) {
      lastError = error;
      if (error instanceof MongoServerError && error.code === 11000) {
        continue;
      }
      throw error;
    }
  }

  if (lastError instanceof MongoServerError && lastError.code === 11000) {
    throw new Error('That display name is taken. Try a different one.');
  }

  throw new Error('Failed to save profile. Please retry.');
}

function parseBody(rawBody: unknown): {
  address?: string;
  payload?: ProfilePayload;
  timestamp?: number;
  signature?: string;
} {
  if (!rawBody) return {};

  if (typeof rawBody === 'string') {
    try {
      return JSON.parse(rawBody) as {
        address?: string;
        payload?: ProfilePayload;
        timestamp?: number;
        signature?: string;
      };
    } catch {
      throw new Error('Invalid JSON body');
    }
  }

  if (typeof rawBody === 'object') {
    return rawBody as {
      address?: string;
      payload?: ProfilePayload;
      timestamp?: number;
      signature?: string;
    };
  }

  throw new Error('Invalid request body');
}

function toSafeErrorMessage(error: unknown): string {
  if (error instanceof MongoServerError) {
    if (error.code === 18) {
      return 'Mongo authentication failed. Verify username/password in MONGO_URI.';
    }
    if (error.code === 13) {
      return 'Mongo authorization failed. DB user needs readWrite permissions.';
    }
  }

  if (error instanceof Error) {
    const msg = error.message;
    if (msg.includes('querySrv ENOTFOUND')) {
      return 'Mongo DNS lookup failed. Check cluster hostname in MONGO_URI.';
    }
    if (msg.includes('Server selection timed out')) {
      return 'Mongo connection timeout. Check Atlas network access and cluster status.';
    }
    if (msg.includes('bad auth')) {
      return 'Mongo authentication failed. Reset DB user password and update MONGO_URI.';
    }
    if (msg.includes('MONGO_URI')) return msg;
    if (msg.includes('Display name')) return msg;
    if (msg.includes('Invalid JSON body')) return msg;
    if (msg.includes('required')) return msg;
    return `Server error: ${msg}`;
  }

  return 'Unexpected server error';
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  setCors(res);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') {
    return res.status(200).json({ ok: true });
  }

  try {
    if (req.method === 'GET') {
      const address = req.query?.address;
      const slug = req.query?.slug;

      if (slug) {
        const data = await getProfileBySlug(slug);
        if (!data) {
          return res.status(404).json({ error: 'Profile not found' });
        }
        return res.status(200).json(data);
      }

      if (!address) {
        return res.status(400).json({ error: 'address or slug query param is required' });
      }

      const data = await getProfileByAddress(address);
      return res.status(200).json(data);
    }

    if (req.method === 'POST') {
      const body = parseBody(req.body);
      const address = body.address;
      const payload = body.payload ?? EMPTY_PROFILE_PAYLOAD;
      const timestamp = Number(body.timestamp);
      const signature = body.signature ?? '';

      if (!address || !signature) {
        return res.status(400).json({ error: 'address and signature are required' });
      }

      const data = await upsertProfile(address, payload, timestamp, signature);
      return res.status(200).json(data);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    const message = toSafeErrorMessage(error);
    let statusCode = 500;
    if (message.includes('MONGO_URI') || message.includes('Invalid JSON body') || message.includes('required')) {
      statusCode = 400;
    }
    if (message.includes('authentication failed') || message.includes('authorization failed')) {
      statusCode = 401;
    }
    if (message.includes('connection timeout') || message.includes('DNS lookup failed')) {
      statusCode = 503;
    }

    return res.status(statusCode).json({ error: message });
  }
}
