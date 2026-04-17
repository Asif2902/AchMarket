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

function normalizeQuery(value: string): string {
  return value
    .replace(/[–—-]/g, ' ')
    .replace(/[|:,;()\[\]{}]/g, ' ')
    .replace(/\b(friendly|qualifier|qualifying|prediction|market|odds|line)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitPairQuery(query: string): { left: string; right: string } | null {
  const compact = query.replace(/\s+/g, ' ').trim();
  if (!compact) return null;
  const patterns = [
    /(.+?)\s+vs\.?\s+(.+)/i,
    /(.+?)\s+v\s+(.+)/i,
    /(.+?)\s+versus\s+(.+)/i,
    /(.+?)\s*@\s*(.+)/i,
  ];
  for (const pattern of patterns) {
    const match = compact.match(pattern);
    if (!match) continue;
    const left = normalizeQuery(match[1]);
    const right = normalizeQuery(match[2]);
    if (left && right) return { left, right };
  }
  return null;
}

function buildQueryVariants(query: string): string[] {
  const cleaned = normalizeQuery(query);
  if (!cleaned) return [];
  const out: string[] = [cleaned];
  const pair = splitPairQuery(cleaned);
  if (pair) {
    out.push(`${pair.left} vs ${pair.right}`);
    out.push(`${pair.right} vs ${pair.left}`);
    out.push(`${pair.left} ${pair.right}`);
    out.push(pair.left);
    out.push(pair.right);
  }
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const value of out) {
    const key = value.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(value);
  }
  return deduped.slice(0, 8);
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

async function resolveTeamId(teamName: string): Promise<string | null> {
  const q = normalizeQuery(teamName);
  if (!q) return null;
  const endpoint = `https://www.thesportsdb.com/api/v1/json/3/searchteams.php?t=${encodeURIComponent(q.replace(/\s+/g, '_'))}`;
  const json = await fetchJsonWithTimeout(endpoint);
  const teams = Array.isArray(json?.teams) ? json.teams : [];
  const first = teams.find((t: any) => typeof t?.idTeam === 'string' && t.idTeam.trim());
  return first ? String(first.idTeam).trim() : null;
}

async function fetchTeamEvents(teamId: string): Promise<SportsCandidate[]> {
  const endpoints = [
    `https://www.thesportsdb.com/api/v1/json/3/eventsnext.php?id=${encodeURIComponent(teamId)}`,
    `https://www.thesportsdb.com/api/v1/json/3/eventslast.php?id=${encodeURIComponent(teamId)}`,
  ];

  const responses = await Promise.all(
    endpoints.map(async (endpoint) => {
      const json = await fetchJsonWithTimeout(endpoint);
      const events = Array.isArray(json?.events)
        ? json.events
        : Array.isArray(json?.results)
          ? json.results
          : [];
      return events
        .map(mapEventToCandidate)
        .filter((item: SportsCandidate | null): item is SportsCandidate => Boolean(item));
    }),
  );

  return responses.flat();
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

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.replace(/[^a-z0-9]/g, ''))
    .filter((token) => token.length >= 2);
}

function textOverlap(a: string, b: string): number {
  const aSet = new Set(tokenize(a));
  const bSet = new Set(tokenize(b));
  if (!aSet.size || !bSet.size) return 0;
  let common = 0;
  for (const token of aSet) {
    if (bSet.has(token)) common += 1;
  }
  return common / Math.max(aSet.size, bSet.size);
}

function scoreCandidateForQuery(candidate: SportsCandidate, query: string): number {
  const timeScore = scoreCandidate(candidate);
  const pair = splitPairQuery(query);
  if (!pair) {
    const queryScore = Math.max(
      textOverlap(candidate.homeTeam, query),
      textOverlap(candidate.awayTeam, query),
      textOverlap(`${candidate.homeTeam} ${candidate.awayTeam}`, query),
    );
    return timeScore * 0.6 + queryScore * 0.4;
  }

  const direct = (textOverlap(candidate.homeTeam, pair.left) + textOverlap(candidate.awayTeam, pair.right)) / 2;
  const reverse = (textOverlap(candidate.homeTeam, pair.right) + textOverlap(candidate.awayTeam, pair.left)) / 2;
  const pairScore = Math.max(direct, reverse);
  return timeScore * 0.45 + pairScore * 0.55;
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
    const query = normalizeQuery(queryRaw);
    if (!query) {
      return res.status(200).json({ query: '', candidates: [] });
    }

    const variants = buildQueryVariants(query);
    const searchGroupPromise = Promise.allSettled(
      variants.map(async (variant) => {
        const endpoint = `https://www.thesportsdb.com/api/v1/json/3/searchevents.php?e=${encodeURIComponent(variant.replace(/\s+/g, '_'))}`;
        const json = await fetchJsonWithTimeout(endpoint);
        const events = Array.isArray(json?.event) ? json.event : [];
        return events
          .map(mapEventToCandidate)
          .filter((item: SportsCandidate | null): item is SportsCandidate => Boolean(item));
      }),
    ).then(results =>
      results
        .filter((r): r is PromiseFulfilledResult<SportsCandidate[]> => r.status === 'fulfilled')
        .map(r => r.value)
    );

    const pair = splitPairQuery(query);
    let teamGroupsPromise: Promise<SportsCandidate[]> | null = null;
    if (pair) {
      teamGroupsPromise = (async () => {
        const [leftId, rightId] = await Promise.all([
          resolveTeamId(pair.left).catch(() => null),
          resolveTeamId(pair.right).catch(() => null),
        ]);

        const teamEvents = await Promise.all([
          leftId ? fetchTeamEvents(leftId).catch(() => []) : Promise.resolve([]),
          rightId ? fetchTeamEvents(rightId).catch(() => []) : Promise.resolve([]),
        ]);

        return teamEvents.flat();
      })();
    }

    const fetchedGroups = await searchGroupPromise;
    const teamEvents = teamGroupsPromise ? await teamGroupsPromise : [];

    const candidates = dedupeCandidates([...fetchedGroups.flat(), ...teamEvents])
      .sort((a, b) => scoreCandidateForQuery(b, query) - scoreCandidateForQuery(a, query))
      .slice(0, 16);

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