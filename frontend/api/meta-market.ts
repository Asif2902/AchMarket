function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalizeHost(rawHost: string | undefined): string {
  if (!rawHost) return 'prediction.achswap.app';
  return rawHost.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

function toAbsoluteUrl(host: string, path: string): string {
  return `https://${host}${path.startsWith('/') ? path : `/${path}`}`;
}

export default async function handler(
  req: {
    query?: { slug?: string };
    headers?: { host?: string; 'x-forwarded-host'?: string };
  },
  res: {
    setHeader: (name: string, value: string) => void;
    status: (code: number) => { send: (body: string) => void };
  },
) {
  const slug = (req.query?.slug ?? '').trim();
  const safeSlug = slug || 'market';

  const host = normalizeHost(req.headers?.['x-forwarded-host'] ?? req.headers?.host);
  const marketUrl = toAbsoluteUrl(host, `/market/${encodeURIComponent(safeSlug)}`);
  const ogImageUrl = toAbsoluteUrl(host, `/api/og-image?slug=${encodeURIComponent(safeSlug)}`);

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>AchMarket</title>
    <meta name="description" content="Trade prediction markets on ARC Testnet with USDC." />

    <meta property="og:site_name" content="AchMarket" />
    <meta property="og:title" content="AchMarket - Prediction Market" />
    <meta property="og:description" content="Trade prediction markets on ARC Testnet with USDC." />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${escapeHtml(marketUrl)}" />
    <meta property="og:image" content="${escapeHtml(ogImageUrl)}" />
    <meta property="og:image:secure_url" content="${escapeHtml(ogImageUrl)}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:type" content="image/svg+xml" />

    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="AchMarket - Prediction Market" />
    <meta name="twitter:description" content="Trade prediction markets on ARC Testnet with USDC." />
    <meta name="twitter:image" content="${escapeHtml(ogImageUrl)}" />

    <link rel="canonical" href="${escapeHtml(marketUrl)}" />

    <meta http-equiv="refresh" content="0; url=${escapeHtml(marketUrl)}" />
    <script>
      window.location.replace(${JSON.stringify(marketUrl)});
    </script>
  </head>
  <body>
    Redirecting to <a href="${escapeHtml(marketUrl)}">${escapeHtml(marketUrl)}</a>
  </body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600');
  return res.status(200).send(html);
}
