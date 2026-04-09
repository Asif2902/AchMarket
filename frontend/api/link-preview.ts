import dns from 'dns/promises';
import { isIP } from 'net';
import { Agent, buildConnector, fetch as undiciFetch } from 'undici';

const REQUEST_TIMEOUT_MS = 8000; // Vercel serverless function timeout
const MAX_HTML_BYTES = 300000;
const MAX_REDIRECTS = 5;

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type PublicHostResolution = {
  host: string;
  address: string;
};

type FetchResponse = Awaited<ReturnType<typeof undiciFetch>>;

type FetchWithCleanupResult = {
  response: FetchResponse;
  cleanup: () => Promise<void>;
};

function normalizeBracketedHost(hostname: string): string {
  const trimmed = hostname.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) return trimmed.slice(1, -1);
  return trimmed;
}

function isPrivateIpv4(host: string): boolean {
  const parts = host.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  const [a, b, c, d] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a >= 224 && a <= 239) return true;
  if (a === 255 && b === 255 && c === 255 && d === 255) return true;
  if (a >= 240) return true;
  return false;
}

function parseIpv6(value: string): number[] | null {
  const raw = value.trim().toLowerCase();
  if (!raw || !raw.includes(':')) return null;

  const segments = raw.split('::');
  if (segments.length > 2) return null;

  const parseHalf = (part: string): number[] => {
    if (!part) return [];
    return part.split(':').map((segment) => {
      if (!segment) return -1;
      const valueNum = parseInt(segment, 16);
      return Number.isNaN(valueNum) || valueNum < 0 || valueNum > 0xffff ? -1 : valueNum;
    });
  };

  const left = parseHalf(segments[0]);
  const right = parseHalf(segments[1] ?? '');
  if (left.includes(-1) || right.includes(-1)) return null;

  if (segments.length === 1 && left.length !== 8) return null;
  if (segments.length === 2 && left.length + right.length > 8) return null;

  const fillCount = 8 - (left.length + right.length);
  const filled = segments.length === 2 ? [...left, ...new Array(fillCount).fill(0), ...right] : left;
  return filled.length === 8 ? filled : null;
}

function isPrivateIpv6(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  if (normalized === '::1' || normalized === '::') return true;

  const isIpv4MappedPrefix = (parts: number[]): boolean => {
    return (
      (parts[0] === 0 &&
        parts[1] === 0 &&
        parts[2] === 0 &&
        parts[3] === 0 &&
        parts[4] === 0 &&
        parts[5] === 0xffff) ||
      (parts[0] === 0 &&
        parts[1] === 0 &&
        parts[2] === 0 &&
        parts[3] === 0 &&
        parts[4] === 0xffff &&
        parts[5] === 0)
    );
  };

  const ipv4FromMappedParts = (parts: number[]): string => {
    const a = parts[6] >> 8;
    const b = parts[6] & 0xff;
    const c = parts[7] >> 8;
    const d = parts[7] & 0xff;
    return `${a}.${b}.${c}.${d}`;
  };

  const mappedIpv4Match = normalized.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mappedIpv4Match?.[2]) {
    const mappedIpv4 = mappedIpv4Match[2];
    if (isIP(mappedIpv4) !== 4) return false;

    const [a, b, c, d] = mappedIpv4.split('.').map((part) => Number(part));
    const high = ((a << 8) | b).toString(16);
    const low = ((c << 8) | d).toString(16);
    const mappedParts = parseIpv6(`${mappedIpv4Match[1]}${high}:${low}`);

    return mappedParts && isIpv4MappedPrefix(mappedParts) ? isPrivateIpv4(mappedIpv4) : false;
  }

  const parts = parseIpv6(normalized);
  if (!parts) return true;

  const isUnspecified = parts.every((part) => part === 0);
  if (isUnspecified) return true;

  const isLoopback =
    parts[0] === 0 &&
    parts[1] === 0 &&
    parts[2] === 0 &&
    parts[3] === 0 &&
    parts[4] === 0 &&
    parts[5] === 0 &&
    parts[6] === 0 &&
    parts[7] === 1;
  if (isLoopback) return true;

  if (isIpv4MappedPrefix(parts)) {
    return isPrivateIpv4(ipv4FromMappedParts(parts));
  }

  const first = parts[0];
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
  return false;
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  if (!host) return true;
  if (host === 'localhost') return true;
  if (host.endsWith('.localhost')) return true;
  if (host.endsWith('.local')) return true;

  const normalizedHost = normalizeBracketedHost(host);

  const ipVersion = isIP(normalizedHost);
  if (ipVersion === 4) return isPrivateIpv4(normalizedHost);
  if (ipVersion === 6) return isPrivateIpv6(normalizedHost);

  return false;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .trim();
}

