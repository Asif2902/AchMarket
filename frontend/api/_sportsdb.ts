const SPORTSDB_API_KEY = process.env.THE_SPORTS_DB_API_KEY?.trim() || '123';
const SPORTSDB_BASE_URL = `https://www.thesportsdb.com/api/v1/json/${SPORTSDB_API_KEY}`;

export function sportsDbUrl(path: string): string {
  return `${SPORTSDB_BASE_URL}/${path.replace(/^\/+/, '')}`;
}

function stripFixtureContext(name: string): string {
  return name
    .replace(/\s[–—-]\s.*$/g, ' ')
    .replace(/\(([^)]*)\)/g, ' ')
    .replace(/\b(first|second)\s+leg\b/g, ' ')
    .replace(/\bleg\s*(1|2)\b/g, ' ')
    .replace(/\b(round of 16|round of sixteen|quarter[\s-]?finals?|semi[\s-]?finals?|play[\s-]?offs?|group stage)\b/g, ' ')
    .replace(/\b(home|away)\b/g, ' ');
}

function applyTeamAliases(name: string): string {
  return name
    .replace(/\bparis saint germain\b/g, 'paris sg')
    .replace(/\bparis st germain\b/g, 'paris sg')
    .replace(/\bpsg\b/g, 'paris sg')
    .replace(/\bbayern munchen\b/g, 'bayern munich')
    .replace(/\bfc bayern\b/g, 'bayern munich');
}

export function normalizeTeamName(name: string): string {
  return applyTeamAliases(
    stripFixtureContext(name)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\bathletico\b/g, 'atletico')
      .replace(/\b(fc|afc|cf|sc|ac|club|team|the)\b/g, ' ')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  )
    .toLowerCase()
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

  const homeMatch = (cHomeNorm && eHomeNorm && cHomeNorm.includes(eHomeNorm)) ||
    (eHomeNorm && cHomeNorm && eHomeNorm.includes(cHomeNorm)) ||
    (cHomeNorm && eAwayNorm && cHomeNorm.includes(eAwayNorm)) ||
    (eAwayNorm && cHomeNorm && eAwayNorm.includes(cHomeNorm));
  const awayMatch = (cAwayNorm && eAwayNorm && cAwayNorm.includes(eAwayNorm)) ||
    (eAwayNorm && cAwayNorm && eAwayNorm.includes(cAwayNorm)) ||
    (cAwayNorm && eHomeNorm && cAwayNorm.includes(eHomeNorm)) ||
    (eHomeNorm && cAwayNorm && eHomeNorm.includes(cAwayNorm));

  if (homeMatch && awayMatch) return 0.8;
  if (homeMatch || awayMatch) return 0.4;

  return 0;
}
