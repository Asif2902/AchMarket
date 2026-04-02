import { ethers } from 'ethers';

export interface ProfilePayload {
  displayName: string;
  avatarUrl: string;
  twitterUrl: string;
  discordUrl: string;
  telegramUrl: string;
}

export const EMPTY_PROFILE_PAYLOAD: ProfilePayload = {
  displayName: '',
  avatarUrl: '',
  twitterUrl: '',
  discordUrl: '',
  telegramUrl: '',
};

export function normalizeProfileSlug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/_{2,}/g, '_')
    .replace(/-{2,}/g, '-')
    .slice(0, 40);
}

const MAX_NAME_LENGTH = 40;
const MAX_URL_LENGTH = 300;

function clip(value: string, maxLength: number): string {
  return value.trim().slice(0, maxLength);
}

function isAllowedUrl(value: string): boolean {
  if (!value) return true;
  if (value.startsWith('ipfs://')) return true;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function sanitizeUrl(value: string): string {
  const clipped = clip(value, MAX_URL_LENGTH);
  return isAllowedUrl(clipped) ? clipped : '';
}

export function normalizeAddress(address: string): string {
  return ethers.getAddress(address).toLowerCase();
}

export function sanitizeProfilePayload(input: Partial<ProfilePayload>): ProfilePayload {
  return {
    displayName: clip(input.displayName ?? '', MAX_NAME_LENGTH),
    avatarUrl: sanitizeUrl(input.avatarUrl ?? ''),
    twitterUrl: sanitizeUrl(input.twitterUrl ?? ''),
    discordUrl: sanitizeUrl(input.discordUrl ?? ''),
    telegramUrl: sanitizeUrl(input.telegramUrl ?? ''),
  };
}

export function buildProfileSigningMessage(address: string, payload: ProfilePayload, timestamp: number): string {
  const normalizedAddress = normalizeAddress(address);
  const normalizedPayload = sanitizeProfilePayload(payload);
  const serializedPayload = JSON.stringify(normalizedPayload);

  return [
    'AchMarket Profile Update',
    `Address: ${normalizedAddress}`,
    `Timestamp: ${timestamp}`,
    `Payload: ${serializedPayload}`,
    'No gas fee. Sign only if you trust this request.',
  ].join('\n');
}
