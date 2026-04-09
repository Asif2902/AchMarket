export const MARKET_MEDIA_SIG_VALIDITY_MS = 10 * 60 * 1000;

export type MarketMediaKind = 'market-image' | 'resolution-proof' | 'cancellation-proof';

export function buildMarketMediaUploadSigningMessage(
  address: string,
  kind: MarketMediaKind,
  timestamp: number,
  byteLength: number,
  contentType: string,
  contentDigest: string,
): string {
  return [
    'AchMarket Market Media Upload',
    `Address: ${address}`,
    `Kind: ${kind}`,
    `Timestamp: ${timestamp}`,
    `ByteLength: ${byteLength}`,
    `ContentType: ${contentType}`,
    `ContentDigest: ${contentDigest}`,
    `ValidForMs: ${MARKET_MEDIA_SIG_VALIDITY_MS}`,
    'No gas fee. Sign only if you trust this request.',
  ].join('\n');
}

export function buildMarketMediaDeleteSigningMessage(address: string, timestamp: number, key: string): string {
  return [
    'AchMarket Market Media Delete',
    `Address: ${address}`,
    `Timestamp: ${timestamp}`,
    `Key: ${key}`,
    'No gas fee. Sign only if you trust this request.',
  ].join('\n');
}
