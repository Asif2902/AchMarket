import { recoverAddress, hashMessage, getAddress } from 'ethers';
import { PutObjectCommand, DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { randomBytes, createHash } from 'crypto';
import {
  MARKET_MEDIA_SIG_VALIDITY_MS,
  buildMarketMediaUploadSigningMessage,
  buildMarketMediaDeleteSigningMessage,
  type MarketMediaKind,
} from '../src/utils/marketMediaSigning';

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const FUTURE_SKEW_MS = 5000;
const MUTATION_WINDOW_MS = 30 * 1000;
const MUTATION_MAX_REQUESTS = 20;
const MUTATION_CLIENT_CACHE_LIMIT = 2000;

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET = process.env.R2_BUCKET;
const R2_PUBLIC_BASE_URL = process.env.R2_PUBLIC_BASE_URL;
const CORS_ALLOWED_ORIGINS = process.env.CORS_ALLOWED_ORIGINS;
const CORS_ALLOWED_ORIGINS_LIST = (CORS_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const ALLOWED_IMAGE_CONTENT_TYPES = new Set([
  'image/webp',
  'image/png',
  'image/jpeg',
  'image/avif',
  'image/gif',
]);
const ALLOWED_MEDIA_KINDS = new Set<MarketMediaKind>(['market-image', 'resolution-proof', 'cancellation-proof']);
const mutationRequestWindows = new Map<string, number[]>();

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let cachedS3: S3Client | null = null;

function normalizeAddress(address: string): string {
  return getAddress(address).toLowerCase();
}

function verifyMessage(message: string, signature: string): string {
  const addr = recoverAddress(hashMessage(message), signature);
  return addr.toLowerCase();
}

function normalizeHexDigest(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(trimmed) ? trimmed : '';
}

function estimateDecodedBase64Bytes(value: string): number {
  const normalized = value.trim().replace(/\s+/g, '');
  if (!normalized || normalized.length % 4 !== 0) return -1;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) return -1;

  let padding = 0;
  if (normalized.endsWith('==')) padding = 2;
  else if (normalized.endsWith('=')) padding = 1;
  return (normalized.length / 4) * 3 - padding;
}

function sha256HexFromBuffer(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function getS3Client(): S3Client {
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
    throw new HttpError(503, 'R2 environment is not fully configured.');
  }

  if (!cachedS3) {
    cachedS3 = new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
    });
  }

  return cachedS3;
}

function sanitizeContentType(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim().toLowerCase();
  return ALLOWED_IMAGE_CONTENT_TYPES.has(trimmed) ? trimmed : '';
}

function sanitizeKind(value: unknown): MarketMediaKind | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase() as MarketMediaKind;
  return ALLOWED_MEDIA_KINDS.has(trimmed) ? trimmed : null;
}

function buildPublicUrl(key: string): string {
  if (!R2_PUBLIC_BASE_URL || !R2_PUBLIC_BASE_URL.trim()) {
    throw new HttpError(503, 'R2_PUBLIC_BASE_URL is required. Configure R2_PUBLIC_BASE_URL env var for media URLs.');
  }
  try {
    new URL(R2_PUBLIC_BASE_URL);
  } catch {
    throw new HttpError(503, 'R2_PUBLIC_BASE_URL is invalid. Configure R2_PUBLIC_BASE_URL with a valid URL.');
  }
  return `${R2_PUBLIC_BASE_URL.replace(/\/$/, '')}/${key}`;
}

function getExtension(contentType: string): string {
  if (contentType === 'image/webp') return 'webp';
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/jpeg') return 'jpg';
  if (contentType === 'image/avif') return 'avif';
  if (contentType === 'image/gif') return 'gif';
  throw new HttpError(400, 'Unsupported image content type.');
}