function extractMetaByKey(html: string, key: string, attr: 'name' | 'property'): string {
  const lowerHtml = html.toLowerCase();
  const headStart = lowerHtml.indexOf('<head');
  const headOpenEnd = headStart >= 0 ? lowerHtml.indexOf('>', headStart) : -1;
  const headEnd = headOpenEnd >= 0 ? lowerHtml.indexOf('</head>', headOpenEnd + 1) : -1;
  const headSlice =
    headStart >= 0 && headOpenEnd >= 0 && headEnd > headOpenEnd ? html.slice(headOpenEnd + 1, headEnd) : html;

  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patternA = new RegExp(
    `<meta[^>]*${attr}\\s*=\\s*(['"])${escapedKey}\\1[^>]*content\\s*=\\s*(['"])([\\s\\S]*?)\\2[^>]*>`,
    'i',
  );
  const patternB = new RegExp(
    `<meta[^>]*content\\s*=\\s*(['"])([\\s\\S]*?)\\1[^>]*${attr}\\s*=\\s*(['"])${escapedKey}\\3[^>]*>`,
    'i',
  );

  const matchA = headSlice.match(patternA);
  if (matchA?.[3]) return decodeHtmlEntities(matchA[3]);

  const matchB = headSlice.match(patternB);
  if (matchB?.[2]) return decodeHtmlEntities(matchB[2]);

  return '';
}

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return decodeHtmlEntities(match?.[1] ?? '').replace(/\s+/g, ' ').trim();
}

function pickFirstNonEmpty(values: Array<string | null | undefined>): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function normalizeTargetUrl(raw: unknown): URL {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new HttpError(400, 'url query parameter is required.');
  }

  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new HttpError(400, 'Invalid URL.');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new HttpError(400, 'Only HTTP(S) URLs are supported.');
  }

  if (isPrivateHost(parsed.hostname)) {
    throw new HttpError(400, 'Private/local URLs are not allowed.');
  }

  return parsed;
}

function toAbsoluteUrl(urlLike: string, baseUrl: string): string {
  if (!urlLike) return '';
  try {
    return new URL(urlLike, baseUrl).toString();
  } catch {
    return '';
  }
}

function normalizeOrigin(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return '';
  try {
    return new URL(raw).origin;
  } catch {
    return '';
  }
}

type HostSourcePattern = {
  scheme: string | null;
  hostname: string;
  wildcard: boolean;
  port: string | null;
};

function getOriginPort(origin: URL): string {
  if (origin.port) return origin.port;
  if (origin.protocol === 'https:') return '443';
  if (origin.protocol === 'http:') return '80';
  return '';
}

