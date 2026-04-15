import { ethers } from 'ethers';
import type { Signer } from 'ethers';
import type {
  LiveFeedConfig,
  LiveFeedConfigInput,
  LiveMarketDataResponse,
} from '../types/live';

const LIVE_FEED_CONFIG_API_PATH = '/api/live-feed-config';
const LIVE_MARKET_API_PATH = '/api/live-market';

function serializeLiveFeedPayload(payload: LiveFeedConfigInput): string {
  if (payload.kind === 'crypto-price') {
    return JSON.stringify({
      marketAddress: payload.marketAddress,
      enabled: payload.enabled,
      kind: payload.kind,
      crypto: {
        coingeckoId: payload.crypto.coingeckoId,
        baseSymbol: payload.crypto.baseSymbol,
        quoteSymbol: payload.crypto.quoteSymbol,
        vsCurrency: payload.crypto.vsCurrency,
      },
      sports: null,
    });
  }

  return JSON.stringify({
    marketAddress: payload.marketAddress,
    enabled: payload.enabled,
    kind: payload.kind,
    crypto: null,
    sports: {
      eventId: payload.sports.eventId,
      leagueName: payload.sports.leagueName,
    },
  });
}

function buildLiveFeedSigningMessage(address: string, payload: LiveFeedConfigInput, timestamp: number): string {
  return [
    'AchMarket Live Feed Config',
    `Address: ${address}`,
    `Timestamp: ${timestamp}`,
    `Payload: ${serializeLiveFeedPayload(payload)}`,
    'No gas fee. Sign only if you trust this request.',
  ].join('\n');
}

function withCacheBust(url: string): string {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}t=${Date.now()}`;
}

async function parseApiResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errorMessage = typeof body?.error === 'string' ? body.error : 'Request failed';
    throw new Error(errorMessage);
  }
  return body as T;
}

function sanitizeMarketAddress(value: string): string {
  return ethers.getAddress(value).toLowerCase();
}

function sanitizeSymbol(value: string): string {
  return value.trim().toUpperCase();
}

function sanitizeLiveFeedInput(input: LiveFeedConfigInput): LiveFeedConfigInput {
  const marketAddress = sanitizeMarketAddress(input.marketAddress);
  const enabled = Boolean(input.enabled);

  if (input.kind === 'crypto-price') {
    return {
      marketAddress,
      enabled,
      kind: 'crypto-price',
      crypto: {
        coingeckoId: input.crypto.coingeckoId.trim().toLowerCase(),
        baseSymbol: sanitizeSymbol(input.crypto.baseSymbol),
        quoteSymbol: sanitizeSymbol(input.crypto.quoteSymbol),
        vsCurrency: input.crypto.vsCurrency.trim().toLowerCase(),
      },
      sports: null,
    };
  }

  return {
    marketAddress,
    enabled,
    kind: 'sports-score',
    crypto: null,
    sports: {
      eventId: input.sports.eventId.trim(),
      leagueName: input.sports.leagueName.trim(),
    },
  };
}

export async function fetchLiveFeedConfig(marketAddress: string): Promise<LiveFeedConfig | null> {
  const normalized = sanitizeMarketAddress(marketAddress);
  const response = await fetch(withCacheBust(`${LIVE_FEED_CONFIG_API_PATH}?marketAddress=${encodeURIComponent(normalized)}`));
  const body = await parseApiResponse<{ config: LiveFeedConfig | null }>(response);
  return body.config;
}

export async function fetchLiveFeedConfigs(marketAddresses: string[]): Promise<LiveFeedConfig[]> {
  if (!marketAddresses.length) return [];
  const normalized = Array.from(new Set(marketAddresses.map(sanitizeMarketAddress)));
  const response = await fetch(withCacheBust(`${LIVE_FEED_CONFIG_API_PATH}?marketAddresses=${encodeURIComponent(normalized.join(','))}`));
  const body = await parseApiResponse<{ configs: LiveFeedConfig[] }>(response);
  return Array.isArray(body.configs) ? body.configs : [];
}

export async function saveLiveFeedConfig(
  address: string,
  payload: LiveFeedConfigInput,
  signer: Signer,
): Promise<LiveFeedConfig> {
  const normalizedAddress = sanitizeMarketAddress(address);
  const sanitizedPayload = sanitizeLiveFeedInput(payload);
  const timestamp = Date.now();
  const message = buildLiveFeedSigningMessage(normalizedAddress, sanitizedPayload, timestamp);
  const signature = await signer.signMessage(message);

  const response = await fetch(LIVE_FEED_CONFIG_API_PATH, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      address: normalizedAddress,
      timestamp,
      signature,
      payload: sanitizedPayload,
    }),
  });

  const body = await parseApiResponse<{ config: LiveFeedConfig }>(response);
  return body.config;
}

export async function fetchLiveMarketData(marketAddress: string): Promise<LiveMarketDataResponse> {
  const normalized = sanitizeMarketAddress(marketAddress);
  const response = await fetch(withCacheBust(`${LIVE_MARKET_API_PATH}?marketAddress=${encodeURIComponent(normalized)}`));
  return parseApiResponse<LiveMarketDataResponse>(response);
}