function safeDecodeKey(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function normalizeDeleteKey(rawKey: unknown): string {
  if (typeof rawKey !== 'string') return '';
  const trimmed = rawKey.trim();
  if (!trimmed) return '';

  const decoded = safeDecodeKey(trimmed);
  if (!decoded) return '';
  return decoded.split('?')[0].trim();
}

function validateTimestamp(timestamp: number): void {
  if (!Number.isFinite(timestamp)) {
    throw new HttpError(400, 'Invalid timestamp.');
  }

  const now = Date.now();
  if (timestamp > now + FUTURE_SKEW_MS) {
    throw new HttpError(400, 'Timestamp is in the future.');
  }
  if (now - timestamp > MARKET_MEDIA_SIG_VALIDITY_MS) {
    throw new HttpError(401, 'Signature expired. Please try again.');
  }
}

function readForwardedFor(raw: unknown): string {
  if (typeof raw === 'string') {
    return raw.split(',')[0]?.trim() ?? '';
  }
  if (Array.isArray(raw)) {
    const first = raw.find((entry) => typeof entry === 'string' && entry.trim());
    return typeof first === 'string' ? first.split(',')[0]?.trim() ?? '' : '';
  }
  return '';
}

function resolveClientKey(req: any): string {
  const fromForwarded = readForwardedFor(req.headers?.['x-forwarded-for']);
  const fromSocket = typeof req.socket?.remoteAddress === 'string' ? req.socket.remoteAddress.trim() : '';
  const base = fromForwarded || fromSocket || 'unknown-client';
  return base.slice(0, 120);
}

function consumeMutationPermit(clientKey: string): number | null {
  const now = Date.now();
  const existing = mutationRequestWindows.get(clientKey) ?? [];
  const windowStart = now - MUTATION_WINDOW_MS;
  const recent = existing.filter((value) => value >= windowStart);

  if (recent.length >= MUTATION_MAX_REQUESTS) {
    mutationRequestWindows.set(clientKey, recent);
    const retryMs = Math.max(0, MUTATION_WINDOW_MS - (now - recent[0]));
    return Math.max(1, Math.ceil(retryMs / 1000));
  }

  recent.push(now);
  mutationRequestWindows.set(clientKey, recent);

  if (mutationRequestWindows.size > MUTATION_CLIENT_CACHE_LIMIT) {
    for (const [key, entries] of mutationRequestWindows.entries()) {
      const filtered = entries.filter((value) => value >= windowStart);
      if (!filtered.length) mutationRequestWindows.delete(key);
      else mutationRequestWindows.set(key, filtered);
      if (mutationRequestWindows.size <= MUTATION_CLIENT_CACHE_LIMIT) break;
    }
  }

  return null;
}

function resolveCorsOrigin(originHeader: unknown): string | null {
  if (process.env.NODE_ENV !== 'production') {
    return '*';
  }
  if (typeof originHeader !== 'string' || !originHeader) return null;
  if (CORS_ALLOWED_ORIGINS_LIST.includes('*')) return originHeader;
  return CORS_ALLOWED_ORIGINS_LIST.includes(originHeader) ? originHeader : null;
}

async function uploadMarketMedia(body: Record<string, unknown>) {
  const addressRaw = typeof body.address === 'string' ? body.address : '';
  const signature = typeof body.signature === 'string' ? body.signature : '';
  const timestamp = Number(body.timestamp);
  const byteLength = Number(body.byteLength);
  const dataBase64 = typeof body.dataBase64 === 'string' ? body.dataBase64 : '';
  const contentType = sanitizeContentType(body.contentType);
  const contentDigest = normalizeHexDigest(body.contentDigest);
  const kind = sanitizeKind(body.kind);

  if (!addressRaw || !signature || !dataBase64 || !contentType || !contentDigest || !kind) {
    throw new HttpError(400, 'address, signature, kind, contentType, contentDigest, and image data are required.');
  }

  if (!Number.isFinite(timestamp)) {
    throw new HttpError(400, 'Invalid timestamp.');
  }
  validateTimestamp(timestamp);

  if (!Number.isFinite(byteLength) || byteLength <= 0) {
    throw new HttpError(400, 'Invalid byteLength.');
  }
  if (byteLength > MAX_UPLOAD_BYTES) {
    throw new HttpError(400, 'Image exceeds 2MB limit.');
  }

  const estimatedBytes = estimateDecodedBase64Bytes(dataBase64);
  if (estimatedBytes <= 0) {
    throw new HttpError(400, 'Invalid base64 image payload.');
  }
  if (estimatedBytes > MAX_UPLOAD_BYTES) {
    throw new HttpError(400, 'Image exceeds 2MB limit.');
  }
  if (estimatedBytes !== byteLength) {
    throw new HttpError(400, 'byteLength mismatch.');
  }

  const normalized = normalizeAddress(addressRaw);

  const message = buildMarketMediaUploadSigningMessage(normalized, kind, timestamp, byteLength, contentType, contentDigest);
  let recovered: string;
  try {
    recovered = verifyMessage(message, signature);
  } catch {
    throw new HttpError(401, 'Invalid signature format.');
  }

  if (normalizeAddress(recovered) !== normalized) {
    throw new HttpError(401, 'Invalid signature for wallet address.');
  }

  const bytes = Buffer.from(dataBase64, 'base64');
  if (!bytes.length) {
    throw new HttpError(400, 'Invalid image data.');
  }
  if (bytes.length !== byteLength) {
    throw new HttpError(400, 'byteLength mismatch.');
  }
  if (bytes.length > MAX_UPLOAD_BYTES) {
    throw new HttpError(400, 'Image exceeds 2MB limit.');
  }

  const computedDigest = sha256HexFromBuffer(bytes);
  if (computedDigest !== contentDigest) {
    throw new HttpError(400, 'contentDigest mismatch.');
  }

  const randomSuffix = randomBytes(6).toString('hex');
  const ext = getExtension(contentType);
  const key = `market-media/${kind}/${normalized}/${Date.now()}-${randomSuffix}.${ext}`;
  const publicUrl = buildPublicUrl(key);

  const s3 = getS3Client();
  await s3.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: bytes,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable',
  }));

  return {
    url: publicUrl,
    key,
    byteLength: bytes.length,
    contentType,
    kind,
  };
}

