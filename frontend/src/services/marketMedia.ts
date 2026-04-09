import type { Signer } from 'ethers';
import { ethers } from 'ethers';
import {
  buildMarketMediaUploadSigningMessage,
  buildMarketMediaDeleteSigningMessage,
  type MarketMediaKind,
} from '../utils/marketMediaSigning';

const MARKET_MEDIA_API_PATH = '/api/market-media';

export interface MarketMediaUploadResponse {
  url: string;
  key: string;
  byteLength: number;
  contentType: string;
  kind: MarketMediaKind;
}

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

async function parseApiResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errorMessage = typeof body?.error === 'string' ? body.error : 'Request failed';
    throw new Error(errorMessage);
  }
  return body as T;
}

export async function uploadMarketMedia(
  file: File,
  address: string,
  signer: Signer,
  kind: MarketMediaKind,
): Promise<MarketMediaUploadResponse> {
  if (!file || file.size <= 0) {
    throw new Error('No file selected.');
  }

  const normalized = ethers.getAddress(address).toLowerCase();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const dataBase64 = uint8ToBase64(bytes);
  const timestamp = Date.now();
  const contentType = file.type || 'application/octet-stream';
  const contentDigest = await sha256Hex(bytes);

  const message = buildMarketMediaUploadSigningMessage(
    normalized,
    kind,
    timestamp,
    bytes.length,
    contentType,
    contentDigest,
  );
  const signature = await signer.signMessage(message);

  const response = await fetch(MARKET_MEDIA_API_PATH, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      address: normalized,
      kind,
      timestamp,
      signature,
      contentType,
      byteLength: bytes.length,
      contentDigest,
      dataBase64,
    }),
  });

  return parseApiResponse<MarketMediaUploadResponse>(response);
}

export async function deleteMarketMedia(
  address: string,
  key: string,
  signer: Signer,
): Promise<void> {
  const normalized = ethers.getAddress(address).toLowerCase();
  const timestamp = Date.now();
  const message = buildMarketMediaDeleteSigningMessage(normalized, timestamp, key);
  const signature = await signer.signMessage(message);

  const response = await fetch(MARKET_MEDIA_API_PATH, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      address: normalized,
      key,
      timestamp,
      signature,
    }),
  });

  await parseApiResponse<{ ok: true }>(response);
}
