import { recoverAddress, hashMessage, getAddress } from 'ethers';
import { MongoClient, MongoServerError } from 'mongodb';

// ====== Inline utilities (no cross-directory imports) ======

function normalizeAddress(address: string): string {
  return getAddress(address).toLowerCase();
}

function normalizeProfileSlug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/_{2,}/g, '_')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function sanitizeUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  if (!value) return '';
  const clipped = value.trim().slice(0, 300);
  if (clipped.startsWith('ipfs://')) return clipped;
  try {
    const parsed = new URL(clipped);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? clipped : '';
  } catch {
    return '';
  }
}

function sanitizeProfilePayload(input: Record<string, unknown>) {
  const displayName = typeof input.displayName === 'string' ? input.displayName.trim().slice(0, 40) : '';
  return {
    displayName,
    avatarUrl: sanitizeUrl(input.avatarUrl),
    twitterUrl: sanitizeUrl(input.twitterUrl),
    discordUrl: sanitizeUrl(input.discordUrl),
    telegramUrl: sanitizeUrl(input.telegramUrl),
  };
}

function buildProfileSigningMessage(address: string, payload: Record<string, unknown>, timestamp: number): string {
  return [
    'AchMarket Profile Update',
    `Address: ${address}`,
    `Timestamp: ${timestamp}`,
    `Payload: ${JSON.stringify(payload)}`,
    'No gas fee. Sign only if you trust this request.',
  ].join('\n');
}

function verifyMessage(message: string, signature: string): string {
  const addr = recoverAddress(hashMessage(message), signature);
  return addr.toLowerCase();
}

const EMPTY_PAYLOAD = {
  displayName: '',
  avatarUrl: '',
  twitterUrl: '',
  discordUrl: '',
  telegramUrl: '',
};

// ====== Serverless handler ======

const MONGO_URI = process.env.MONGO_URI;
const MONGO_DB_NAME = process.env.MONGO_DB_NAME ?? 'achmarket';
const PROFILES_COLLECTION = 'profiles';
const SIG_VALIDITY_MS = 10 * 60 * 1000;

let cachedClient: MongoClient | null = null;
let indexesReady = false;

interface ProfileDoc {
  address: string;
  profileSlug?: string;
  displayName: string;
  avatarUrl: string;
  twitterUrl: string;
  discordUrl: string;
  telegramUrl: string;
  createdAt: Date;
  updatedAt: Date;
}

async function getMongoClient(): Promise<MongoClient> {
  if (!MONGO_URI) throw new Error('MONGO_URI is not configured');

  // If we have a cached client, try to reuse it
  if (cachedClient) {
    try {
      // Test if connection is still alive by pinging
      await cachedClient.db(MONGO_DB_NAME).command({ ping: 1 });
      if (!indexesReady) {
        const col = cachedClient.db(MONGO_DB_NAME).collection<ProfileDoc>(PROFILES_COLLECTION);
        await col.createIndex({ address: 1 }, { unique: true, name: 'uniq_address' });
        await col.createIndex(
          { profileSlug: 1 },
          { unique: true, name: 'uniq_profile_slug', sparse: true },
        );
        indexesReady = true;
      }
      return cachedClient;
    } catch {
      // Connection is dead, close and recreate
      try { await cachedClient.close(); } catch {}
      cachedClient = null;
      indexesReady = false;
    }
  }

  // Create fresh connection
  cachedClient = new MongoClient(MONGO_URI, {
    maxPoolSize: 4,
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000,
  });
  await cachedClient.connect();

  const col = cachedClient.db(MONGO_DB_NAME).collection<ProfileDoc>(PROFILES_COLLECTION);
  await col.createIndex({ address: 1 }, { unique: true, name: 'uniq_address' });
  await col.createIndex(
    { profileSlug: 1 },
    { unique: true, name: 'uniq_profile_slug', sparse: true },
  );
  indexesReady = true;

  return cachedClient;
}