async function deleteMarketMedia(body: Record<string, unknown>): Promise<void> {
  const addressRaw = typeof body.address === 'string' ? body.address : '';
  const signature = typeof body.signature === 'string' ? body.signature : '';
  const key = normalizeDeleteKey(body.key);
  const timestamp = Number(body.timestamp);

  if (!addressRaw || !signature || !key) {
    throw new HttpError(400, 'address, signature, and key are required.');
  }

  validateTimestamp(timestamp);

  const normalized = normalizeAddress(addressRaw);
  const expectedPrefix = 'market-media/';
  const userPrefix = `/${normalized}/`;
  if (!key.startsWith(expectedPrefix) || !key.includes(userPrefix)) {
    throw new HttpError(400, 'Invalid media key.');
  }

  const message = buildMarketMediaDeleteSigningMessage(normalized, timestamp, key);
  let recovered: string;
  try {
    recovered = verifyMessage(message, signature);
  } catch {
    throw new HttpError(401, 'Invalid signature format.');
  }

  if (normalizeAddress(recovered) !== normalized) {
    throw new HttpError(401, 'Invalid signature for wallet address.');
  }

  if (!R2_BUCKET) {
    throw new HttpError(503, 'R2 environment is not fully configured.');
  }

  const s3 = getS3Client();
  await s3.send(new DeleteObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
  }));
}

export default async function handler(req: any, res: any) {
  const corsOrigin = resolveCorsOrigin(req.headers?.origin);

  if (corsOrigin) {
    res.setHeader('Access-Control-Allow-Origin', corsOrigin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') {
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const clientKey = resolveClientKey(req);
  const retryAfterSeconds = consumeMutationPermit(clientKey);
  if (retryAfterSeconds !== null) {
    res.setHeader('Retry-After', String(retryAfterSeconds));
    return res.status(429).json({ error: 'Too many media requests. Please retry shortly.' });
  }

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        throw new HttpError(400, 'Invalid JSON');
      }
    }
    if (req.method === 'POST') {
      const data = await uploadMarketMedia(body || {});
      return res.status(200).json(data);
    }

    await deleteMarketMedia(body || {});
    return res.status(200).json({ ok: true });
  } catch (err: any) {
    if (typeof err?.status === 'number') {
      return res.status(err.status).json({ error: err.message || 'Unexpected error' });
    }

    if (err?.code === 'AccessDenied' || err?.code === 'InvalidAccessKeyId' || err?.code === 'SignatureDoesNotMatch') {
      return res.status(503).json({ error: 'R2 credentials are invalid or unauthorized.' });
    }

    const message = err?.message || 'Unexpected error';
    const lower = message.toLowerCase();
    let code = 500;
    if (lower.includes('signature') || lower.includes('expired')) code = 401;
    else if (lower.includes('method')) code = 405;
    else if (lower.includes('required') || lower.includes('invalid') || lower.includes('limit') || lower.includes('mismatch')) code = 400;
    else if (lower.includes('configured')) code = 503;
    return res.status(code).json({ error: message });
  }
}
