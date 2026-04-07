import type { Signer } from 'ethers';
import { ethers } from 'ethers';
import {
  buildProfileSigningMessage,
  sanitizeProfilePayload,
  type ProfilePayload,
} from '../utils/profileAuth';
import type { PublicProfileResponse, ProfileAvatarUploadResponse } from '../types/profile';

const PROFILE_API_PATH = '/api/profile';
const PROFILE_AVATAR_API_PATH = '/api/profile-avatar';
const AVATAR_UPLOAD_SIG_VALIDITY_MS = 10 * 60 * 1000;

function uint8ToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto API is unavailable in this browser.');
  }
  const stableInput = new Uint8Array(bytes.byteLength);
  stableInput.set(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', stableInput);
  return uint8ToHex(new Uint8Array(digest));
}

function buildAvatarUploadSigningMessage(
  address: string,
  timestamp: number,
  byteLength: number,
  contentType: string,
  contentDigest: string,
): string {
  return [
    'AchMarket Avatar Upload',
    `Address: ${address}`,
    `Timestamp: ${timestamp}`,
    `ByteLength: ${byteLength}`,
    `ContentType: ${contentType}`,
    `ContentDigest: ${contentDigest}`,
    `ValidForMs: ${AVATAR_UPLOAD_SIG_VALIDITY_MS}`,
    'No gas fee. Sign only if you trust this request.',
  ].join('\n');
}

async function parseApiResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errorMessage = typeof body?.error === 'string' ? body.error : 'Request failed';
    throw new Error(errorMessage);
  }
  return body as T;
}

function withCacheBust(url: string): string {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}t=${Date.now()}`;
}

export async function fetchProfileByAddress(address: string): Promise<PublicProfileResponse> {
  const normalized = ethers.getAddress(address);
  const response = await fetch(withCacheBust(`${PROFILE_API_PATH}?address=${encodeURIComponent(normalized)}`));
  return parseApiResponse<PublicProfileResponse>(response);
}

export async function fetchProfileBySlug(slug: string): Promise<PublicProfileResponse> {
  const response = await fetch(withCacheBust(`${PROFILE_API_PATH}?slug=${encodeURIComponent(slug)}`));
  return parseApiResponse<PublicProfileResponse>(response);
}

export async function saveProfileBySignature(
  address: string,
  payload: Partial<ProfilePayload>,
  signer: Signer,
): Promise<PublicProfileResponse> {
  const normalized = ethers.getAddress(address);
  const sanitized = sanitizeProfilePayload(payload);
  const timestamp = Date.now();
  const message = buildProfileSigningMessage(normalized, sanitized, timestamp);
  const signature = await signer.signMessage(message);

  const response = await fetch(PROFILE_API_PATH, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      address: normalized,
      payload: sanitized,
      timestamp,
      signature,
    }),
  });

  return parseApiResponse<PublicProfileResponse>(response);
}

export async function uploadProfileAvatar(file: File, address: string, signer: Signer): Promise<ProfileAvatarUploadResponse> {
  if (!file || file.size <= 0) {
    throw new Error('No file selected.');
  }

  const normalized = ethers.getAddress(address).toLowerCase();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const dataBase64 = uint8ToBase64(bytes);
  const timestamp = Date.now();
  const contentType = file.type || 'application/octet-stream';
  const contentDigest = await sha256Hex(bytes);

  const message = buildAvatarUploadSigningMessage(normalized, timestamp, bytes.length, contentType, contentDigest);
  const signature = await signer.signMessage(message);

  const response = await fetch(PROFILE_AVATAR_API_PATH, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      address: normalized,
      timestamp,
      signature,
      fileName: file.name,
      contentType,
      byteLength: bytes.length,
      contentDigest,
      dataBase64,
    }),
  });

  return parseApiResponse<ProfileAvatarUploadResponse>(response);
}

export async function deleteProfileAvatar(
  address: string,
  key: string,
  signer: Signer,
): Promise<void> {
  const normalized = ethers.getAddress(address).toLowerCase();
  const timestamp = Date.now();
  const payload = {
    address: normalized,
    key,
    timestamp,
    action: 'delete-avatar',
  } as const;

  const message = [
    'AchMarket Avatar Delete',
    `Address: ${normalized}`,
    `Timestamp: ${timestamp}`,
    `Key: ${key}`,
    'No gas fee. Sign only if you trust this request.',
  ].join('\n');
  const signature = await signer.signMessage(message);

  const response = await fetch(PROFILE_AVATAR_API_PATH, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ...payload, signature }),
  });

  await parseApiResponse<{ ok: true }>(response);
}
