import { recoverAddress, hashMessage, getAddress } from 'ethers';

export const SIG_VALIDITY_MS = 10 * 60 * 1000; // 10 minutes

export interface SignedRequest {
  address: string;
  timestamp: number;
  signature: string;
}

export function serializeLiveFeedPayload(payload: any): string {
  if (payload?.kind === 'crypto-price') {
    return JSON.stringify({
      marketAddress: payload.marketAddress,
      enabled: payload.enabled,
      kind: payload.kind,
      crypto: {
        coingeckoId: payload.crypto.coingeckoId,
        baseSymbol: payload.crypto.baseSymbol,
        quoteSymbol: payload.crypto.quoteSymbol,
        vsCurrency: payload.crypto.vsCurrency,
        metric: payload.crypto.metric,
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
      homeTeam: payload.sports.homeTeam || undefined,
      awayTeam: payload.sports.awayTeam || undefined,
      forceUpcoming: payload.sports.forceUpcoming,
    },
  });
}

export function extractSignedHeaders(req: any): SignedRequest {
  const address = typeof req.headers?.['x-wallet-address'] === 'string'
    ? getAddress(req.headers['x-wallet-address']).toLowerCase()
    : '';
  const timestamp = Number(req.headers?.['x-timestamp'] ?? req.body?.timestamp);
  const signature = typeof req.headers?.['x-signature'] === 'string'
    ? req.headers['x-signature'].trim()
    : '';

  if (!address) throw new Error('Wallet address is required.');
  if (!signature) throw new Error('Signature is required.');
  if (!Number.isFinite(timestamp)) throw new Error('Invalid timestamp.');

  return { address, timestamp, signature };
}

export function verifySignedMessage(
  address: string,
  timestamp: number,
  signature: string,
  message: string,
  validityMs: number = SIG_VALIDITY_MS,
): void {
  const now = Date.now();
  if (timestamp > now + 5000) throw new Error('Timestamp is in the future.');
  if (now - timestamp > validityMs) throw new Error('Signature expired. Please try again.');

  let recovered: string;
  try {
    recovered = recoverAddress(hashMessage(message), signature).toLowerCase();
  } catch {
    throw new Error('Invalid signature format.');
  }

  if (recovered !== address.toLowerCase()) {
    throw new Error('Invalid signature for wallet address.');
  }
}
