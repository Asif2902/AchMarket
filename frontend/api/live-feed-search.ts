const CORS_ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const FETCH_TIMEOUT_MS = 7000;

interface SportsCandidate {
  eventId: string;
  leagueName: string;
  homeTeam: string;
  awayTeam: string;
  kickoffAt: string | null;
  status: string;
  statusLabel: string;
}

function resolveCorsOrigin(originHeader: unknown): string | null {
  if (process.env.NODE_ENV !== 'production') return '*';
  if (typeof originHeader !== 'string' || !originHeader) return null;
  if (CORS_ALLOWED_ORIGINS.includes('*')) return originHeader;
  return CORS_ALLOWED_ORIGINS.includes(originHeader) ? originHeader : null;
}

function normalizeSportsStatus(statusRaw: string): { status: string; statusLabel: string } {
  const clean = (statusRaw || '').trim();
  const lower = clean.toLowerCase();

  if (!clean) return { status: 'unknown', statusLabel: 'Status unavailable' };
  if (lower.includes('in play') || lower.includes('live') || lower.includes('half') || lower.includes('extra')) {
    return { status: 'live', statusLabel: clean };
  }
  if (lower.includes('finished') || lower.includes('full time') || lower.includes('ft')) {
    return { status: 'finished', statusLabel: clean };
  }
  if (lower.includes('not started') || lower.includes('scheduled') || lower.includes('ns')) {
    return { status: 'scheduled', statusLabel: clean };
  }
  if (lower.includes('postponed')) {
    return { status: 'postponed', statusLabel: clean };
  }
  if (lower.includes('cancelled') || lower.includes('abandoned')) {
    return { status: 'cancelled', statusLabel: clean };
  }

  return { status: 'unknown', statusLabel: clean };
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
      throw new Error(`Provider returned ${response.status}`);
    }

    return await response.json();
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error('Provider request timed out.');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

function mapEventToCandidate(event: any): SportsCandidate | null {
  const eventId = typeof event?.idEvent === 'string' ? event.idEvent.trim() : '';
  if (!eventId) return null;

  const homeTeam = typeof event?.strHomeTeam === 'string' ? event.strHomeTeam.trim() : '';
  const awayTeam = typeof event?.strAwayTeam === 'string' ? event.strAwayTeam.trim() : '';
  if (!homeTeam || !awayTeam) return null;

  const kickoffRaw = typeof event?.strTimestamp === 'string' ? event.strTimestamp : '';
  const kickoffAt = kickoffRaw && Number.isFinite(Date.parse(kickoffRaw)) ? new Date(kickoffRaw).toISOString() : null;
  const status = normalizeSportsStatus(typeof event?.strStatus === 'string' ? event.strStatus : '');

  return {
    eventId,
    leagueName: typeof event?.strLeague === 'string' ? event.strLeague : 'Sports',
    homeTeam,
    awayTeam,
    kickoffAt,
    status: status.status,
    statusLabel: status.statusLabel,
  };
}

function scoreCandidate(candidate: SportsCandidate): number {
  const kickoff = candidate.kickoffAt ? Date.parse(candidate.kickoffAt) : NaN;
  if (!Number.isFinite(kickoff)) return 0.4;

  const now = Date.now();
  const hours = Math.abs(kickoff - now) / (1000 * 60 * 60);
  if (hours < 3) return 1;
  if (hours < 24) return 0.92;
  if (hours < 72) return 0.82;
  if (hours < 14 * 24) return 0.7;
  if (hours < 45 * 24) return 0.58;
  return 0.45;
}

function dedupeCandidates(candidates: SportsCandidate[]): SportsCandidate[] {
  const seen = new Set<string>();
  const out: SportsCandidate[] = [];
  for (const candidate of candidates) {
    const key = candidate.eventId;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
  }
  return out;
}

export default async function handler(req: any, res: any) {
  const corsOrigin = resolveCorsOrigin(req.headers?.origin);
  if (corsOrigin) {
    res.setHeader('Access-Control-Allow-Origin', corsOrigin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') return res.status(200).json({ ok: true });
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const queryRaw = typeof req.query?.query === 'string' ? req.query.query : '';
    const query = queryRaw.trim();
    if (!query) {
      return res.status(200).json({ query: '', candidates: [] });
    }

    const endpoint = `https://www.thesportsdb.com/api/v1/json/3/searchevents.php?e=${encodeURIComponent(query.replace(/\s+/g, '_'))}`;
    const json = await fetchJsonWithTimeout(endpoint);
    const events = Array.isArray(json?.event) ? json.event : [];

    const candidates = dedupeCandidates(
      events
        .map(mapEventToCandidate)
        .filter((item: SportsCandidate | null): item is SportsCandidate => Boolean(item))
        .sort((a, b) => scoreCandidate(b) - scoreCandidate(a))
        .slice(0, 12),
    );

    return res.status(200).json({ query, candidates });
  } catch (err: any) {
    const msg = err?.message || 'Unexpected error';
    const lower = msg.toLowerCase();
    let code = 500;
    if (lower.includes('timed out')) code = 504;
    else if (lower.includes('invalid')) code = 400;
    return res.status(code).json({ error: msg });
  }
}