function parseHostSourcePattern(pattern: string): HostSourcePattern | null {
  const normalized = pattern.trim().toLowerCase();
  if (!normalized) return null;

  let scheme: string | null = null;
  let hostPort = normalized;
  const schemeSeparator = normalized.indexOf('://');
  if (schemeSeparator >= 0) {
    scheme = normalized.slice(0, schemeSeparator);
    if (!/^[a-z][a-z0-9+.-]*$/.test(scheme)) return null;
    hostPort = normalized.slice(schemeSeparator + 3);
  }

  if (!hostPort || hostPort.includes('/') || hostPort.includes('?') || hostPort.includes('#')) {
    return null;
  }

  let hostname = '';
  let port: string | null = null;
  let wildcard = false;

  if (hostPort.startsWith('[')) {
    const closeBracket = hostPort.indexOf(']');
    if (closeBracket < 0) return null;
    hostname = hostPort.slice(0, closeBracket + 1);
    const remainder = hostPort.slice(closeBracket + 1);
    if (remainder) {
      if (!remainder.startsWith(':')) return null;
      port = remainder.slice(1);
    }
  } else {
    const colonIndex = hostPort.lastIndexOf(':');
    const hasSingleColon = colonIndex > -1 && hostPort.indexOf(':') === colonIndex;
    if (hasSingleColon) {
      hostname = hostPort.slice(0, colonIndex);
      port = hostPort.slice(colonIndex + 1);
    } else {
      hostname = hostPort;
    }

    if (hostname.startsWith('*.')) {
      wildcard = true;
      hostname = hostname.slice(2);
    }
  }

  if (!hostname) return null;
  if (port !== null && port !== '*' && !/^\d+$/.test(port)) return null;

  return {
    scheme,
    hostname,
    wildcard,
    port,
  };
}

function matchesHostSourceOrigin(pattern: string, origin: string): boolean {
  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    return false;
  }

  const parsedPattern = parseHostSourcePattern(pattern);
  if (!parsedPattern) return false;

  if (parsedPattern.scheme && parsedOrigin.protocol !== `${parsedPattern.scheme}:`) {
    return false;
  }

  const originHost = normalizeBracketedHost(parsedOrigin.hostname.toLowerCase());
  const patternHost = normalizeBracketedHost(parsedPattern.hostname.toLowerCase());

  if (parsedPattern.wildcard) {
    if (!patternHost || originHost === patternHost) return false;
    if (!originHost.endsWith(`.${patternHost}`)) return false;
  } else if (originHost !== patternHost) {
    return false;
  }

  if (parsedPattern.port && parsedPattern.port !== '*') {
    const originPort = getOriginPort(parsedOrigin);
    if (originPort !== parsedPattern.port) return false;
  }

  return true;
}

function tokenAllowsOrigin(token: string, embedOrigin: string, targetOrigin: string): boolean {
  const normalized = token.trim();
  if (!normalized) return false;

  if (normalized === "'self'") {
    return embedOrigin !== '' && embedOrigin === targetOrigin;
  }
  if (normalized === '*') {
    return true;
  }
  if (normalized === 'https:') {
    return embedOrigin.startsWith('https://');
  }
  if (normalized === 'http:') {
    return embedOrigin.startsWith('http://');
  }

  if (!embedOrigin) return false;

  if (!normalized.includes('://')) {
    return matchesHostSourceOrigin(normalized, embedOrigin);
  }

  if (matchesHostSourceOrigin(normalized, embedOrigin)) {
    return true;
  }

  try {
    return new URL(normalized).origin === embedOrigin;
  } catch {
    return false;
  }
}

function analyzeFrameEmbeddability(params: {
  finalUrl: string;
  xFrameOptions: string;
  contentSecurityPolicy: string;
  embedOrigin: string;
}): { embeddable: boolean; reason: string } {
  const { finalUrl, xFrameOptions, contentSecurityPolicy, embedOrigin } = params;

  let targetOrigin = '';
  try {
    targetOrigin = new URL(finalUrl).origin;
  } catch {
    targetOrigin = '';
  }

  const xfo = xFrameOptions.trim().toLowerCase();
  if (xfo.includes('deny')) {
    return { embeddable: false, reason: 'Blocked by X-Frame-Options: DENY.' };
  }

  if (xfo.includes('sameorigin')) {
    if (!embedOrigin || !targetOrigin || embedOrigin !== targetOrigin) {
      return { embeddable: false, reason: 'Blocked by X-Frame-Options: SAMEORIGIN.' };
    }
  }

  const allowFromMatch = xfo.match(/allow-from\s+([^\s]+)/i);
  if (allowFromMatch) {
    const allowedOrigin = normalizeOrigin(allowFromMatch[1]);
    if (!embedOrigin || !allowedOrigin || allowedOrigin !== embedOrigin) {
      return { embeddable: false, reason: 'Blocked by X-Frame-Options ALLOW-FROM policy.' };
    }
  }

  const csp = contentSecurityPolicy.trim();
  if (csp) {
    const directives = csp
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean);
    const frameAncestorsDirective = directives.find((directive) =>
      directive.toLowerCase().startsWith('frame-ancestors'),
    );

    if (frameAncestorsDirective) {
      const tokens = frameAncestorsDirective.split(/\s+/).slice(1);
      if (tokens.length === 0) {
        return { embeddable: false, reason: 'Blocked by CSP frame-ancestors policy.' };
      }

      if (tokens.includes("'none'")) {
        return { embeddable: false, reason: 'Blocked by CSP frame-ancestors: none.' };
      }

      const allows = tokens.some((token) => tokenAllowsOrigin(token, embedOrigin, targetOrigin));
      if (!allows) {
        return { embeddable: false, reason: 'Blocked by CSP frame-ancestors policy.' };
      }
    }
  }

  return { embeddable: true, reason: '' };
}

