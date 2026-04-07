import { recoverAddress, hashMessage, getAddress } from 'ethers';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { randomBytes } from 'crypto';

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const SIG_VALIDITY_MS = 10 * 60 * 1000;

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET = process.env.R2_BUCKET;
const R2_PUBLIC_BASE_URL = process.env.R2_PUBLIC_BASE_URL;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN;

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

function buildAvatarUploadSigningMessage(address: string, timestamp: number, byteLength: number, contentType: string): string {
  return [
    'AchMarket Avatar Upload',
    `Address: ${address}`,
    `Timestamp: ${timestamp}`,
    `ByteLength: ${byteLength}`,
    `ContentType: ${contentType}`,
    `ValidForMs: ${SIG_VALIDITY_MS}`,
    'No gas fee. Sign only if you trust this request.',
  ].join('\n');
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
  if (!trimmed.startsWith('image/')) return '';
  return trimmed;
}

function buildPublicUrl(key: string): string {
  if (!R2_PUBLIC_BASE_URL || !R2_PUBLIC_BASE_URL.trim()) {
    throw new HttpError(503, 'R2_PUBLIC_BASE_URL is required. Configure R2_PUBLIC_BASE_URL env var for avatar URLs.');
  }
  try {
    new URL(R2_PUBLIC_BASE_URL);
  } catch {
    throw new HttpError(503, 'R2_PUBLIC_BASE_URL is invalid. Configure R2_PUBLIC_BASE_URL with a valid URL.');
  }
  return `${R2_PUBLIC_BASE_URL.replace(/\/$/, '')}/${key}`;
}

function getExtension(contentType: string): string {
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/jpeg') return 'jpg';
  if (contentType === 'image/avif') return 'avif';
  if (contentType === 'image/gif') return 'gif';
  return 'webp';
}

async function uploadAvatar(body: Record<string, unknown>) {
  const addressRaw = typeof body.address === 'string' ? body.address : '';
  const signature = typeof body.signature === 'string' ? body.signature : '';
  const timestamp = Number(body.timestamp);
  const byteLength = Number(body.byteLength);
  const dataBase64 = typeof body.dataBase64 === 'string' ? body.dataBase64 : '';
  const contentType = sanitizeContentType(body.contentType);

  if (!addressRaw || !signature || !dataBase64 || !contentType) {
    throw new HttpError(400, 'address, signature, contentType, and image data are required.');
  }

  if (!Number.isFinite(timestamp)) {
    throw new HttpError(400, 'Invalid timestamp.');
  }
  const age = Math.abs(Date.now() - timestamp);
  if (age > SIG_VALIDITY_MS) {
    throw new HttpError(401, 'Signature expired. Please try again.');
  }

  if (!Number.isFinite(byteLength) || byteLength <= 0) {
    throw new HttpError(400, 'Invalid byteLength.');
  }
  if (byteLength > MAX_UPLOAD_BYTES) {
    throw new HttpError(400, 'Image exceeds 2MB limit.');
  }

  const normalized = normalizeAddress(addressRaw);

  const message = buildAvatarUploadSigningMessage(normalized, timestamp, byteLength, contentType);
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

  const randomSuffix = randomBytes(6).toString('hex');
  const ext = getExtension(contentType);
  const key = `avatars/${normalized}/${Date.now()}-${randomSuffix}.${ext}`;

  const s3 = getS3Client();
  await s3.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: bytes,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable',
  }));

  return {
    url: buildPublicUrl(key),
    key,
    byteLength: bytes.length,
    contentType,
  };
}

export default async function handler(req: any, res: any) {
  const isDevelopment = process.env.NODE_ENV !== 'production';
  const corsOrigin = isDevelopment ? '*' : (ALLOWED_ORIGIN || '');
  if (!corsOrigin) {
    return res.status(503).json({ error: 'ALLOWED_ORIGIN is required in production.' });
  }

  res.setHeader('Access-Control-Allow-Origin', corsOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') {
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
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
    const data = await uploadAvatar(body || {});
    return res.status(200).json(data);
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
