const COINGECKO_API_BASE = 'https://api.coingecko.com/api/v3';
const FETCH_TIMEOUT_MS = 7000;

export interface CoinGeckoSearchCandidate {
  id: string;
  symbol: string;
  name: string;
  thumb: string | null;
  large: string | null;
  marketCapRank: number | null;
}

function normalizeSearchValue(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCompactValue(value: string): string {
  return normalizeSearchValue(value).replace(/\s+/g, '');
}

async function fetchJsonWithTimeout(url: string): Promise<any> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error('CoinGecko rate limit exceeded. Please try again in a moment.');
      }
      throw new Error(`CoinGecko returned ${response.status}`);
    }

    return await response.json();
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error('CoinGecko request timed out.');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

function toOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function toOptionalRank(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function mapSearchCandidate(raw: any): CoinGeckoSearchCandidate | null {
  const id = typeof raw?.id === 'string' ? raw.id.trim().toLowerCase() : '';
  const symbol = typeof raw?.symbol === 'string' ? raw.symbol.trim().toUpperCase() : '';
  const name = typeof raw?.name === 'string' ? raw.name.trim() : '';

  if (!id || !symbol || !name) return null;

  return {
    id,
    symbol,
    name,
    thumb: toOptionalString(raw?.thumb),
    large: toOptionalString(raw?.large),
    marketCapRank: toOptionalRank(raw?.market_cap_rank),
  };
}

function scoreSearchCandidate(candidate: CoinGeckoSearchCandidate, query: string): number {
  const normalizedQuery = normalizeSearchValue(query);
  const compactQuery = normalizeCompactValue(query);
  const symbol = normalizeSearchValue(candidate.symbol);
  const name = normalizeSearchValue(candidate.name);
  const id = normalizeSearchValue(candidate.id);
  const compactSymbol = normalizeCompactValue(candidate.symbol);
  const compactName = normalizeCompactValue(candidate.name);
  const compactId = normalizeCompactValue(candidate.id);

  let score = 0;

  if (compactSymbol === compactQuery) score += 220;
  if (compactName === compactQuery) score += 200;
  if (compactId === compactQuery) score += 180;

  if (compactSymbol.startsWith(compactQuery)) score += 140;
  if (compactName.startsWith(compactQuery)) score += 120;
  if (compactId.startsWith(compactQuery)) score += 110;

  if (compactSymbol.includes(compactQuery)) score += 80;
  if (compactName.includes(compactQuery)) score += 70;
  if (compactId.includes(compactQuery)) score += 65;

  const queryTokens = normalizedQuery.split(' ').filter(Boolean);
  for (const token of queryTokens) {
    if (token.length < 2) continue;
    if (symbol.includes(token)) score += 18;
    if (name.includes(token)) score += 12;
    if (id.includes(token)) score += 10;
  }

  if (candidate.marketCapRank !== null) {
    score += Math.max(0, 40 - Math.min(candidate.marketCapRank, 40));
  }

  return score;
}

export async function searchCoinGeckoAssets(rawQuery: string, limit = 10): Promise<{
  query: string;
  candidates: CoinGeckoSearchCandidate[];
}> {
  const query = normalizeSearchValue(rawQuery);
  if (!query) {
    return { query: '', candidates: [] };
  }

  const endpoint = `${COINGECKO_API_BASE}/search?query=${encodeURIComponent(query)}`;
  const json = await fetchJsonWithTimeout(endpoint);
  const coins = Array.isArray(json?.coins) ? json.coins : [];

  const candidates = coins
    .map((coin: any) => mapSearchCandidate(coin))
    .filter((candidate: CoinGeckoSearchCandidate | null): candidate is CoinGeckoSearchCandidate => candidate !== null)
    .sort((a: CoinGeckoSearchCandidate, b: CoinGeckoSearchCandidate) => {
      const scoreDelta = scoreSearchCandidate(b, query) - scoreSearchCandidate(a, query);
      if (scoreDelta !== 0) return scoreDelta;
      const rankA = a.marketCapRank ?? Number.MAX_SAFE_INTEGER;
      const rankB = b.marketCapRank ?? Number.MAX_SAFE_INTEGER;
      if (rankA !== rankB) return rankA - rankB;
      return a.name.localeCompare(b.name);
    })
    .slice(0, Math.max(1, Math.min(limit, 20)));

  return { query, candidates };
}
