export const AVATAR_UPLOAD_SIG_VALIDITY_MS = 10 * 60 * 1000;

export function buildAvatarUploadSigningMessage(
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

export function buildAvatarDeleteSigningMessage(address: string, timestamp: number, key: string): string {
  return [
    'AchMarket Avatar Delete',
    `Address: ${address}`,
    `Timestamp: ${timestamp}`,
    `Key: ${key}`,
    'No gas fee. Sign only if you trust this request.',
  ].join('\n');
}
