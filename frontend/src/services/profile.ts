import type { Signer } from 'ethers';
import { ethers } from 'ethers';
import {
  buildProfileSigningMessage,
  sanitizeProfilePayload,
  type ProfilePayload,
} from '../utils/profileAuth';
import type { PublicProfileResponse } from '../types/profile';

const PROFILE_API_PATH = '/api/profile';

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
