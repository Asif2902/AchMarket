import { useState, useEffect, useRef, useMemo, useCallback, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ethers } from 'ethers';
import { useWallet } from '../../context/WalletContext';
import { usePendingClaims } from '../../hooks/usePendingClaims';
import { FACTORY_ADDRESS, LENS_ADDRESS, STAGE, STAGE_LABELS, STAGE_COLORS } from '../../config/network';
import { FACTORY_ABI, LENS_ABI, MARKET_ABI } from '../../config/abis';
import { PageLoader } from '../../components/LoadingSpinner';
import EmptyState from '../../components/EmptyState';
import UsdcIcon from '../../components/UsdcIcon';
import { formatUSDC, formatCompactUSDC, formatWad, parseContractError, makeMarketSlug } from '../../utils/format';
import { getOutcomeColor } from '../../components/ProbabilityBar';
import { fetchProfileByAddress } from '../../services/profile';
import type { PublicProfile as PublicProfileType } from '../../types/profile';

interface Position {
  market: string;
  marketId: number;
  title: string;
  category: string;
  outcomeLabels: string[];
  sharesPerOutcome: bigint[];
  netDepositedWei: bigint;
  canRedeem: boolean;
  canRefund: boolean;
  hasRedeemed: boolean;
  hasRefunded: boolean;
  stage: number;
}

type TabType = 'all' | 'active' | 'winnings' | 'refunds' | 'claimed';
type SortBy = 'highest_deposit' | 'lowest_deposit' | 'newest' | 'oldest' | 'title_az' | 'title_za' | 'claimable_first';

