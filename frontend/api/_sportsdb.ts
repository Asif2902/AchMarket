const SPORTSDB_API_KEY = process.env.THE_SPORTS_DB_API_KEY?.trim() || '123';
const SPORTSDB_BASE_URL = `https://www.thesportsdb.com/api/v1/json/${SPORTSDB_API_KEY}`;

export function sportsDbUrl(path: string): string {
  return `${SPORTSDB_BASE_URL}/${path.replace(/^\/+/, '')}`;
}

export function normalizeTeamName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\bathletico\b/g, 'atletico')
    .replace(/\b(fc|afc|cf|sc|ac|club|team|the)\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function teamsMatch(candidateHome: string, candidateAway: string, expectedHome: string, expectedAway: string): number {
  const cHomeNorm = normalizeTeamName(candidateHome);
  const cAwayNorm = normalizeTeamName(candidateAway);
  const eHomeNorm = normalizeTeamName(expectedHome);
  const eAwayNorm = normalizeTeamName(expectedAway);

  if (cHomeNorm === eHomeNorm && cAwayNorm === eAwayNorm) return 1.0;
  if (cHomeNorm === eAwayNorm && cAwayNorm === eHomeNorm) return 0.9;

  const homeMatch = cHomeNorm.includes(eHomeNorm) || eHomeNorm.includes(cHomeNorm) ||
    cHomeNorm.includes(eAwayNorm) || eAwayNorm.includes(cHomeNorm);
  const awayMatch = cAwayNorm.includes(eAwayNorm) || eAwayNorm.includes(cAwayNorm) ||
    cAwayNorm.includes(eHomeNorm) || eHomeNorm.includes(cAwayNorm);

  if (homeMatch && awayMatch) return 0.8;
  if (homeMatch || awayMatch) return 0.4;

  return 0;
}
