export function normalizeSportsStatus(statusRaw: string): { status: string; statusLabel: string } {
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
