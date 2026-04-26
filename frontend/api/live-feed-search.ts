import { normalizeTeamName, sportsDbUrl, teamsMatch } from './_sportsdb';

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
  matchScore: number;
}

function normalizeQuery(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\bathletico\b/gi, 'atletico')
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

function mapEventToCandidate(event: any, expectedPair: { left: string; right: string } | null): SportsCandidate | null {
  const eventId = typeof event?.idEvent === 'string' ? event.idEvent.trim() : '';
  if (!eventId) return null;

  const homeTeam = typeof event?.strHomeTeam === 'string' ? event.strHomeTeam.trim() : '';
  const awayTeam = typeof event?.strAwayTeam === 'string' ? event.strAwayTeam.trim() : '';
  if (!homeTeam || !awayTeam) return null;

  const kickoffRaw = typeof event?.strTimestamp === 'string' ? event.strTimestamp : '';
  const kickoffAt = kickoffRaw && Number.isFinite(Date.parse(kickoffRaw)) ? new Date(kickoffRaw).toISOString() : null;
  const status = normalizeSportsStatus(typeof event?.strStatus === 'string' ? event.strStatus : '');
  const leagueName = typeof event?.strLeague === 'string' ? event.strLeague.trim() : '';

  // Calculate match score if expected pair is provided
  let matchScore = 0.5; // default neutral score
  if (expectedPair) {
    matchScore = teamsMatch(homeTeam, awayTeam, expectedPair.left, expectedPair.right);
  }

  return {
    eventId,
    leagueName: leagueName || 'Sports',
    homeTeam,
    awayTeam,
    kickoffAt,
    status: status.status,
    statusLabel: status.statusLabel,
    matchScore,
  };
}

async function resolveTeamId(teamName: string): Promise<string | null> {
  const q = normalizeQuery(teamName);
  if (!q) return null;

  // Try exact match first with underscores (SportsDB convention)
  const endpoint = sportsDbUrl(`searchteams.php?t=${encodeURIComponent(q.replace(/\s+/g, '_'))}`);
  const json = await fetchJsonWithTimeout(endpoint);
  const teams = Array.isArray(json?.teams) ? json.teams : [];

  if (teams.length === 0) return null;

  // Find best matching team
  const normalizedQuery = normalizeTeamName(q);
  let bestMatch = teams[0];
  let bestScore = 0;

  for (const team of teams) {
    if (typeof team?.strTeam !== 'string') continue;
    const teamNameNorm = normalizeTeamName(team.strTeam);
    if (teamNameNorm === normalizedQuery) {
      bestMatch = team;
      break;
    }
    if (teamNameNorm.includes(normalizedQuery) || normalizedQuery.includes(teamNameNorm)) {
      if (bestScore < 0.8) {
        bestScore = 0.8;
        bestMatch = team;
      }
    }
  }

  return bestMatch?.idTeam ? String(bestMatch.idTeam).trim() : null;
}

async function fetchTeamEvents(teamId: string): Promise<SportsCandidate[]> {
  if (!teamId) return [];

  const endpoints = [
    sportsDbUrl(`eventsnext.php?id=${encodeURIComponent(teamId)}`),
    sportsDbUrl(`eventslast.php?id=${encodeURIComponent(teamId)}`),
  ];

  const responses = await Promise.all(
    endpoints.map(async (endpoint) => {
      try {
        const json = await fetchJsonWithTimeout(endpoint);
        const events = Array.isArray(json?.events)
          ? json.events
          : Array.isArray(json?.results)
            ? json.results
            : [];
        return events;
      } catch {
        return [];
      }
    }),
  );

  return responses.flat().map((event: any) => mapEventToCandidate(event, null)).filter((c): c is SportsCandidate => c !== null);
}

