import { useState, useEffect, useCallback } from 'react';
import { useWallet } from '../context/WalletContext';
import { FACTORY_ADDRESS, LENS_ADDRESS } from '../config/network';
import { FACTORY_ABI, LENS_ABI } from '../config/abis';
import { ethers } from 'ethers';

export interface PendingClaim {
  marketAddress: string;
  marketId: number;
  title: string;
  category: string;
  outcomeLabels: string[];
  winningOutcome: number;
  type: 'win' | 'refund';
  amountWei: bigint;
  stage: number;
}

const CACHE_KEY_PREFIX = 'achmarket_pending_claims_';
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

function getCacheKey(address: string): string {
  return `${CACHE_KEY_PREFIX}${address.toLowerCase()}`;
}

interface CachedClaims {
  lastUpdated: number;
  claims: PendingClaim[];
}

function getCachedClaims(address: string): CachedClaims | null {
  try {
    const cached = localStorage.getItem(getCacheKey(address));
    if (!cached) return null;
    const parsed = JSON.parse(cached) as CachedClaims;
    if (Date.now() - parsed.lastUpdated > CACHE_DURATION) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function setCachedClaims(address: string, claims: PendingClaim[]): void {
  try {
    const data: CachedClaims = {
      lastUpdated: Date.now(),
      claims,
    };
    localStorage.setItem(getCacheKey(address), JSON.stringify(data));
  } catch {
    // localStorage not available
  }
}

export function usePendingClaims() {
  const { address, readProvider } = useWallet();
  const [pendingClaims, setPendingClaims] = useState<PendingClaim[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchPendingClaims = useCallback(async () => {
    if (!address || !readProvider) {
      setPendingClaims([]);
      return;
    }

    // Check cache first
    const cached = getCachedClaims(address);
    if (cached) {
      setPendingClaims(cached.claims);
      return;
    }

    setLoading(true);
    try {
      const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, readProvider);
      const lens = new ethers.Contract(LENS_ADDRESS, LENS_ABI, readProvider);
      
      const [portfolio, totalMarkets] = await Promise.all([
        lens.getUserPortfolio(address),
        factory.totalMarkets(),
      ]);

      const total = Number(totalMarkets);
      if (total === 0) {
        setPendingClaims([]);
        setCachedClaims(address, []);
        setLoading(false);
        return;
      }

      const summaries = await lens.getMarketSummaries(0, total);
      const addrToId = new Map<string, number>();
      const addrToSummary = new Map<string, Record<string, unknown>>();
      for (const s of summaries) {
        const marketAddr = (s.market as string).toLowerCase();
        addrToId.set(marketAddr, Number(s.marketId));
        addrToSummary.set(marketAddr, s);
      }

      const claims: PendingClaim[] = [];
      
      for (const p of portfolio as Record<string, unknown>[]) {
        const marketAddr = (p.market as string).toLowerCase();
        const canRedeem = p.canRedeem as boolean;
        const canRefund = p.canRefund as boolean;
        const hasRedeemed = p.hasRedeemed as boolean;
        const hasRefunded = p.hasRefunded as boolean;
        
        const summary = addrToSummary.get(marketAddr);
        const stage = summary ? Number(summary.stage) : 0;

        if (canRedeem && !hasRedeemed && summary) {
          const shares = p.sharesPerOutcome as bigint[];
          const winningOutcome = Number(summary.winningOutcome);
          const winningShares = shares[winningOutcome] || 0n;
          
          // Calculate winnings: shares * price (simplified - actual would need more data)
          // For now, use a reasonable estimate based on net deposited
          const netDeposited = p.netDepositedWei as bigint;
          
          claims.push({
            marketAddress: p.market as string,
            marketId: addrToId.get(marketAddr) || 0,
            title: p.title as string,
            category: p.category as string,
            outcomeLabels: [...(p.outcomeLabels as string[])],
            winningOutcome,
            type: 'win',
            amountWei: winningShares > 0n ? winningShares : netDeposited,
            stage,
          });
        }

        if (canRefund && !hasRefunded && (p.netDepositedWei as bigint) > 0n) {
          claims.push({
            marketAddress: p.market as string,
            marketId: addrToId.get(marketAddr) || 0,
            title: p.title as string,
            category: p.category as string,
            outcomeLabels: [...(p.outcomeLabels as string[])],
            winningOutcome: 0,
            type: 'refund',
            amountWei: p.netDepositedWei as bigint,
            stage,
          });
        }
      }

      setPendingClaims(claims);
      setCachedClaims(address, claims);
    } catch (error) {
      console.error('Error fetching pending claims:', error);
      setPendingClaims([]);
    } finally {
      setLoading(false);
    }
  }, [address, readProvider]);

  // Clear cache for address after successful claim
  const clearClaim = useCallback((marketAddress: string) => {
    if (!address) return;
    const updated = pendingClaims.filter(c => c.marketAddress.toLowerCase() !== marketAddress.toLowerCase());
    setPendingClaims(updated);
    setCachedClaims(address, updated);
  }, [address, pendingClaims]);

  useEffect(() => {
    fetchPendingClaims();
  }, [fetchPendingClaims]);

  // Refresh every 5 minutes
  useEffect(() => {
    if (!address) return;
    const interval = setInterval(fetchPendingClaims, CACHE_DURATION);
    return () => clearInterval(interval);
  }, [address, fetchPendingClaims]);

  return {
    pendingClaims,
    pendingCount: pendingClaims.length,
    loading,
    refresh: fetchPendingClaims,
    clearClaim,
  };
}
