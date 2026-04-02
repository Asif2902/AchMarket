import { FACTORY_ADDRESS, LENS_ADDRESS } from '../src/config/network';
import { FACTORY_ABI, LENS_ABI } from '../src/config/abis';
import { JsonRpcProvider, Contract, type InterfaceAbi } from 'ethers';

type OgMarketPayload = {
  id: number;
  title: string;
  category: string;
  endLabel: string;
  outcomeLabels: string[];
};

const OG_FALLBACK = {
  title: 'AchMarket',
  subtitle: 'Prediction Markets on ARC',
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function parseMarketIdFromSlug(rawSlug: string | undefined): number | null {
  if (!rawSlug) return null;
  const match = rawSlug.match(/^(\d+)/);
  if (!match) return null;
  const id = Number.parseInt(match[1], 10);
  if (!Number.isFinite(id) || id < 0) return null;
  return id;
}

function formatEndDate(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 'No deadline';
  return new Date(timestamp * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

async function getMarketPayload(marketId: number): Promise<OgMarketPayload | null> {
  const rpcUrl = process.env.OG_RPC_URL ?? process.env.VITE_RPC_URL ?? 'https://arc-testnet.drpc.org/';

  const provider = new JsonRpcProvider(rpcUrl);
  const factory = new Contract(FACTORY_ADDRESS, FACTORY_ABI as unknown as InterfaceAbi, provider);
  const lens = new Contract(LENS_ADDRESS, LENS_ABI as unknown as InterfaceAbi, provider);

  try {
    const marketAddress: string = await factory.markets(BigInt(marketId));
    if (!marketAddress || marketAddress === '0x0000000000000000000000000000000000000000') {
      return null;
    }

    const detail = await lens.getMarketDetail(marketAddress);

    return {
      id: marketId,
      title: String(detail.title ?? `Market #${marketId}`),
      category: String(detail.category ?? 'Prediction'),
      endLabel: formatEndDate(Number(detail.marketDeadline ?? 0)),
      outcomeLabels: Array.isArray(detail.outcomeLabels)
        ? detail.outcomeLabels.map((label: string) => String(label)).slice(0, 4)
        : [],
    };
  } catch {
    return null;
  }
}

function clipText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}...`;
}

function renderSvg(payload: OgMarketPayload | null): string {
  const title = escapeHtml(clipText(payload?.title ?? OG_FALLBACK.title, 115));
  const category = escapeHtml(payload?.category ?? 'Prediction Market');
  const endLabel = escapeHtml(payload?.endLabel ?? 'Live on ARC');
  const marketLabel = payload ? `Market #${payload.id}` : OG_FALLBACK.subtitle;
  const outcomes = payload?.outcomeLabels ?? [];

  const outcomeHtml = outcomes
    .map((label, idx) => {
      const safe = escapeHtml(clipText(label, 20));
      const x = 88 + idx * 250;
      return `<g transform="translate(${x}, 430)">
        <rect width="220" height="64" rx="12" fill="rgba(13, 18, 27, 0.78)" stroke="rgba(148, 163, 184, 0.28)"/>
        <text x="20" y="39" fill="rgba(232, 243, 255, 0.95)" font-family="Inter, Arial, sans-serif" font-size="26" font-weight="600">${safe}</text>
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
  <text x="88" y="170" fill="rgba(227, 236, 250, 0.72)" font-family="Inter, Arial, sans-serif" font-size="30" font-weight="500">${escapeHtml(marketLabel)}</text>

  <foreignObject x="88" y="198" width="1010" height="188">
    <div xmlns="http://www.w3.org/1999/xhtml" style="font-family: Inter, Arial, sans-serif; color: #F8FAFC; font-size: 58px; line-height: 1.08; font-weight: 760; letter-spacing: -0.02em; word-break: break-word;">
      ${title}
    </div>
  </foreignObject>

  <g transform="translate(88, 383)">
    <rect width="226" height="38" rx="10" fill="rgba(52, 211, 153, 0.16)" stroke="rgba(52, 211, 153, 0.45)"/>
    <text x="18" y="26" fill="#6EE7B7" font-family="Inter, Arial, sans-serif" font-size="21" font-weight="700">${category}</text>
  </g>

  <g transform="translate(336, 383)">
    <rect width="270" height="38" rx="10" fill="rgba(34, 211, 238, 0.14)" stroke="rgba(34, 211, 238, 0.38)"/>
    <text x="18" y="26" fill="#A5F3FC" font-family="Inter, Arial, sans-serif" font-size="21" font-weight="700">Ends ${endLabel}</text>
  </g>

  ${outcomeHtml}

  <text x="88" y="574" fill="rgba(176, 193, 213, 0.80)" font-family="JetBrains Mono, monospace" font-size="20" font-weight="500">prediction.achswap.app</text>
</svg>`;
}

function setCommonHeaders(res: { setHeader: (name: string, value: string) => void }): void {
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600');
}

export default async function handler(
  req: { query?: { slug?: string } },
  res: { status: (code: number) => { send: (body: string) => void }; setHeader: (name: string, value: string) => void },
) {
  const slug = req.query?.slug;
  const marketId = parseMarketIdFromSlug(slug);

  if (marketId === null) {
    setCommonHeaders(res);
    return res.status(200).send(renderSvg(null));
  }

  const payload = await getMarketPayload(marketId);
  setCommonHeaders(res);
  return res.status(200).send(renderSvg(payload));
}