function scoreCandidate(candidate: SportsCandidate, query: string, expectedPair: { left: string; right: string } | null): number {
  const matchScore = candidate.matchScore || 0.5;
  const kickoff = candidate.kickoffAt ? Date.parse(candidate.kickoffAt) : NaN;
  let timeScore = 0.35;
  if (candidate.status === 'live') {
    timeScore = 1;
  } else if (Number.isFinite(kickoff)) {
    const hoursFromNow = (kickoff - Date.now()) / (1000 * 60 * 60);
    const absHours = Math.abs(hoursFromNow);

    if (candidate.status === 'scheduled') {
      if (hoursFromNow >= -1) {
        if (hoursFromNow < 6) timeScore = 1;
        else if (hoursFromNow < 24) timeScore = 0.95;
        else if (hoursFromNow < 72) timeScore = 0.88;
        else if (hoursFromNow < 14 * 24) timeScore = 0.75;
        else timeScore = 0.62;
      } else {
        timeScore = absHours < 24 ? 0.18 : 0.05;
      }
    } else if (candidate.status === 'finished') {
      if (absHours < 6) timeScore = 0.42;
      else if (absHours < 24) timeScore = 0.28;
      else timeScore = 0.12;
    } else {
      if (absHours < 24) timeScore = 0.55;
      else if (absHours < 72) timeScore = 0.42;
      else timeScore = 0.3;
    }
  } else if (candidate.status === 'finished') {
    timeScore = 0.12;
  }

  if (expectedPair) {
    return matchScore * 0.72 + timeScore * 0.28;
  }

  const queryScore = Math.max(
    textOverlap(candidate.homeTeam, query),
    textOverlap(candidate.awayTeam, query),
    textOverlap(`${candidate.homeTeam} ${candidate.awayTeam}`, query),
  );

  return timeScore * 0.5 + queryScore * 0.3 + matchScore * 0.2;
}

function textOverlap(a: string, b: string): number {
  const aTokens = new Set(tokenize(a));
  const bTokens = new Set(tokenize(b));
  if (!aTokens.size || !bTokens.size) return 0;
  let common = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) common += 1;
  }
  return common / Math.max(aTokens.size, bTokens.size);
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.replace(/[^a-z0-9]/g, ''))
    .filter((token) => token.length >= 2);
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

    const expectedPair = splitPairQuery(query);

    // Search by event name (limited to 2 results for free API)
    const variants = buildQueryVariants(query);
    const searchGroupPromise = Promise.allSettled(
      variants.slice(0, 3).map(async (variant) => {
        const endpoint = sportsDbUrl(`searchevents.php?e=${encodeURIComponent(variant.replace(/\s+/g, '_'))}`);
        const json = await fetchJsonWithTimeout(endpoint);
        const events = Array.isArray(json?.event) ? json.event : [];
        return events
          .map((event: any) => mapEventToCandidate(event, expectedPair))
          .filter((item: SportsCandidate | null): item is SportsCandidate => item !== null);
      }),
    ).then(results =>
      results
        .filter((r): r is PromiseFulfilledResult<SportsCandidate[]> => r.status === 'fulfilled')
        .map(r => r.value)
    );

    // Search by team IDs (more reliable)
    let teamGroupsPromise: Promise<SportsCandidate[]> | null = null;
    if (expectedPair) {
      teamGroupsPromise = (async () => {
        const [leftId, rightId] = await Promise.all([
          resolveTeamId(expectedPair.left).catch(() => null),
          resolveTeamId(expectedPair.right).catch(() => null),
        ]);

        const teamEvents: SportsCandidate[] = [];

        // Fetch events for both teams
        const teamIds = [leftId, rightId].filter(Boolean);
        const eventsArrays = await Promise.all(
          teamIds.map(id => id ? fetchTeamEvents(id).catch(() => []) : Promise.resolve([]))
        );

        // Merge and tag events with expected pair for scoring
        for (const events of eventsArrays) {
          for (const event of events) {
            // Recalculate match score with expected pair
            if (expectedPair) {
              event.matchScore = teamsMatch(event.homeTeam, event.awayTeam, expectedPair.left, expectedPair.right);
            }
            teamEvents.push(event);
          }
        }

        return teamEvents;
      })();
    }

    const [fetchedGroups, teamEvents] = await Promise.all([
      searchGroupPromise,
      teamGroupsPromise || Promise.resolve([]),
    ]);

    const candidates = dedupeCandidates([...fetchedGroups.flat(), ...teamEvents])
      .filter((candidate) => expectedPair ? candidate.matchScore >= 0.55 : candidate.matchScore > 0.3)
      .sort((a, b) => scoreCandidate(b, query, expectedPair) - scoreCandidate(a, query, expectedPair))
      .slice(0, 12);

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