async function ensureHostResolvesPublic(hostname: string): Promise<PublicHostResolution> {
  const host = normalizeBracketedHost(hostname);
  if (!host) {
    throw new HttpError(400, 'Invalid host.');
  }

  if (isPrivateHost(host)) {
    throw new HttpError(400, 'Private/local URLs are not allowed.');
  }

  const ipVersion = isIP(host);
  if (ipVersion === 4 || ipVersion === 6) {
    if (isPrivateHost(host)) {
      throw new HttpError(400, 'Private/local URLs are not allowed.');
    }
    return { host, address: host };
  }

  let records: Array<{ address: string; family: number }>;
  try {
    records = await dns.lookup(host, { all: true });
  } catch {
    throw new HttpError(422, 'Failed to resolve target hostname.');
  }

  if (!records.length) {
    throw new HttpError(422, 'Failed to resolve target hostname.');
  }

  let validatedAddress = '';
  for (const record of records) {
    if (isPrivateHost(record.address)) {
      throw new HttpError(400, 'Target resolves to a private address, which is not allowed.');
    }
    if (!validatedAddress) {
      validatedAddress = record.address;
    }
  }

  if (!validatedAddress) {
    throw new HttpError(422, 'Failed to resolve target hostname.');
  }

  return { host, address: validatedAddress };
}

