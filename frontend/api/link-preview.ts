const REQUEST_TIMEOUT_MS = 8000;
const MAX_HTML_CHARS = 300000;

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function isPrivateIpv4(host: string): boolean {
  const parts = host.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  if (!host) return true;
  if (host === 'localhost') return true;
  if (host.endsWith('.localhost')) return true;
  if (host.endsWith('.local')) return true;
  if (host === '::1') return true;
  if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) && isPrivateIpv4(host)) return true;
  return false;
}

function extractMetaByKey(html: string, key: string, attr: 'name' | 'property'): string {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patternA = new RegExp(
    `<meta[^>]*${attr}=["']${escapedKey}["'][^>]*content=["']([^"']+)["'][^>]*>`,
    'i',
  );
  const patternB = new RegExp(
    `<meta[^>]*content=["']([^"']+)["'][^>]*${attr}=["']${escapedKey}["'][^>]*>`,
    'i',
  );

  const match = html.match(patternA) || html.match(patternB);
  return match?.[1]?.trim() ?? '';
}

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1]?.replace(/\s+/g, ' ').trim() ?? '';
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

export default async function handler(req: any, res: any) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const targetUrl = normalizeTargetUrl(req.query?.url);

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(targetUrl.toString(), {
        method: 'GET',
        redirect: 'follow',
        signal: abortController.signal,
        headers: {
          'user-agent': 'AchMarketLinkPreviewBot/1.0 (+https://prediction.achswap.app)',
          accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
        },
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new HttpError(422, `Target URL responded with ${response.status}.`);
    }

    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (contentType && !contentType.includes('text/html')) {
      throw new HttpError(422, 'Preview is available only for HTML pages.');
    }

    const htmlRaw = await response.text();
    const html = htmlRaw.slice(0, MAX_HTML_CHARS);
    const finalUrl = response.url || targetUrl.toString();

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
      },
    });
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      return res.status(504).json({ error: 'Preview request timed out.' });
    }

    if (typeof error?.status === 'number') {
      return res.status(error.status).json({ error: error.message || 'Preview request failed.' });
    }

    return res.status(500).json({ error: error?.message || 'Preview request failed.' });
  }
}
