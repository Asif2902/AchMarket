export function utcToLocal(utcIsoString: string): string {
  if (!utcIsoString) return '';
  const date = new Date(utcIsoString);
  if (isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function localToUtc(localDateTime: string): string {
  if (!localDateTime) return '';
  const date = new Date(localDateTime);
  if (isNaN(date.getTime())) return '';
  return date.toISOString();
}

export function formatLocalDateTime(utcIsoString: string): string {
  if (!utcIsoString) return '';
  const date = new Date(utcIsoString);
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Categorizes a UTC date string into a day group for UI grouping.
 * @param utcIsoString - ISO date string to categorize
 * @returns 'today' for today or past dates, 'tomorrow', 'day3' (2 days out), or 'later'
 * 
 * Note: Past dates (diffDays < 0) are intentionally mapped to 'today' to ensure
 * past events still appear in an actionable context rather than being hidden.
 */
export function getDayGroup(utcIsoString: string): 'today' | 'tomorrow' | 'day3' | 'later' {
  if (!utcIsoString) return 'later';
  const date = new Date(utcIsoString);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.floor((targetDay.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  
  if (diffDays < 0) return 'today';
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'tomorrow';
  if (diffDays === 2) return 'day3';
  return 'later';
}
