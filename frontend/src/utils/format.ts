import { ethers } from 'ethers';

export interface StabilityLevel {
  label: string;
  color: string;
  gradient: string;
  bgColor: string;
}

export interface StabilityFilter {
  value: string;
  label: string;
  min?: number;
  max?: number;
}

export function getStabilityLevel(bWad: bigint | string): StabilityLevel {
  const bValue = Number(ethers.formatEther(bWad));

  if (bValue <= 5000) {
    return {
      label: 'Degen Market',
      color: 'text-orange-400',
      gradient: 'from-orange-500 to-red-500',
      bgColor: 'bg-orange-500/20 border-orange-500/30',
    };
  }

  if (bValue <= 10000) {
    return {
      label: 'Highly Unstable',
      color: 'text-red-400',
      gradient: 'from-red-500 to-rose-600',
      bgColor: 'bg-red-500/20 border-red-500/30',
    };
  }

  if (bValue <= 25000) {
    return {
      label: 'Unstable',
      color: 'text-amber-400',
      gradient: 'from-amber-500 to-orange-500',
      bgColor: 'bg-amber-500/20 border-amber-500/30',
    };
  }

  if (bValue <= 50000) {
    return {
      label: 'Stable',
      color: 'text-emerald-400',
      gradient: 'from-emerald-500 to-teal-500',
      bgColor: 'bg-emerald-500/20 border-emerald-500/30',
    };
  }

  if (bValue <= 100000) {
    return {
      label: 'Highly Stable',
      color: 'text-cyan-400',
      gradient: 'from-cyan-500 to-blue-500',
      bgColor: 'bg-cyan-500/20 border-cyan-500/30',
    };
  }

  if (bValue <= 250000) {
    return {
      label: 'Extremely Stable',
      color: 'text-blue-400',
      gradient: 'from-blue-500 to-indigo-500',
      bgColor: 'bg-blue-500/20 border-blue-500/30',
    };
  }

  return {
    label: 'Whale Stable',
    color: 'text-violet-400',
    gradient: 'from-violet-500 to-purple-600',
    bgColor: 'bg-violet-500/20 border-violet-500/30',
  };
}

export const STABILITY_FILTERS = [
  { value: 'all', label: 'All Stability' },
  { value: 'degen_market', label: 'Degen Market', min: 1000, max: 5000 },
  { value: 'highly_unstable', label: 'Highly Unstable', min: 5001, max: 10000 },
  { value: 'unstable', label: 'Unstable', min: 10001, max: 25000 },
  { value: 'stable', label: 'Stable', min: 25001, max: 50000 },
  { value: 'highly_stable', label: 'Highly Stable', min: 50001, max: 100000 },
  { value: 'extremely_stable', label: 'Extremely Stable', min: 100001, max: 250000 },
  { value: 'whale_stable', label: 'Whale Stable', min: 250001, max: Infinity },
];

/**
 * Format a wei amount to human-readable USDC with appropriate decimals.
 */
