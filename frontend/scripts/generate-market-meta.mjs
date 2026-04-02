import { Contract, JsonRpcProvider } from 'ethers';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const FACTORY_ADDRESS = '0xd7b122B12caCB299249f89be7F241a47f762f283';
const LENS_ADDRESS = '0x8241ACa87D4Dee4CA167b1e172Ed955522599e70';
const RPC_URL = process.env.OG_RPC_URL ?? process.env.VITE_RPC_URL ?? 'https://arc-testnet.drpc.org/';
const BASE_URL = (process.env.OG_BASE_URL ?? 'https://prediction.achswap.app').replace(/\/$/, '');

const FACTORY_ABI = [
  'function totalMarkets() view returns (uint256)',
  'function markets(uint256) view returns (address)',
];

const LENS_ABI = [
  'function getMarketDetail(address market) view returns (tuple(address market, string title, string description, string category, string imageUri, string proofUri, string[] outcomeLabels, int256[] totalSharesWad, int256[] impliedProbabilitiesWad, uint8 stage, uint256 winningOutcome, uint256 createdAt, uint256 marketDeadline, int256 bWad, uint256 totalVolumeWei, uint256 participants, uint256 resolvedPoolWei, uint256 resolutionDeadline, string cancelReason, string cancelProofUri))',
];

const root = process.cwd();
const publicDir = path.join(root, 'public');
const marketMetaDir = path.join(publicDir, 'market-meta');
const marketOgDir = path.join(publicDir, 'og', 'markets');

function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function clipText(text, maxLength) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}...`;
}

function formatEndDate(timestamp) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 'No deadline';
  return new Date(timestamp * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function renderSvg({ id, title, category, marketDeadline, outcomeLabels }) {
  const safeTitle = escapeHtml(clipText(title || `Market #${id}`, 110));
  const safeCategory = escapeHtml(clipText(category || 'Prediction Market', 26));
  const endLabel = escapeHtml(formatEndDate(Number(marketDeadline)));
  const safeOutcomeLabels = (outcomeLabels || []).slice(0, 4).map((label) => escapeHtml(clipText(String(label), 20)));

  const outcomes = safeOutcomeLabels
    .map((label, idx) => {
      const x = 88 + idx * 250;
      return `<g transform="translate(${x}, 430)">
        <rect width="220" height="64" rx="12" fill="rgba(13, 18, 27, 0.78)" stroke="rgba(148, 163, 184, 0.28)"/>
        <text x="20" y="39" fill="rgba(232, 243, 255, 0.95)" font-family="Inter, Arial, sans-serif" font-size="26" font-weight="600">${label}</text>
      </g>`;
    })
    .join('');

  return `
<svg width="1200" height="630" viewBox="0 0 1200 630" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bgA" x1="36" y1="20" x2="1160" y2="596" gradientUnits="userSpaceOnUse">
      <stop stop-color="#0A1220"/>
      <stop offset="0.45" stop-color="#0E1829"/>
      <stop offset="1" stop-color="#07101A"/>
    </linearGradient>
    <linearGradient id="lineA" x1="0" y1="0" x2="1" y2="1">
      <stop stop-color="#22D3EE" stop-opacity="0.8"/>
      <stop offset="1" stop-color="#34D399" stop-opacity="0.8"/>
    </linearGradient>
    <filter id="softGlow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="28" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>

  <rect width="1200" height="630" fill="url(#bgA)"/>
  <circle cx="115" cy="74" r="260" fill="#22D3EE" fill-opacity="0.16" filter="url(#softGlow)"/>
  <circle cx="1130" cy="560" r="300" fill="#34D399" fill-opacity="0.12" filter="url(#softGlow)"/>

  <rect x="44" y="42" width="1112" height="546" rx="28" fill="rgba(8, 14, 24, 0.52)" stroke="rgba(148, 163, 184, 0.20)"/>
  <path d="M86 362C240 308 342 344 452 300C562 256 676 298 784 270C892 242 996 280 1112 220" stroke="url(#lineA)" stroke-width="6" stroke-linecap="round"/>

  <text x="88" y="124" fill="rgba(108, 225, 241, 0.92)" font-family="Inter, Arial, sans-serif" font-size="30" font-weight="700" letter-spacing="2">ACHMARKET</text>
  <text x="88" y="170" fill="rgba(227, 236, 250, 0.72)" font-family="Inter, Arial, sans-serif" font-size="30" font-weight="500">Market #${id}</text>

  <foreignObject x="88" y="198" width="1010" height="188">
    <div xmlns="http://www.w3.org/1999/xhtml" style="font-family: Inter, Arial, sans-serif; color: #F8FAFC; font-size: 58px; line-height: 1.08; font-weight: 760; letter-spacing: -0.02em; word-break: break-word;">
      ${safeTitle}
    </div>
  </foreignObject>

  <g transform="translate(88, 383)">
    <rect width="226" height="38" rx="10" fill="rgba(52, 211, 153, 0.16)" stroke="rgba(52, 211, 153, 0.45)"/>
    <text x="18" y="26" fill="#6EE7B7" font-family="Inter, Arial, sans-serif" font-size="21" font-weight="700">${safeCategory}</text>
  </g>

  <g transform="translate(336, 383)">
    <rect width="270" height="38" rx="10" fill="rgba(34, 211, 238, 0.14)" stroke="rgba(34, 211, 238, 0.38)"/>
    <text x="18" y="26" fill="#A5F3FC" font-family="Inter, Arial, sans-serif" font-size="21" font-weight="700">Ends ${endLabel}</text>
  </g>

  ${outcomes}

  <text x="88" y="574" fill="rgba(176, 193, 213, 0.80)" font-family="JetBrains Mono, monospace" font-size="20" font-weight="500">prediction.achswap.app</text>
</svg>`;
}