export default function Portfolio() {
  const { address, readProvider, signer, isConnected } = useWallet();
  const { clearClaim } = usePendingClaims();
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [txPending, setTxPending] = useState<string | null>(null);
  const [txMsg, setTxMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('all');
  const [sortBy, setSortBy] = useState<SortBy>('claimable_first');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [profileSummary, setProfileSummary] = useState<PublicProfileType | null>(null);
  const txMsgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (txMsg) {
      if (txMsgTimer.current) clearTimeout(txMsgTimer.current);
      if (txMsg.type !== 'error') {
        txMsgTimer.current = setTimeout(() => setTxMsg(null), 5000);
      }
    }
    return () => {
      if (txMsgTimer.current) clearTimeout(txMsgTimer.current);
    };
  }, [txMsg]);

  useEffect(() => {
    if (!address) {
      setProfileSummary(null);
      return;
    }

    setProfileSummary(null);

    let cancelled = false;
    const run = async () => {
      try {
        const response = await fetchProfileByAddress(address);
        if (!cancelled) {
          setProfileSummary(response.profile);
        }
      } catch {
        if (!cancelled) {
          setProfileSummary(null);
        }
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [address]);

  const refreshPortfolio = useCallback(async (): Promise<Position[]> => {
    const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, readProvider);
    const lens = new ethers.Contract(LENS_ADDRESS, LENS_ABI, readProvider);
    const [portfolio, totalMarkets] = await Promise.all([
      lens.getUserPortfolio(address!),
      factory.totalMarkets(),
    ]);

    const total = Number(totalMarkets);
    let summaries: Record<string, unknown>[] = [];
    if (total > 0) {
      summaries = await lens.getMarketSummaries(0, total);
    }
    const addrToId = new Map<string, number>();
    for (const s of summaries) {
      addrToId.set((s.market as string).toLowerCase(), Number(s.marketId));
    }

    return portfolio.map((p: Record<string, unknown>) => ({
      market: p.market as string,
      marketId: addrToId.get((p.market as string).toLowerCase()) ?? 0,
      title: p.title as string,
      category: p.category as string,
      outcomeLabels: [...(p.outcomeLabels as string[])],
      sharesPerOutcome: [...(p.sharesPerOutcome as bigint[])],
      netDepositedWei: p.netDepositedWei as bigint,
      canRedeem: p.canRedeem as boolean,
      canRefund: p.canRefund as boolean,
      hasRedeemed: p.hasRedeemed as boolean,
      hasRefunded: p.hasRefunded as boolean,
      stage: Number(p.stage),
    }));
  }, [address, readProvider]);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    const fetch = async () => {
      try {
        setLoading(true);
        const positions = await refreshPortfolio();
        if (!cancelled) setPositions(positions);
      } catch (err) {
        if (!cancelled) console.error('Failed to fetch portfolio:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetch();
    return () => {
      cancelled = true;
    };
  }, [address, refreshPortfolio]);

  const handleAction = async (marketAddr: string, action: 'redeem' | 'refund') => {
    if (!signer) return;
    const submittingAddress = address;
    setTxPending(marketAddr);
    setTxMsg(null);
    try {
      const market = new ethers.Contract(marketAddr, MARKET_ABI, signer);
      const tx = action === 'redeem' ? await market.redeem() : await market.refund();
      await tx.wait();
      setTxMsg({ type: 'success', text: `${action === 'redeem' ? 'Winnings' : 'Refund'} claimed!` });
      clearClaim(marketAddr);
    } catch (err) {
      setTxMsg({ type: 'error', text: parseContractError(err) });
    } finally {
      setTxPending(null);
    }

    if (address !== submittingAddress) return;
    try {
      setPositions(await refreshPortfolio());
    } catch (err) {
      console.error('Failed to refresh portfolio after claim:', err);
    }
  };

  const totalDeposited = positions.reduce((acc, p) => acc + p.netDepositedWei, 0n);
  const activeDeposits = positions.filter((p) => p.stage === STAGE.Active).reduce((acc, p) => acc + p.netDepositedWei, 0n);

  const totalMarkets = new Set(positions.map((p) => p.market)).size;
  const activePositions = positions.filter((p) => p.stage === STAGE.Active).length;
  const claimableWinnings = positions.filter((p) => p.canRedeem && !p.hasRedeemed).length;
  const claimableRefunds = positions.filter((p) => p.canRefund && !p.hasRefunded && p.netDepositedWei > 0n).length;

  const categoryCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const pos of positions) {
      const key = (pos.category || '').trim() || 'Other';
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return ['All', ...Array.from(map.keys()).sort((a, b) => a.localeCompare(b))];
  }, [positions]);

  useEffect(() => {
    if (!categoryCounts.includes(categoryFilter)) {
      setCategoryFilter('All');
    }
  }, [categoryCounts, categoryFilter]);

  const filteredPositions = useMemo(() => {
    return positions
      .filter((p) => {
        if (activeTab === 'winnings') return p.canRedeem && !p.hasRedeemed;
        if (activeTab === 'refunds') return p.canRefund && !p.hasRefunded && p.netDepositedWei > 0n;
        if (activeTab === 'active') return p.stage === STAGE.Active;
        if (activeTab === 'claimed') return p.hasRedeemed || p.hasRefunded;
        return true;
      })
      .filter((p) => {
        if (categoryFilter === 'All') return true;
        const normalized = (p.category || '').trim() || 'Other';
        return normalized.toLowerCase() === categoryFilter.toLowerCase();
      })
      .sort((a, b) => {
        if (sortBy === 'highest_deposit') {
          if (a.netDepositedWei === b.netDepositedWei) return b.marketId - a.marketId;
          return a.netDepositedWei > b.netDepositedWei ? -1 : 1;
        }

        if (sortBy === 'lowest_deposit') {
          if (a.netDepositedWei === b.netDepositedWei) return b.marketId - a.marketId;
          return a.netDepositedWei < b.netDepositedWei ? -1 : 1;
        }

        if (sortBy === 'newest') return b.marketId - a.marketId;
        if (sortBy === 'oldest') return a.marketId - b.marketId;
        if (sortBy === 'title_az') return a.title.localeCompare(b.title);
        if (sortBy === 'title_za') return b.title.localeCompare(a.title);

        const aClaimable = (a.canRedeem && !a.hasRedeemed) || (a.canRefund && !a.hasRefunded && a.netDepositedWei > 0n);
        const bClaimable = (b.canRedeem && !b.hasRedeemed) || (b.canRefund && !b.hasRefunded && b.netDepositedWei > 0n);
        if (aClaimable !== bClaimable) return aClaimable ? -1 : 1;
        if (a.netDepositedWei === b.netDepositedWei) return b.marketId - a.marketId;
        return a.netDepositedWei > b.netDepositedWei ? -1 : 1;
      });
  }, [positions, activeTab, categoryFilter, sortBy]);

  const tabCounts = {
    all: positions.length,
    active: positions.filter(p => p.stage === STAGE.Active).length,
    winnings: positions.filter(p => p.canRedeem && !p.hasRedeemed).length,
    refunds: positions.filter(p => p.canRefund && !p.hasRefunded && p.netDepositedWei > 0n).length,
    claimed: positions.filter(p => p.hasRedeemed || p.hasRefunded).length,
  };

  const claimableValue = positions
    .filter((p) => (p.canRedeem && !p.hasRedeemed) || (p.canRefund && !p.hasRefunded && p.netDepositedWei > 0n))
    .reduce((acc, p) => acc + p.netDepositedWei, 0n);

  const resolvedCount = positions.filter((p) => p.stage === STAGE.Resolved).length;
  const cancelledCount = positions.filter((p) => p.stage === STAGE.Cancelled || p.stage === STAGE.Expired).length;
  const activeRatio = totalMarkets > 0 ? (activePositions / totalMarkets) * 100 : 0;

  const profileName = (profileSummary?.displayName ?? '').trim();
  const greetingName = profileName || (address ? `${address.slice(0, 6)}...${address.slice(-4)}` : 'Trader');

  if (!isConnected) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20">
        <EmptyState
          title="Connect Wallet"
          description="Connect your wallet to view your portfolio and positions."
          icon={
            <svg className="w-7 h-7 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3" />
            </svg>
          }
        />
      </div>
    );
  }

  if (loading) return <PageLoader />;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6 animate-fade-in">
      <div className="card p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-gradient-to-r from-cyan-500/[0.10] via-transparent to-primary-500/[0.08] border-cyan-400/20">
        <div>
          <p className="text-lg sm:text-xl font-semibold text-white">Hi {greetingName}, here is your portfolio.</p>
          <p className="text-xs text-dark-400 mt-1">Track positions, claim outcomes, and keep your momentum rolling.</p>
          <div className="mt-2 flex items-center gap-2 text-2xs">
            <span className="px-2 py-1 rounded-md border border-cyan-400/25 bg-cyan-400/10 text-cyan-200">{positions.length} positions</span>
            <span className="px-2 py-1 rounded-md border border-emerald-500/25 bg-emerald-500/10 text-emerald-200">{claimableWinnings + claimableRefunds} claimable</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/profile" className="btn-secondary text-xs px-3 py-2">
            Profile Hub
          </Link>
        </div>
      </div>

      {/* Header */}
      <div className="card p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-gradient-to-br from-primary-500/[0.07] via-transparent to-emerald-500/[0.05] border-primary-500/15">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white">Portfolio</h1>
          <p className="text-xs text-dark-400 mt-0.5">{positions.length} position{positions.length !== 1 ? 's' : ''} across {totalMarkets} market{totalMarkets !== 1 ? 's' : ''}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-2xs">
            <span className="px-2 py-1 rounded-md bg-emerald-500/15 text-emerald-300 border border-emerald-500/25">{claimableWinnings + claimableRefunds} claimable</span>
            <span className="px-2 py-1 rounded-md bg-blue-500/12 text-blue-300 border border-blue-500/25">{resolvedCount} resolved</span>
            <span className="px-2 py-1 rounded-md bg-amber-500/12 text-amber-300 border border-amber-500/25">{activeRatio.toFixed(0)}% active</span>
          </div>
        </div>
        <Link to="/" className="btn-secondary text-xs px-3 py-2 shrink-0 !min-h-0">
          Browse Markets
        </Link>
      </div>

      {/* Summary stats */}
      {positions.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
          <SummaryCard label="Total Deposited" value={formatCompactUSDC(totalDeposited)} suffix="USDC" icon={<UsdcIcon size={16} />} accent="neutral" />
          <SummaryCard label="Active Deposits" value={formatCompactUSDC(activeDeposits)} suffix="USDC" icon={<UsdcIcon size={16} />} accent="primary" />
          <SummaryCard label="Claimable Value" value={formatCompactUSDC(claimableValue)} suffix="USDC" icon={<UsdcIcon size={16} />} accent="success" />
          <SummaryCard label="Markets" value={`${totalMarkets}`} icon={<MiniMarketIcon />} accent="neutral" />
          <SummaryCard label="Active" value={`${activePositions}`} icon={<MiniBoltIcon />} accent="info" />
          <SummaryCard label="Cancelled" value={`${cancelledCount}`} icon={<MiniCloseIcon />} accent="danger" />
        </div>
      )}

      {/* Tab Chips */}
      {positions.length > 0 && (
        <div className="card p-3 sm:p-4">
          <div className="flex flex-col lg:flex-row gap-3 lg:items-center lg:justify-between">
            <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide" role="tablist" aria-label="Portfolio filter tabs">
              {(['all', 'active', 'winnings', 'refunds', 'claimed'] as TabType[]).map((tab) => (
                <button
                  key={tab}
                  role="tab"
                  aria-selected={activeTab === tab}
                  aria-pressed={activeTab === tab}
                  onClick={() => setActiveTab(tab)}
                  className={`chip shrink-0 ${activeTab === tab ? 'chip-active' : ''}`}
                >
                  {tab === 'winnings' ? 'Est. Winnings' : tab === 'refunds' ? 'Est. Refunds' : tab.charAt(0).toUpperCase() + tab.slice(1)}
                  <span className="ml-1.5 px-1.5 py-0.5 rounded bg-white/20 text-2xs">
                    {tabCounts[tab]}
                  </span>
                </button>
              ))}
            </div>

            <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-end">
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                aria-label="Filter by category"
                className="select-field text-xs sm:text-sm min-h-[40px] sm:min-h-[42px] sm:w-44"
              >
                {categoryCounts.map((category) => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortBy)}
                aria-label="Sort positions"
                className="select-field text-xs sm:text-sm min-h-[40px] sm:min-h-[42px] sm:w-56"
              >
                <option value="claimable_first">Claimable First</option>
                <option value="highest_deposit">Highest Deposit</option>
                <option value="lowest_deposit">Lowest Deposit</option>
                <option value="newest">Newest Markets</option>
                <option value="oldest">Oldest Markets</option>
                <option value="title_az">Title A-Z</option>
                <option value="title_za">Title Z-A</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Messages */}
      {txMsg && (
        <div className={`p-3 rounded-xl text-sm ${
          txMsg.type === 'success' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'
        }`}>
          {txMsg.text}
        </div>
      )}

      {/* Positions */}
      {filteredPositions.length === 0 ? (
        <EmptyState
          title={activeTab === 'all' ? "No positions yet" : `No ${activeTab} positions`}
          description={
            activeTab === 'all' 
              ? "You haven't traded in any prediction markets yet. Browse markets to get started."
              : activeTab === 'active'
              ? "You don't have any active positions right now."
              : activeTab === 'claimed'
              ? "You haven't claimed any winnings or refunds yet."
              : activeTab === 'winnings'
              ? "You don't have any estimated winnings to claim right now."
              : activeTab === 'refunds'
              ? "You don't have any estimated refunds to claim right now."
              : `You don't have any ${activeTab} to claim right now.`
          }
          action={activeTab === 'all' ? <Link to="/" className="btn-primary text-sm">Browse Markets</Link> : undefined}
        />
      ) : (
         <div className="space-y-3">
          {filteredPositions.map((pos, idx) => (
            <div key={pos.market} className="card p-4 sm:p-5 animate-fade-in-up bg-gradient-to-br from-white/[0.015] to-transparent" style={{ animationDelay: `${idx * 50}ms`, animationFillMode: 'both' }}>
              {/* Title + Badge */}
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-3 mb-3">
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/market/${makeMarketSlug(pos.marketId, pos.title)}`}
                    className="font-semibold text-sm text-white hover:text-primary-400 transition-colors line-clamp-2 sm:line-clamp-1"
                  >
                    {pos.title}
                  </Link>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <span className={`badge text-2xs ${STAGE_COLORS[pos.stage]}`}>{STAGE_LABELS[pos.stage]}</span>
                    <span className="text-2xs text-dark-500">{pos.category}</span>
                    {(pos.canRedeem && !pos.hasRedeemed) && (
                      <span className="badge text-2xs bg-emerald-500/15 text-emerald-300 border-emerald-500/25">Claim Winnings</span>
                    )}
                    {(pos.canRefund && !pos.hasRefunded && pos.netDepositedWei > 0n) && (
                      <span className="badge text-2xs bg-cyan-500/15 text-cyan-300 border-cyan-500/25">Claim Refund</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center sm:items-end gap-1.5 sm:flex-col sm:text-right shrink-0">
                  <p className="text-2xs text-dark-500 font-medium">Deposited</p>
                  <p className="text-sm font-bold text-white tabular-nums flex items-center gap-1"><UsdcIcon size={13} />{formatUSDC(pos.netDepositedWei)}</p>
                </div>
              </div>

              {/* Shares */}
              <div className="flex flex-wrap gap-1.5 mb-3">
                {pos.outcomeLabels.map((label, i) => {
                  const shares = pos.sharesPerOutcome[i];
                  if (shares === 0n) return null;
                  const color = getOutcomeColor(i);
                  return (
                    <span key={i} className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-2xs font-semibold ${color.light} ${color.text}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${color.bg}`} />
                      {label}: {formatWad(shares)}
                    </span>
                  );
                })}
              </div>

              {/* Actions */}
              <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-white/[0.06]">
                {pos.canRedeem && (
                  <button
                    onClick={() => handleAction(pos.market, 'redeem')}
                    disabled={txPending === pos.market}
                    className="btn-yes text-xs px-3 py-1.5"
                  >
                    {txPending === pos.market ? (
                      <span className="flex items-center gap-1.5">
                        <div className="w-3 h-3 border-[1.5px] border-white/30 border-t-white rounded-full animate-spin" />
                        Claiming...
                      </span>
                    ) : 'Claim Winnings'}
                  </button>
                )}
                {pos.canRefund && (
                  <button
                    onClick={() => handleAction(pos.market, 'refund')}
                    disabled={txPending === pos.market}
                    className="btn-primary text-xs px-3 py-1.5"
                  >
                    {txPending === pos.market ? (
                      <span className="flex items-center gap-1.5">
                        <div className="w-3 h-3 border-[1.5px] border-white/30 border-t-white rounded-full animate-spin" />
                        Claiming...
                      </span>
                    ) : 'Claim Refund'}
                  </button>
                )}
                {pos.hasRedeemed && (
                  <span className="text-2xs text-emerald-400 font-medium flex items-center gap-1">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    Winnings claimed
                  </span>
                )}
                {pos.hasRefunded && (
                  <span className="text-2xs text-blue-400 font-medium flex items-center gap-1">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    Refund claimed
                  </span>
                )}

                {/* View market link */}
                <Link
                  to={`/market/${makeMarketSlug(pos.marketId, pos.title)}`}
                  className="ml-auto text-2xs text-dark-500 hover:text-primary-400 font-medium transition-colors flex items-center gap-0.5"
                >
                  View
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  suffix,
  icon,
  accent,
}: {
  label: string;
  value: string;
  suffix?: string;
  icon: ReactNode;
  accent: 'neutral' | 'primary' | 'success' | 'info' | 'danger';
}) {
  const accentStyles = {
    neutral: 'bg-white/[0.02] border-white/[0.08] text-white',
    primary: 'bg-primary-500/[0.08] border-primary-500/25 text-primary-200',
    success: 'bg-emerald-500/[0.08] border-emerald-500/25 text-emerald-200',
    info: 'bg-blue-500/[0.08] border-blue-500/25 text-blue-200',
    danger: 'bg-red-500/[0.08] border-red-500/25 text-red-200',
  };

  return (
    <div className={`card p-3.5 border ${accentStyles[accent]}`}>
      <div className="flex items-center gap-2 text-2xs uppercase tracking-wider text-white/55 mb-1.5">
        <span className="w-5 h-5 rounded-md bg-black/25 border border-white/[0.08] flex items-center justify-center">
          {icon}
        </span>
        {label}
      </div>
      <p className="text-lg font-bold tabular-nums text-white leading-none">
        {value}
        {suffix ? <span className="text-2xs font-medium text-white/45 ml-1.5">{suffix}</span> : null}
      </p>
    </div>
  );
}

function MiniMarketIcon() {
  return (
    <svg className="w-3.5 h-3.5 text-white/75" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h12A2.25 2.25 0 0120.25 15.75V18A2.25 2.25 0 0118 20.25H6A2.25 2.25 0 013.75 18v-2.25z" />
    </svg>
  );
}

function MiniBoltIcon() {
  return (
    <svg className="w-3.5 h-3.5 text-blue-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 3L4 14h6l-1 7 9-11h-6l1-7z" />
    </svg>
  );
}

function MiniCloseIcon() {
  return (
    <svg className="w-3.5 h-3.5 text-red-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M6 18L18 6" />
    </svg>
  );
}
