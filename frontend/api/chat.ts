import { recoverAddress, hashMessage, getAddress } from 'ethers';
import { MongoClient, ObjectId } from 'mongodb';

function normalizeAddress(address: string): string {
  return getAddress(address).toLowerCase();
}

function sanitizeChatContent(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const clipped = trimmed.slice(0, 500);
  return stripLinks(clipped);
}

function stripLinks(text: string): string {
  const urlPattern = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;
  const wwwPattern = /www\.[^\s<>"{}|\\^`\[\]]+/gi;
  const domainPattern = /\b[a-zA-Z0-9-]+\.(com|net|org|io|co|xyz|app|dev|ai|gg|me|info|biz|cc|tv|ru|de|fr|jp|cn|in|br|uk|us|ca|au|it|nl|es|se|no|fi|dk|pl|cz|at|ch|be|pt|ie|nz|za|kr|tw|hk|sg|my|th|vn|ph|id|mx|ar|cl|co\.uk|co\.jp|co\.in|com\.au|com\.br|com\.mx|com\.ar|com\.za|com\.sg|com\.my|com\.th|com\.vn|com\.ph|com\.id|com\.tw|com\.hk)\b/gi;
  let result = text.replace(urlPattern, '');
  result = result.replace(wwwPattern, '');
  result = result.replace(domainPattern, '');
  return result.replace(/\s{2,}/g, ' ').trim();
}

function extractMentions(text: string): string[] {
  const mentionPattern = /@([a-zA-Z0-9_-]{2,40})/g;
  const mentions: string[] = [];
  let match;
  while ((match = mentionPattern.exec(text)) !== null) {
    mentions.push(match[1].toLowerCase());
  }
  return [...new Set(mentions)];
}

function buildChatSigningMessage(address: string, payload: Record<string, unknown>, timestamp: number): string {
  return [
    'AchMarket Chat Message',
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

const MONGO_URI = process.env.MONGO_URI;
const MONGO_DB_NAME = process.env.MONGO_DB_NAME ?? 'achmarket';
const CHATS_COLLECTION = 'chats';
const PROFILES_COLLECTION = 'profiles';
const SIG_VALIDITY_MS = 10 * 60 * 1000;
const PAGE_SIZE = 30;

let cachedClient: MongoClient | null = null;
let indexesReady = false;

interface ChatDoc {
  _id?: ObjectId;
  marketAddress: string;
  authorAddress: string;
  content: string;
  replyTo: ObjectId | null;
  mentions: string[];
  createdAt: Date;
  updatedAt: Date;
}

interface ProfileDoc {
  address: string;
  profileSlug: string;
  displayName: string;
  avatarUrl: string;
}

async function getMongoClient(): Promise<MongoClient> {
  if (!MONGO_URI) throw new Error('MONGO_URI is not configured');

  if (cachedClient) {
    try {
      await cachedClient.db(MONGO_DB_NAME).command({ ping: 1 });
      if (!indexesReady) {
        const col = cachedClient.db(MONGO_DB_NAME).collection<ChatDoc>(CHATS_COLLECTION);
        await col.createIndex({ marketAddress: 1, createdAt: -1 }, { name: 'idx_market_created' });
        await col.createIndex({ authorAddress: 1 }, { name: 'idx_author' });
        await col.createIndex({ replyTo: 1 }, { name: 'idx_reply_to' });
        indexesReady = true;
      }
      return cachedClient;
    } catch {
      try { await cachedClient.close(); } catch {}
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

  const col = cachedClient.db(MONGO_DB_NAME).collection<ChatDoc>(CHATS_COLLECTION);
  await col.createIndex({ marketAddress: 1, createdAt: -1 }, { name: 'idx_market_created' });
  await col.createIndex({ authorAddress: 1 }, { name: 'idx_author' });
  await col.createIndex({ replyTo: 1 }, { name: 'idx_reply_to' });
  indexesReady = true;

  return cachedClient;
}

async function getProfileByAddress(address: string): Promise<ProfileDoc | null> {
  const client = await getMongoClient();
  const col = client.db(MONGO_DB_NAME).collection<ProfileDoc>(PROFILES_COLLECTION);
  return col.findOne({ address: address.toLowerCase() });
}

async function getProfilesBySlugs(slugs: string[]): Promise<Map<string, ProfileDoc>> {
  if (slugs.length === 0) return new Map();
  const client = await getMongoClient();
  const col = client.db(MONGO_DB_NAME).collection<ProfileDoc>(PROFILES_COLLECTION);
  const docs = await col.find({ profileSlug: { $in: slugs } }).toArray();
  const map = new Map<string, ProfileDoc>();
  for (const doc of docs) {
    map.set(doc.profileSlug, doc);
  }
  return map;
}

function formatChatMessage(doc: ChatDoc, authorProfile: ProfileDoc | null, replyToDoc: ChatDoc | null, replyToProfile: ProfileDoc | null) {
  return {
    _id: doc._id!.toString(),
    marketAddress: doc.marketAddress,
    authorAddress: doc.authorAddress,
    authorProfile: authorProfile
      ? {
          displayName: authorProfile.displayName,
          profileSlug: authorProfile.profileSlug,
          avatarUrl: authorProfile.avatarUrl,
        }
      : null,
    content: doc.content,
    replyTo: doc.replyTo ? doc.replyTo.toString() : null,
    replyToMessage: replyToDoc
      ? {
          _id: replyToDoc._id!.toString(),
          authorProfile: replyToProfile
            ? { displayName: replyToProfile.displayName, profileSlug: replyToProfile.profileSlug }
            : null,
          content: replyToDoc.content,
        }
      : null,
    mentions: doc.mentions,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

async function getChatMessages(marketAddress: string, cursor?: string) {
  const client = await getMongoClient();
  const col = client.db(MONGO_DB_NAME).collection<ChatDoc>(CHATS_COLLECTION);

  const query: Record<string, unknown> = { marketAddress: marketAddress.toLowerCase() };
  if (cursor) {
    const cursorDate = new Date(cursor);
    if (!isNaN(cursorDate.getTime())) {
      query.createdAt = { $lt: cursorDate };
    }
  }

  const docs = await col
    .find(query)
    .sort({ createdAt: -1 })
    .limit(PAGE_SIZE + 1)
    .toArray();

  const hasMore = docs.length > PAGE_SIZE;
  const messages = hasMore ? docs.slice(0, PAGE_SIZE) : docs;

  const authorAddresses = [...new Set(messages.map(m => m.authorAddress))];
  const replyIds = messages.map(m => m.replyTo).filter((id): id is ObjectId => id !== null);

  const [authorProfiles, replyDocs] = await Promise.all([
    Promise.all(authorAddresses.map(addr => getProfileByAddress(addr))),
    replyIds.length > 0
      ? col.find({ _id: { $in: replyIds } }).toArray()
      : Promise.resolve([]),
  ]);

  const authorProfileMap = new Map<string, ProfileDoc | null>();
  authorAddresses.forEach((addr, i) => {
    authorProfileMap.set(addr.toLowerCase(), authorProfiles[i]);
  });

  const replyAuthorAddresses = [...new Set(replyDocs.map(d => d.authorAddress))];
  const replyAuthorProfiles = await Promise.all(replyAuthorAddresses.map(addr => getProfileByAddress(addr)));
  const replyAuthorProfileMap = new Map<string, ProfileDoc | null>();
  replyAuthorAddresses.forEach((addr, i) => {
    replyAuthorProfileMap.set(addr.toLowerCase(), replyAuthorProfiles[i]);
  });

  const replyDocMap = new Map<string, ChatDoc>();
  for (const rd of replyDocs) {
    replyDocMap.set(rd._id!.toString(), rd);
  }

  const formatted = messages.map(doc => {
    const authorProfile = authorProfileMap.get(doc.authorAddress.toLowerCase()) || null;
    const replyToDoc = doc.replyTo ? replyDocMap.get(doc.replyTo.toString()) || null : null;
    const replyToProfile = replyToDoc
      ? replyAuthorProfileMap.get(replyToDoc.authorAddress.toLowerCase()) || null
      : null;
    return formatChatMessage(doc, authorProfile, replyToDoc, replyToProfile);
  });

  return { messages: formatted, hasMore };
}

async function sendChatMessage(
  address: string,
  payload: Record<string, unknown>,
  timestamp: number,
  signature: string,
) {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) throw new Error('Invalid timestamp.');
  const diff = Math.abs(Date.now() - ts);
  if (diff > SIG_VALIDITY_MS) throw new Error('Signature expired. Please try again.');

  const normalized = normalizeAddress(address);

  const profile = await getProfileByAddress(normalized);
  if (!profile) {
    throw new Error('You need a profile to chat. Create a profile first.');
  }

  const content = typeof payload.content === 'string' ? payload.content : '';
  const sanitized = sanitizeChatContent(content);
  if (!sanitized) throw new Error('Message cannot be empty.');

  const marketAddress = typeof payload.marketAddress === 'string' ? payload.marketAddress : '';
  if (!marketAddress) throw new Error('Market address is required.');

  try {
    normalizeAddress(marketAddress);
  } catch {
    throw new Error('Invalid market address.');
  }

  const replyTo = payload.replyTo ? String(payload.replyTo) : null;
  const mentions = extractMentions(sanitized);

  const message = buildChatSigningMessage(normalized, { content: sanitized, marketAddress, replyTo }, timestamp);
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
  const col = client.db(MONGO_DB_NAME).collection<ChatDoc>(CHATS_COLLECTION);

  let replyToObj: ObjectId | null = null;
  if (replyTo) {
    try {
      replyToObj = new ObjectId(replyTo);
      const exists = await col.findOne({ _id: replyToObj, marketAddress: marketAddress.toLowerCase() });
      if (!exists) throw new Error('Reply target not found.');
    } catch (err: any) {
      if (err.message === 'Reply target not found.') throw err;
      throw new Error('Invalid reply reference.');
    }
  }

  const now = new Date();
  const doc: Omit<ChatDoc, '_id'> = {
    marketAddress: marketAddress.toLowerCase(),
    authorAddress: normalized,
    content: sanitized,
    replyTo: replyToObj,
    mentions,
    createdAt: now,
    updatedAt: now,
  };

  const result = await col.insertOne(doc);
  const inserted = await col.findOne({ _id: result.insertedId });
  if (!inserted) throw new Error('Failed to save message.');

  const authorProfile = profile;
  let replyToDoc: ChatDoc | null = null;
  let replyToProfile: ProfileDoc | null = null;
  if (replyToObj) {
    replyToDoc = await col.findOne({ _id: replyToObj });
    if (replyToDoc) {
      replyToProfile = await getProfileByAddress(replyToDoc.authorAddress);
    }
  }

  return { message: formatChatMessage(inserted, authorProfile, replyToDoc, replyToProfile) };
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') return res.status(200).json({ ok: true });

  try {
    if (req.method === 'GET') {
      const { marketAddress, cursor } = req.query || {};
      if (Array.isArray(marketAddress) || typeof marketAddress !== 'string' || !marketAddress) {
        return res.status(400).json({ error: 'marketAddress required' });
      }
      const data = await getChatMessages(marketAddress, cursor);
      return res.status(200).json(data);
    }

    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
      }
      if (!body?.address || !body?.signature) {
        return res.status(400).json({ error: 'address and signature required' });
      }
      if (!body?.payload?.content || !body?.payload?.marketAddress) {
        return res.status(400).json({ error: 'content and marketAddress required in payload' });
      }

      const data = await sendChatMessage(body.address, body.payload, Number(body.timestamp), body.signature);
      return res.status(201).json(data);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err: any) {
    const msg = err?.message || 'Unexpected error';
    const msgLower = msg.toLowerCase();
    let code = 500;
    if (msgLower.includes('expired') || msgLower.includes('invalid signature')) {
      code = 401;
    } else if (msgLower.includes('profile') || msgLower.includes('empty') || msgLower.includes('required') || msgLower.includes('invalid')) {
      code = 400;
    } else if (msgLower.includes('reply target')) {
      code = 404;
    } else if (msgLower.includes('mongo_uri') || msgLower.includes('timeout') || msgLower.includes('enotfound')) {
      code = 503;
    }
    return res.status(code).json({ error: msg });
  }
}