async function getProfile(address: string) {
  const client = await getMongoClient();
  const col = client.db(MONGO_DB_NAME).collection<ProfileDoc>(PROFILES_COLLECTION);
  const doc = await col.findOne({ address: address.toLowerCase() });

  return {
    profile: doc
      ? {
          address: doc.address,
          profileSlug: doc.profileSlug ?? '',
          displayName: doc.displayName,
          avatarUrl: doc.avatarUrl,
          twitterUrl: doc.twitterUrl,
          discordUrl: doc.discordUrl,
          telegramUrl: doc.telegramUrl,
          createdAt: doc.createdAt.toISOString(),
          updatedAt: doc.updatedAt.toISOString(),
        }
      : null,
  };
}

async function upsertProfile(address: string, payload: Record<string, unknown>, timestamp: number, signature: string) {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) throw new Error('Invalid timestamp.');
  const diff = Math.abs(Date.now() - ts);
  if (diff > SIG_VALIDITY_MS) throw new Error('Signature expired. Please try again.');

  const normalized = normalizeAddress(address);
  const sanitized = sanitizeProfilePayload(payload);
  const message = buildProfileSigningMessage(normalized, sanitized, timestamp);

  let recovered: string;
  try {
    recovered = verifyMessage(message, signature);
  } catch {
    throw new Error('Invalid signature format.');
  }

  if (normalizeAddress(recovered) !== normalized) {
    throw new Error('Invalid signature for wallet address.');
  }

  const client = await getMongoClient();
  const col = client.db(MONGO_DB_NAME).collection<ProfileDoc>(PROFILES_COLLECTION);
  const now = new Date();

  const existing = await col.findOne({ address: normalized });
  const merged = { ...EMPTY_PAYLOAD, ...(existing ?? {}), ...sanitized };
  const {
    address: _address,
    profileSlug: _profileSlug,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...mergedWithoutMeta
  } = merged as ProfileDoc;

  const baseSlug = normalizeProfileSlug(merged.displayName || existing?.profileSlug || normalized.slice(2, 10));
  if (!baseSlug) throw new Error('Display name must include letters or numbers.');

  // Check if another user already owns this slug
  const conflict = await col.findOne({ profileSlug: baseSlug, address: { $ne: normalized } });
  if (conflict) throw new Error(`"${baseSlug}" is already taken. Choose a different display name.`);

  try {
    await col.updateOne(
      { address: normalized },
      {
        $set: {
          address: normalized,
          profileSlug: baseSlug,
          ...mergedWithoutMeta,
          updatedAt: now,
        },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true },
    );
  } catch (err) {
    if (err instanceof MongoServerError && err.code === 11000) {
      throw new Error(`"${baseSlug}" is already taken. Choose a different display name.`);
    }
    throw err;
  }

  return getProfile(normalized);
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') return res.status(200).json({ ok: true });

  try {
    if (req.method === 'GET') {
      const { address, slug } = req.query || {};

      if (slug) {
        const norm = normalizeProfileSlug(slug);
        if (!norm) return res.status(400).json({ error: 'Invalid slug' });
        const client = await getMongoClient();
        const col = client.db(MONGO_DB_NAME).collection<ProfileDoc>(PROFILES_COLLECTION);
        const doc = await col.findOne({ profileSlug: norm });
        if (!doc) return res.status(404).json({ error: 'Profile not found' });
        return res.status(200).json(await getProfile(doc.address));
      }

      if (!address) return res.status(400).json({ error: 'address or slug required' });
      return res.status(200).json(await getProfile(address));
    }

    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
      }
      if (!body?.address || !body?.signature) {
        return res.status(400).json({ error: 'address and signature required' });
      }

      const data = await upsertProfile(body.address, body.payload || {}, Number(body.timestamp), body.signature);
      return res.status(200).json(data);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err: any) {
    const msg = err?.message || 'Unexpected error';
    let code = 500;
    if (err instanceof MongoServerError && err.code === 11000) {
      code = 409;
    } else if (msg.includes('expired') || msg.includes('Invalid signature')) {
      code = 401;
    } else if (msg.includes('already taken') || msg.includes('taken')) {
      code = 409;
    } else if (msg.includes('MONGO_URI') || msg.includes('required') || msg.includes('Invalid') || msg.includes('Display name')) {
      code = 400;
    } else if (msg.includes('auth')) {
      code = 401;
    } else if (msg.includes('timeout') || msg.includes('ENOTFOUND')) {
      code = 503;
    }
    return res.status(code).json({ error: msg });
  }
}