function renderMetaHtml({ id, title, description }) {
  const safeTitle = escapeHtml(clipText(title || `Market #${id}`, 90));
  const safeDescription = escapeHtml(clipText((description || 'Trade prediction markets on ARC Testnet with USDC.').replace(/\s+/g, ' ').trim(), 180));
  const marketPath = `/market/${id}`;
  const marketUrl = `${BASE_URL}${marketPath}`;
  const imageUrl = `${BASE_URL}/og/markets/${id}.svg`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle} | AchMarket</title>
    <meta name="description" content="${safeDescription}" />

    <meta property="og:site_name" content="AchMarket" />
    <meta property="og:title" content="${safeTitle} | AchMarket" />
    <meta property="og:description" content="${safeDescription}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${marketUrl}" />
    <meta property="og:image" content="${imageUrl}" />
    <meta property="og:image:secure_url" content="${imageUrl}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:type" content="image/svg+xml" />

    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${safeTitle} | AchMarket" />
    <meta name="twitter:description" content="${safeDescription}" />
    <meta name="twitter:image" content="${imageUrl}" />

    <link rel="canonical" href="${marketUrl}" />
    <meta http-equiv="refresh" content="0; url=${marketPath}" />
    <script>window.location.replace(${JSON.stringify(marketPath)});</script>
  </head>
  <body>
    Redirecting to <a href="${marketPath}">${marketPath}</a>
  </body>
</html>`;
}

function renderDefaultMetaHtml() {
  const marketUrl = `${BASE_URL}/`;
  const imageUrl = `${BASE_URL}/og/markets/default.svg`;
  const description = 'Trade prediction markets on ARC Testnet with USDC.';
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>AchMarket - Prediction Markets</title>
    <meta name="description" content="${description}" />
    <meta property="og:site_name" content="AchMarket" />
    <meta property="og:title" content="AchMarket - Prediction Markets" />
    <meta property="og:description" content="${description}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${marketUrl}" />
    <meta property="og:image" content="${imageUrl}" />
    <meta property="og:image:secure_url" content="${imageUrl}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:type" content="image/svg+xml" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="AchMarket - Prediction Markets" />
    <meta name="twitter:description" content="${description}" />
    <meta name="twitter:image" content="${imageUrl}" />
    <link rel="canonical" href="${marketUrl}" />
    <meta http-equiv="refresh" content="0; url=/" />
    <script>window.location.replace('/');</script>
  </head>
  <body>Redirecting to <a href="/">/</a></body>
</html>`;
}

async function createDirs() {
  await fs.rm(marketMetaDir, { recursive: true, force: true });
  await fs.rm(marketOgDir, { recursive: true, force: true });
  await fs.mkdir(marketMetaDir, { recursive: true });
  await fs.mkdir(marketOgDir, { recursive: true });
}

async function writeDefaultFiles() {
  const defaultSvg = renderSvg({
    id: 0,
    title: 'AchMarket - Prediction Markets',
    category: 'Prediction Market',
    marketDeadline: 0,
    outcomeLabels: ['Yes', 'No'],
  });
  await fs.writeFile(path.join(marketOgDir, 'default.svg'), defaultSvg, 'utf8');
  await fs.writeFile(path.join(marketMetaDir, 'default.html'), renderDefaultMetaHtml(), 'utf8');
}

async function main() {
  await createDirs();
  await writeDefaultFiles();

  const provider = new JsonRpcProvider(RPC_URL);
  const factory = new Contract(FACTORY_ADDRESS, FACTORY_ABI, provider);
  const lens = new Contract(LENS_ADDRESS, LENS_ABI, provider);

  const totalMarketsRaw = await factory.totalMarkets();
  const totalMarkets = Number(totalMarketsRaw);

  if (!Number.isFinite(totalMarkets) || totalMarkets <= 0) {
    console.log('No markets found. Wrote default OG metadata.');
    return;
  }

  console.log(`Generating OG metadata for ${totalMarkets} markets...`);

  for (let id = 0; id < totalMarkets; id += 1) {
    try {
      const marketAddress = await factory.markets(BigInt(id));
      const detail = await lens.getMarketDetail(marketAddress);

      const svg = renderSvg({
        id,
        title: String(detail.title ?? `Market #${id}`),
        category: String(detail.category ?? 'Prediction'),
        marketDeadline: Number(detail.marketDeadline ?? 0),
        outcomeLabels: Array.isArray(detail.outcomeLabels) ? detail.outcomeLabels.map((value) => String(value)) : [],
      });

      const html = renderMetaHtml({
        id,
        title: String(detail.title ?? `Market #${id}`),
        description: String(detail.description ?? ''),
      });

      await fs.writeFile(path.join(marketOgDir, `${id}.svg`), svg, 'utf8');
      await fs.writeFile(path.join(marketMetaDir, `${id}.html`), html, 'utf8');
    } catch (error) {
      console.warn(`Failed to generate OG for market #${id}:`, error?.message ?? error);
    }
  }

  console.log('Static market OG metadata generation complete.');
}

main().catch((error) => {
  console.error('Failed to generate static market OG metadata:', error);
  process.exitCode = 1;
});
