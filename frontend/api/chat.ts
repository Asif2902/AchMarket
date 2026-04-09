import { recoverAddress, hashMessage, getAddress, JsonRpcProvider, Contract } from 'ethers';
import { MongoClient, ObjectId } from 'mongodb';
import type { Collection } from 'mongodb';
import { createHash } from 'crypto';

function normalizeAddress(address: string): string {
  return getAddress(address).toLowerCase();
}

function sanitizeChatContent(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const withoutControlChars = trimmed.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  return stripLinks(withoutControlChars).trim();
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
  let match: RegExpExecArray | null;
  while ((match = mentionPattern.exec(text)) !== null) {
    mentions.push(match[1].toLowerCase());
  }
  return [...new Set(mentions)];
}

function containsLink(text: string): boolean {
  const urlPattern = /https?:\/\/[\S]+/i;
  const wwwPattern = /\bwww\.[\S]+/i;
  const domainPattern = /\b[a-zA-Z0-9-]+\.(com|net|org|io|co|xyz|app|dev|ai|gg|me|info|biz|cc|tv|ru|de|fr|jp|cn|in|br|uk|us|ca|au|it|nl|es|se|no|fi|dk|pl|cz|at|ch|be|pt|ie|nz|za|kr|tw|hk|sg|my|th|vn|ph|id|mx|ar|cl|co\.uk|co\.jp|co\.in|com\.au|com\.br|com\.mx|com\.ar|com\.za|com\.sg|com\.my|com\.th|com\.vn|com\.ph|com\.id|com\.tw|com\.hk)\b/i;
  return urlPattern.test(text) || wwwPattern.test(text) || domainPattern.test(text);
}

function serializeChatSigningPayload(payload: Record<string, unknown>): string {
  return JSON.stringify({
    marketAddress: typeof payload.marketAddress === 'string' ? payload.marketAddress : '',
    content: typeof payload.content === 'string' ? payload.content : '',
    replyTo: payload.replyTo ? String(payload.replyTo) : null,
  });
}