async function fetchWithPinnedResolution(
  currentUrl: URL,
  signal: AbortSignal,
  resolution: PublicHostResolution,
): Promise<FetchWithCleanupResult> {
  const connector = buildConnector({
    lookup(lookupHost: string, _options: unknown, callback: (err: Error | null, address: string, family: number) => void) {
      const normalizedLookupHost = normalizeBracketedHost(lookupHost).toLowerCase();
      if (normalizedLookupHost !== resolution.host.toLowerCase()) {
        callback(new Error('Unexpected hostname during DNS lookup.'), '', 0);
        return;
      }

      const family = isIP(resolution.address);
      if (family !== 4 && family !== 6) {
        callback(new Error('Validated address is not an IP address.'), '', 0);
        return;
      }

      callback(null, resolution.address, family);
    },
  });

  const dispatcher = new Agent({
    connect: connector,
  });

  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    try {
      await dispatcher.close();
    } catch {
      dispatcher.destroy();
    }
  };

  try {
    const response = await undiciFetch(currentUrl.toString(), {
      method: 'GET',
      redirect: 'manual',
      signal,
      dispatcher,
      headers: {
        'user-agent': 'AchMarketLinkPreviewBot/1.0 (+https://prediction.achswap.app)',
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
      },
    });

    return { response, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

async function fetchWithValidatedRedirects(
  startUrl: URL,
  signal: AbortSignal,
): Promise<FetchWithCleanupResult> {
  let currentUrl = startUrl;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const resolution = await ensureHostResolvesPublic(currentUrl.hostname);
    const { response, cleanup } = await fetchWithPinnedResolution(currentUrl, signal, resolution);

    if (response.status >= 300 && response.status < 400) {
      try {
        const location = response.headers.get('location');
        if (!location) {
          throw new HttpError(422, `Redirect response missing location header (status ${response.status}).`);
        }

        let nextUrl: URL;
        try {
          nextUrl = new URL(location, currentUrl);
        } catch {
          throw new HttpError(422, 'Invalid redirect URL.');
        }

        if (nextUrl.protocol !== 'https:' && nextUrl.protocol !== 'http:') {
          throw new HttpError(400, 'Redirected to an unsupported protocol.');
        }

        if (isPrivateHost(nextUrl.hostname)) {
          throw new HttpError(400, 'Redirected to a private/local URL, which is not allowed.');
        }

        currentUrl = nextUrl;
      } finally {
        try {
          await response.body?.cancel();
        } catch {
          // ignore
        }
        await cleanup();
      }
      continue;
    }

    return { response, cleanup };
  }

  throw new HttpError(422, `Too many redirects (max ${MAX_REDIRECTS}).`);
}

async function readHtmlWithLimit(response: FetchResponse, abortController: AbortController): Promise<string> {
  const stream = response.body;
  if (!stream) {
    throw new HttpError(422, 'Empty response body.');
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let html = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      totalBytes += value.byteLength;
      if (totalBytes > MAX_HTML_BYTES) {
        abortController.abort();
        throw new HttpError(422, 'Preview page is too large (max 300KB).');
      }

      html += decoder.decode(value, { stream: true });
    }

    html += decoder.decode();
    return html;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
}

export default async function handler(req: any, res: any) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), REQUEST_TIMEOUT_MS);

  try {
    const targetUrl = normalizeTargetUrl(req.query?.url);
    const embedOrigin = normalizeOrigin(req.query?.origin);

    const { response, cleanup } = await fetchWithValidatedRedirects(targetUrl, abortController.signal);

    try {
      if (!response.ok) {
        throw new HttpError(422, `Target URL responded with ${response.status}.`);
      }

      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      if (
        contentType &&
        !contentType.includes('text/html') &&
        !contentType.includes('application/xhtml+xml')
      ) {
        throw new HttpError(422, 'Preview is available only for HTML pages.');
      }

      const finalUrl = response.url || targetUrl.toString();
      const html = await readHtmlWithLimit(response, abortController);
      const xFrameOptions = response.headers.get('x-frame-options') || '';
      const contentSecurityPolicy = response.headers.get('content-security-policy') || '';
      const framePolicy = analyzeFrameEmbeddability({
        finalUrl,
        xFrameOptions,
        contentSecurityPolicy,
        embedOrigin,
      });

      const title = pickFirstNonEmpty([
        extractMetaByKey(html, 'og:title', 'property'),
        extractMetaByKey(html, 'twitter:title', 'name'),
        extractTitle(html),
      ]);

      const description = pickFirstNonEmpty([
        extractMetaByKey(html, 'og:description', 'property'),
        extractMetaByKey(html, 'twitter:description', 'name'),
        extractMetaByKey(html, 'description', 'name'),
      ]);

      const image = pickFirstNonEmpty([
        toAbsoluteUrl(extractMetaByKey(html, 'og:image', 'property'), finalUrl),
        toAbsoluteUrl(extractMetaByKey(html, 'twitter:image', 'name'), finalUrl),
      ]);

      const siteName = pickFirstNonEmpty([
        extractMetaByKey(html, 'og:site_name', 'property'),
        new URL(finalUrl).hostname,
      ]);

      if (!title && !description && !image) {
        throw new HttpError(422, 'No preview metadata found for this URL.');
      }

      return res.status(200).json({
        preview: {
          url: finalUrl,
          title,
          description,
          image,
          siteName,
          embeddable: framePolicy.embeddable,
          embedBlockReason: framePolicy.reason,
        },
      });
    } finally {
      await cleanup();
    }
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      return res.status(504).json({ error: 'Preview request timed out.' });
    }

    if (typeof error?.status === 'number') {
      return res.status(error.status).json({ error: error.message || 'Preview request failed.' });
    }

    return res.status(500).json({ error: error?.message || 'Preview request failed.' });
  } finally {
    clearTimeout(timeout);
  }
}
