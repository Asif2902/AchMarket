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

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function buildAvatarUploadSigningMessage(address: string, timestamp: number, byteLength: number, contentType: string): string {
  return [
    'AchMarket Avatar Upload',
    `Address: ${address}`,
    `Timestamp: ${timestamp}`,
    `ByteLength: ${byteLength}`,
    `ContentType: ${contentType}`,
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

  const message = buildAvatarUploadSigningMessage(normalized, timestamp, file.size, contentType);
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
      byteLength: file.size,
      dataBase64,
    }),
  });

  return parseApiResponse<ProfileAvatarUploadResponse>(response);
}