function buildChatSigningMessage(address: string, payload: Record<string, unknown>, timestamp: number): string {
  return [
    'AchMarket Chat Message',
    `Address: ${address}`,
    `Timestamp: ${timestamp}`,
    `Payload: ${serializeChatSigningPayload(payload)}`,
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
const CHAT_THROTTLES_COLLECTION = 'chat_throttles';
const SIG_VALIDITY_MS = 10 * 60 * 1000;
const PAGE_SIZE = 30;
const MAX_MESSAGE_LENGTH = 500;
const MAX_MENTIONS = 12;
const MIN_MESSAGE_INTERVAL_MS = 2500;
const MAX_MESSAGES_PER_MINUTE = 8;
const DUPLICATE_WINDOW_MS = 2 * 60 * 1000;
const MAX_IP_POSTS_PER_MINUTE = 40;
const IP_WINDOW_MS = 60 * 1000;
const RPC_URL = process.env.RPC_URL;
const CORS_ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const MARKET_STAGE_ABI = ['function stage() view returns (uint8)'];
const STAGE_SUSPENDED = 2;
const STAGE_RESOLVED = 3;
const STAGE_CANCELLED = 4;
const STAGE_CACHE_MS = 15_000;

let cachedClient: MongoClient | null = null;
let indexesReady = false;
let cachedReadProvider: JsonRpcProvider | null = null;
const marketStageCache = new Map<string, { stage: number; expiresAt: number }>();
const ipRateLimitMap = new Map<string, { count: number; resetAt: number }>();

function getRequiredRpcUrl(): string {
  if (!RPC_URL || !RPC_URL.trim()) {
    throw new Error('RPC_URL is required for chat stage checks. Configure RPC_URL env var.');
  }
  try {
    new URL(RPC_URL);
  } catch {
    throw new Error('RPC_URL is invalid. Configure RPC_URL with a valid URL.');
  }
  return RPC_URL;
}

function resolveCorsOrigin(originHeader: unknown): string | null {
  if (process.env.NODE_ENV === 'development') return '*';
  if (typeof originHeader !== 'string' || !originHeader) return null;
  if (CORS_ALLOWED_ORIGINS.includes('*')) return originHeader;
  return CORS_ALLOWED_ORIGINS.includes(originHeader) ? originHeader : null;
}

function cleanupInMemoryCaches(): void {
  const now = Date.now();
  if (marketStageCache.size > 200) {
    for (const [key, value] of marketStageCache.entries()) {
      if (value.expiresAt <= now) marketStageCache.delete(key);
    }
  }
  if (ipRateLimitMap.size > 1000) {
    for (const [key, value] of ipRateLimitMap.entries()) {
      if (value.resetAt <= now) ipRateLimitMap.delete(key);
    }
  }
}

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

interface ChatThrottleHashEntry {
  hash: string;
  at: Date;
}

interface ChatThrottleDoc {
  _id?: ObjectId;
  marketAddress: string;
  authorAddress: string;
  lastMessageAt: Date;
  minuteWindowStart: Date;
  minuteCount: number;
  recentHashes: ChatThrottleHashEntry[];
  updatedAt: Date;
}

interface ChatCursorPayload {
  createdAt: string;
  _id: string;
}

async function getMongoClient(): Promise<MongoClient> {
  if (!MONGO_URI) throw new Error('MONGO_URI is not configured');

  if (cachedClient) {
    try {
      await cachedClient.db(MONGO_DB_NAME).command({ ping: 1 });
      if (!indexesReady) {
        const col = cachedClient.db(MONGO_DB_NAME).collection<ChatDoc>(CHATS_COLLECTION);
        const throttleCol = cachedClient.db(MONGO_DB_NAME).collection<ChatThrottleDoc>(CHAT_THROTTLES_COLLECTION);
        await col.createIndex({ marketAddress: 1, createdAt: -1 }, { name: 'idx_market_created' });
        await col.createIndex({ marketAddress: 1, authorAddress: 1, createdAt: -1 }, { name: 'idx_market_author_created' });
        await col.createIndex({ authorAddress: 1 }, { name: 'idx_author' });
        await col.createIndex({ replyTo: 1 }, { name: 'idx_reply_to' });
        await throttleCol.createIndex({ marketAddress: 1, authorAddress: 1 }, { unique: true, name: 'uniq_market_author' });
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
  const throttleCol = cachedClient.db(MONGO_DB_NAME).collection<ChatThrottleDoc>(CHAT_THROTTLES_COLLECTION);
  await col.createIndex({ marketAddress: 1, createdAt: -1 }, { name: 'idx_market_created' });
  await col.createIndex({ marketAddress: 1, authorAddress: 1, createdAt: -1 }, { name: 'idx_market_author_created' });
  await col.createIndex({ authorAddress: 1 }, { name: 'idx_author' });
  await col.createIndex({ replyTo: 1 }, { name: 'idx_reply_to' });
  await throttleCol.createIndex({ marketAddress: 1, authorAddress: 1 }, { unique: true, name: 'uniq_market_author' });
  indexesReady = true;

  return cachedClient;
}

async function getProfileByAddress(address: string): Promise<ProfileDoc | null> {
  const client = await getMongoClient();
  const col = client.db(MONGO_DB_NAME).collection<ProfileDoc>(PROFILES_COLLECTION);
  return col.findOne({ address: address.toLowerCase() });
}

function hashChatContent(content: string): string {
  return createHash('sha256').update(content.toLowerCase()).digest('hex');
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

function encodeChatCursor(doc: ChatDoc): string {
  const payload: ChatCursorPayload = {
    createdAt: doc.createdAt.toISOString(),
    _id: doc._id!.toString(),
  };
  return JSON.stringify(payload);
}

function parseChatCursor(cursor: string): { createdAt: Date; id: ObjectId } {
  try {
    const parsed = JSON.parse(cursor) as Partial<ChatCursorPayload>;
    if (!parsed || typeof parsed.createdAt !== 'string' || typeof parsed._id !== 'string') {
      throw new Error('Invalid cursor format.');
    }
    const createdAt = new Date(parsed.createdAt);
    if (isNaN(createdAt.getTime())) throw new Error('Invalid cursor timestamp.');
    const id = new ObjectId(parsed._id);
    return { createdAt, id };
  } catch {
    throw new Error('Invalid cursor.');
  }
}

function getReadProvider(): JsonRpcProvider {
  if (!cachedReadProvider) {
    const rpcUrl = getRequiredRpcUrl();
    cachedReadProvider = new JsonRpcProvider(rpcUrl, undefined, { staticNetwork: true, batchMaxCount: 1 });
  }
  return cachedReadProvider;
}

async function getMarketStage(marketAddress: string): Promise<number> {
  const normalized = normalizeAddress(marketAddress);
  const now = Date.now();
  const cached = marketStageCache.get(normalized);
  if (cached && cached.expiresAt > now) return cached.stage;

  const market = new Contract(normalized, MARKET_STAGE_ABI, getReadProvider());
  const stageRaw: bigint = await market.stage();
  const stage = Number(stageRaw);
  marketStageCache.set(normalized, { stage, expiresAt: now + STAGE_CACHE_MS });
  return stage;
}

function getClientIp(req: any): string {
  const xff = req.headers?.['x-forwarded-for'];
  const raw = Array.isArray(xff) ? xff[0] : (typeof xff === 'string' ? xff.split(',')[0] : req.socket?.remoteAddress || 'unknown');
  return String(raw || 'unknown').trim().slice(0, 64);
}

function enforceIpRateLimit(ip: string): void {
  const now = Date.now();
  const existing = ipRateLimitMap.get(ip);
  if (!existing || now > existing.resetAt) {
    ipRateLimitMap.set(ip, { count: 1, resetAt: now + IP_WINDOW_MS });
    return;
  }
  if (existing.count >= MAX_IP_POSTS_PER_MINUTE) {
    throw new Error('Too many requests. Please slow down.');
  }
  existing.count += 1;
}

async function acquireUserThrottlePermit(
  throttleCol: Collection<ChatThrottleDoc>,
  marketAddress: string,
  authorAddress: string,
  rawContent: string,
): Promise<void> {
  const nowDate = new Date();
  const minIntervalCutoff = new Date(nowDate.getTime() - MIN_MESSAGE_INTERVAL_MS);
  const oneMinuteAgo = new Date(nowDate.getTime() - 60_000);
  const duplicateCutoff = new Date(nowDate.getTime() - DUPLICATE_WINDOW_MS);
  const contentHash = hashChatContent(rawContent);

  const filter = {
    marketAddress,
    authorAddress,
    $and: [
      {
        $or: [
          { lastMessageAt: { $exists: false } },
          { lastMessageAt: { $lte: minIntervalCutoff } },
        ],
      },
      {
        $or: [
          { minuteWindowStart: { $exists: false } },
          { minuteWindowStart: { $lt: oneMinuteAgo } },
          { minuteCount: { $lt: MAX_MESSAGES_PER_MINUTE } },
        ],
      },
      {
        $nor: [
          {
            recentHashes: {
              $elemMatch: {
                hash: contentHash,
                at: { $gte: duplicateCutoff },
              },
            },
          },
        ],
      },
    ],
  };

  const minuteWindowExpiredExpr = {
    $lt: [
      { $ifNull: ['$minuteWindowStart', new Date(0)] },
      oneMinuteAgo,
    ],
  };

  const updatePipeline = [
    {
      $set: {
        marketAddress,
        authorAddress,
        minuteWindowStart: {
          $cond: [minuteWindowExpiredExpr, nowDate, '$minuteWindowStart'],
        },
        minuteCount: {
          $cond: [
            minuteWindowExpiredExpr,
            1,
            { $add: [{ $ifNull: ['$minuteCount', 0] }, 1] },
          ],
        },
        lastMessageAt: nowDate,
        recentHashes: {
          $let: {
            vars: {
              pruned: {
                $filter: {
                  input: { $ifNull: ['$recentHashes', []] },
                  as: 'entry',
                  cond: { $gte: ['$$entry.at', duplicateCutoff] },
                },
              },
            },
            in: {
              $concatArrays: ['$$pruned', [{ hash: contentHash, at: nowDate }]],
            },
          },
        },
        updatedAt: nowDate,
      },
    },
  ];

  const result = await throttleCol.findOneAndUpdate(
    filter,
    updatePipeline as any,
    {
      upsert: true,
      returnDocument: 'after',
    },
  );

  if (result) return;

  const existing = await throttleCol.findOne({ marketAddress, authorAddress });
  if (existing) {
    if (existing.lastMessageAt && existing.lastMessageAt > minIntervalCutoff) {
      throw new Error('You are sending too quickly. Please wait a moment.');
    }
    const duplicate = (existing.recentHashes || []).find((entry) => entry.hash === contentHash && entry.at >= duplicateCutoff);
    if (duplicate) {
      throw new Error('Duplicate message detected. Please post something new.');
    }
    if (existing.minuteWindowStart && existing.minuteWindowStart >= oneMinuteAgo && (existing.minuteCount ?? 0) >= MAX_MESSAGES_PER_MINUTE) {
      throw new Error('Rate limit reached. Please wait before sending again.');
    }
  }

  throw new Error('Rate limit reached. Please wait before sending again.');
}

async function getChatMessages(marketAddress: string, cursor?: string) {
  const client = await getMongoClient();
  const col = client.db(MONGO_DB_NAME).collection<ChatDoc>(CHATS_COLLECTION);
  const profilesCol = client.db(MONGO_DB_NAME).collection<ProfileDoc>(PROFILES_COLLECTION);

  const normalizedMarket = normalizeAddress(marketAddress);

  const query: Record<string, unknown> = { marketAddress: normalizedMarket };
  if (cursor) {
    const parsedCursor = parseChatCursor(cursor);
    query.$or = [
      { createdAt: { $lt: parsedCursor.createdAt } },
      { createdAt: parsedCursor.createdAt, _id: { $lt: parsedCursor.id } },
    ];
  }

  const docs = await col
    .find(query)
    .sort({ createdAt: -1, _id: -1 })
    .limit(PAGE_SIZE + 1)
    .toArray();

  const hasMore = docs.length > PAGE_SIZE;
  const messagesDesc = hasMore ? docs.slice(0, PAGE_SIZE) : docs;
  const messages = [...messagesDesc].reverse();

  const authorAddresses = [...new Set(messages.map(m => m.authorAddress))];
  const replyIds = messages.map(m => m.replyTo).filter((id): id is ObjectId => id !== null);

  const replyDocs = replyIds.length > 0
    ? await col.find({ _id: { $in: replyIds } }).toArray()
    : [];

  const replyAuthorAddresses = [...new Set(replyDocs.map(d => d.authorAddress))];

  const profileAddresses = [...new Set([...authorAddresses, ...replyAuthorAddresses].map((addr) => addr.toLowerCase()))];
  const profileDocs = profileAddresses.length > 0
    ? await profilesCol.find({ address: { $in: profileAddresses } }).toArray()
    : [];
  const profileMap = new Map<string, ProfileDoc>();
  for (const profile of profileDocs) {
    profileMap.set(profile.address.toLowerCase(), profile);
  }

  const authorProfileMap = new Map<string, ProfileDoc | null>();
  authorAddresses.forEach((addr) => {
    authorProfileMap.set(addr.toLowerCase(), profileMap.get(addr.toLowerCase()) || null);
  });

  const replyAuthorProfileMap = new Map<string, ProfileDoc | null>();
  replyAuthorAddresses.forEach((addr) => {
    replyAuthorProfileMap.set(addr.toLowerCase(), profileMap.get(addr.toLowerCase()) || null);
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

  const nextCursor = hasMore && messagesDesc.length > 0
    ? encodeChatCursor(messagesDesc[messagesDesc.length - 1])
    : null;

  return { messages: formatted, hasMore, nextCursor };
}

async function sendChatMessage(
  address: string,
  payload: Record<string, unknown>,
  timestamp: number,
  signature: string,
  req: any,
) {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) throw new Error('Invalid timestamp.');
  const diff = Math.abs(Date.now() - ts);
  if (diff > SIG_VALIDITY_MS) throw new Error('Signature expired. Please try again.');

  const normalized = normalizeAddress(address);

  const content = typeof payload.content === 'string' ? payload.content : '';
  if (!content.trim()) throw new Error('Message cannot be empty.');
  if (content.length > MAX_MESSAGE_LENGTH) throw new Error(`Message exceeds ${MAX_MESSAGE_LENGTH} character limit.`);
  if (containsLink(content)) throw new Error('Links are not allowed in chat messages.');

  const marketAddress = typeof payload.marketAddress === 'string' ? payload.marketAddress : '';
  if (!marketAddress) throw new Error('Market address is required.');

  let normalizedMarket: string;
  try {
    normalizedMarket = normalizeAddress(marketAddress);
  } catch {
    throw new Error('Invalid market address.');
  }

  const replyTo = payload.replyTo ? String(payload.replyTo) : null;

  const message = buildChatSigningMessage(normalized, { content, marketAddress, replyTo }, timestamp);
  let recovered: string;
  try {
    recovered = verifyMessage(message, signature);
  } catch {
    throw new Error('Invalid signature format.');
  }

  if (normalizeAddress(recovered) !== normalized) {
    throw new Error('Invalid signature for wallet address.');
  }

  cleanupInMemoryCaches();
  const clientIp = getClientIp(req);
  enforceIpRateLimit(clientIp);

  const profile = await getProfileByAddress(normalized);
  if (!profile) {
    throw new Error('You need a profile to chat. Create a profile first.');
  }

  const stage = await getMarketStage(normalizedMarket);
  if (stage === STAGE_RESOLVED || stage === STAGE_CANCELLED) {
    throw new Error('Chat is closed for this market.');
  }

  const sanitized = sanitizeChatContent(content);
  if (!sanitized) throw new Error('Message cannot be empty.');
  if (sanitized.length > MAX_MESSAGE_LENGTH) throw new Error(`Message exceeds ${MAX_MESSAGE_LENGTH} character limit.`);
  const mentions = extractMentions(sanitized).slice(0, MAX_MENTIONS);

  const client = await getMongoClient();
  const col = client.db(MONGO_DB_NAME).collection<ChatDoc>(CHATS_COLLECTION);
  const throttleCol = client.db(MONGO_DB_NAME).collection<ChatThrottleDoc>(CHAT_THROTTLES_COLLECTION);

  await acquireUserThrottlePermit(throttleCol, normalizedMarket, normalized, sanitized);

  let replyToObj: ObjectId | null = null;
  if (replyTo) {
    try {
      replyToObj = new ObjectId(replyTo);
      const exists = await col.findOne({ _id: replyToObj, marketAddress: normalizedMarket });
      if (!exists) throw new Error('Reply target not found.');
    } catch (err: any) {
      if (err.message === 'Reply target not found.') throw err;
      throw new Error('Invalid reply reference.');
    }
  }

  const now = new Date();
  const doc: Omit<ChatDoc, '_id'> = {
    marketAddress: normalizedMarket,
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
  const corsOrigin = resolveCorsOrigin(req.headers?.origin);
  if (corsOrigin) {
    res.setHeader('Access-Control-Allow-Origin', corsOrigin);
    res.setHeader('Vary', 'Origin');
  }
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
      if (Array.isArray(cursor)) {
        return res.status(400).json({ error: 'cursor must be a single value' });
      }
      const data = await getChatMessages(marketAddress, typeof cursor === 'string' ? cursor : undefined);
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

      const data = await sendChatMessage(body.address, body.payload, Number(body.timestamp), body.signature, req);
      return res.status(201).json(data);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err: any) {
    const msg = err?.message || 'Unexpected error';
    const msgLower = msg.toLowerCase();
    let code = 500;
    if (msgLower.includes('expired') || msgLower.includes('invalid signature')) {
      code = 401;
    } else if (msgLower.includes('rate limit') || msgLower.includes('too quickly') || msgLower.includes('too many requests')) {
      code = 429;
    } else if (msgLower.includes('duplicate message')) {
      code = 429;
    } else if (msgLower.includes('chat is closed')) {
      code = 403;
    } else if (
      msgLower.includes('profile')
      || msgLower.includes('empty')
      || msgLower.includes('required')
      || msgLower.includes('invalid')
      || msgLower.includes('links are not allowed')
      || msgLower.includes('exceeds')
    ) {
      code = 400;
    } else if (msgLower.includes('reply target')) {
      code = 404;
    } else if (msgLower.includes('mongo_uri') || msgLower.includes('rpc_url') || msgLower.includes('timeout') || msgLower.includes('enotfound')) {
      code = 503;
    }
    return res.status(code).json({ error: msg });
  }
}