export function formatUSDC(weiValue: bigint | string, decimals = 4): string {
  const formatted = ethers.formatEther(weiValue);
  const num = parseFloat(formatted);
  if (num === 0) return '0';
  if (num < 0.0001) return '< 0.0001';
  return num.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

/**
 * Format a number to compact form (K, M, B, T)
 */
export function formatCompact(num: number): string {
  if (num >= 1e12) return (num / 1e12).toFixed(1).replace(/\.0$/, '') + 'T';
  if (num >= 1e9) return (num / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M';
  if (num >= 1e4) return (num / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  if (num >= 1e3) return (num / 1e3).toFixed(2).replace(/\.?0+$/, '') + 'K';
  if (num >= 1) return num.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (num >= 0.01) return num.toFixed(2);
  return num.toFixed(4);
}

/**
 * Format a bigint wei value to compact USDC (K, M, B, T)
 */
export function formatCompactUSDC(weiValue: bigint | string): string {
  const formatted = ethers.formatEther(weiValue);
  const num = parseFloat(formatted);
  if (num === 0) return '0';
  return formatCompact(num);
}

/**
 * Format a WAD value (1e18 = 1.0) to a human-readable number.
 */
export function formatWad(wadValue: bigint | string, decimals = 2): string {
  const formatted = ethers.formatEther(wadValue);
  const num = parseFloat(formatted);
  if (num === 0) return '0';
  return num.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

/**
 * Format a WAD probability (0-1e18) to a percentage string.
 */
export function formatProbability(wadProb: bigint | string): string {
  const num = Number(wadProb) / 1e18;
  return (num * 100).toFixed(1) + '%';
}

/**
 * Get probability as a number 0-100.
 */
export function probToPercent(wadProb: bigint | string): number {
  return Number(wadProb) / 1e16;
}

/**
 * Parse USDC amount string to wei bigint.
 */
export function parseUSDCToWei(amount: string): bigint {
  return ethers.parseEther(amount);
}

/**
 * Format a timestamp to a readable date string.
 */
export function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Get time remaining from now until a deadline.
 */
export function getTimeRemaining(deadline: number): {
  total: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  expired: boolean;
} {
  const total = deadline * 1000 - Date.now();
  if (total <= 0) {
    return { total: 0, days: 0, hours: 0, minutes: 0, seconds: 0, expired: true };
  }
  return {
    total,
    days: Math.floor(total / (1000 * 60 * 60 * 24)),
    hours: Math.floor((total / (1000 * 60 * 60)) % 24),
    minutes: Math.floor((total / (1000 * 60)) % 60),
    seconds: Math.floor((total / 1000) % 60),
    expired: false,
  };
}

/**
 * Format time remaining as a compact string.
 */
export function formatTimeRemaining(deadline: number): string {
  const { days, hours, minutes, expired } = getTimeRemaining(deadline);
  if (expired) return 'Expired';
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/**
 * Format time ago from a timestamp.
 */
export function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp * 1000;
  const minutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

/**
 * Truncate an address for display.
 */
export function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Convert IPFS URI to a gateway URL with scheme validation.
 */
export function resolveImageUri(uri: string): string {
  if (!uri) return '';
  
  // Handle IPFS URIs
  if (uri.startsWith('ipfs://')) {
    const hash = uri.replace('ipfs://', '');
    return `https://gateway.pinata.cloud/ipfs/${hash}`;
  }
  
  // Handle raw IPFS hashes
  if (uri.startsWith('Qm') || uri.startsWith('bafy')) {
    return `https://gateway.pinata.cloud/ipfs/${uri}`;
  }
  
  // Validate URL schemes for security
  try {
    const url = new URL(uri);
    const allowedSchemes = ['https:', 'http:'];
    if (!allowedSchemes.includes(url.protocol)) {
      console.warn('Blocked unsafe URL scheme:', url.protocol);
      return '';
    }
    return uri;
  } catch {
    // If it's not a valid URL, return as-is (could be a path or other string)
    return uri;
  }
}

/**
 * Compute slippage-adjusted max cost for buying.
 */
export function applyBuySlippage(costWei: bigint, slippagePercent: number): bigint {
  const basis = BigInt(Math.floor(slippagePercent * 100));
  return costWei + (costWei * basis) / 10000n;
}

/**
 * Compute slippage-adjusted min proceeds for selling.
 */
export function applySellSlippage(proceedsWei: bigint, slippagePercent: number): bigint {
  const basis = BigInt(Math.floor(slippagePercent * 100));
  return proceedsWei - (proceedsWei * basis) / 10000n;
}

/**
 * Convert a string to a URL-friendly slug.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * Create a hybrid market slug: "1-will-bitcoin-reach-100k"
 */
export function makeMarketSlug(marketId: number, title: string): string {
  return `${marketId}-${slugify(title)}`;
}

/**
 * Extract the numeric market ID from a hybrid slug.
 * "1-will-bitcoin-reach-100k" → 1
 */
export function parseMarketSlug(slug: string): number | null {
  const match = slug.match(/^(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Parse contract revert reason from error.
 */
export function parseContractError(error: unknown): string {
  if (error && typeof error === 'object') {
    const e = error as Record<string, unknown>;
    // ethers v6 error shapes
    if (e.reason && typeof e.reason === 'string') return e.reason;
    if (e.shortMessage && typeof e.shortMessage === 'string') return e.shortMessage;
    if (e.message && typeof e.message === 'string') {
      const match = (e.message as string).match(/reason="([^"]+)"/);
      if (match) return match[1];
      const revertMatch = (e.message as string).match(/reverted with reason string '([^']+)'/);
      if (revertMatch) return revertMatch[1];
      if ((e.message as string).includes('user rejected')) return 'Transaction rejected by user';
      if ((e.message as string).includes('insufficient funds')) return 'Insufficient USDC balance';
      return e.message as string;
    }
  }
  return 'An unexpected error occurred';
}

export interface ProofLink {
  url: string;
  type: 'image' | 'link';
  label?: string;
}

/**
 * Parse proofUri string into structured proof links.
 * Format: "image_url || main_link_url || extra_link_type:url || ..."
 * - First link: always treated as image
 * - Second link: always treated as main proof link
 * - Third+ links: format "type:url" where type is "image" or "link"
 *
 * For single-part legacy proofs (no "||" separator), the value is stored
 * in `raw` so callers can render a clickable fallback when the image fails.
 */
export function parseProofLinks(proofUri: string): {
  image: string | null;
  mainLink: string | null;
  raw: string | null;
  extraLinks: ProofLink[];
} {
  if (!proofUri) {
    return { image: null, mainLink: null, raw: null, extraLinks: [] };
  }

  const parts = proofUri.split('||').map(p => p.trim()).filter(p => p.length > 0);
  
  if (parts.length === 0) {
    return { image: null, mainLink: null, raw: null, extraLinks: [] };
  }

  const image = parts[0] || null;
  const mainLink = parts[1] || null;
  const raw = parts.length === 1 ? parts[0] : null;
  
  const extraLinks: ProofLink[] = [];
  for (let i = 2; i < parts.length; i++) {
    const part = parts[i];
    const colonIndex = part.indexOf(':');
    if (colonIndex > 0) {
      const type = part.slice(0, colonIndex).toLowerCase();
      const url = part.slice(colonIndex + 1).trim();
      if (type === 'image' || type === 'link') {
        if (url) {
          extraLinks.push({
            url,
            type: type as 'image' | 'link',
          });
        }
      } else {
        extraLinks.push({
          url: part,
          type: 'link',
        });
      }
    } else {
      extraLinks.push({
        url: part,
        type: 'link',
      });
    }
  }

  return { image, mainLink, raw, extraLinks };
}

export function parseDescription(raw: string): { description: string; subcategory: string | null } {
  const parts = (raw ?? '').split(':::');
  if (parts.length === 2) {
    return { description: parts[0].trim(), subcategory: parts[1].trim() };
  }
  return { description: raw ?? '', subcategory: null };
}
