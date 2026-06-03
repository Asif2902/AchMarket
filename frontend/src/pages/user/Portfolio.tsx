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

interface Position {
  market: string;
  marketId: number | null;
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
  winningOutcome: number | null;
  totalSharesWad: bigint[];
  resolvedPoolWei: bigint;
  totalNetDepositedWei: bigint;
  contractBalanceWei: bigint;
}

type TabType = 'all' | 'active' | 'winnings' | 'refunds' | 'claimed';
type SortBy = 'highest_deposit' | 'lowest_deposit' | 'newest' | 'oldest' | 'title_az' | 'title_za' | 'claimable_first';

export default function Portfolio() {
  const { address, readProvider, signer, isConnected } = useWallet();
  const { clearClaim } = usePendingClaims();
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [txPending, setTxPending] = useState<string | null>(null);
  const [txMsg, setTxMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('all');
  const [sortBy, setSortBy] = useState<SortBy>('claimable_first');
  const [categoryFilter, setCategoryFilter] = useState('All');
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

  const latestAddressRef = useRef(address);
  latestAddressRef.current = address;
  const addrToIdCache = useRef<Map<string, number>>(new Map());

  const refreshPortfolio = useCallback(async (expectedAddress: string): Promise<Position[]> => {
    const lens = new ethers.Contract(LENS_ADDRESS, LENS_ABI, readProvider);
    const portfolio = await lens.getUserPortfolio(expectedAddress);

    const portfolioAddrs = (portfolio as Array<Record<string, unknown>>)
      .map((p) => (p.market as string).toLowerCase());
    const uniqueAddrs = [...new Set(portfolioAddrs)];

    const cachedEntries = uniqueAddrs
      .map((addr) => [addr, addrToIdCache.current.get(addr)] as [string, number | undefined])
      .filter(([, id]) => id !== undefined) as Array<[string, number]>;

    const missingAddrs = uniqueAddrs.filter((addr) => !addrToIdCache.current.has(addr));

    if (missingAddrs.length > 0) {
      const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, readProvider);
      const totalMarkets = Number(await factory.totalMarkets());
      if (totalMarkets > 0) {
        const summaries = await lens.getMarketSummaries(0, totalMarkets);
        for (const s of summaries as Array<Record<string, unknown>>) {
          const addr = (s.market as string).toLowerCase();
          const id = Number(s.marketId);
          addrToIdCache.current.set(addr, id);
        }
      }
    }

    return Promise.all(portfolio.map(async (p: Record<string, unknown>) => {
      const market = p.market as string;
      const stage = Number(p.stage);
      let winningOutcome: number | null = null;
      let totalSharesWad: bigint[] = [];
      let resolvedPoolWei = 0n;
      let totalNetDepositedWei = 0n;
      let contractBalanceWei = 0n;

      if (stage === STAGE.Resolved || stage === STAGE.Cancelled || stage === STAGE.Expired) {
        try {
          const detail = await lens.getMarketDetail(market) as Record<string, unknown>;
          winningOutcome = Number(detail.winningOutcome);
          totalSharesWad = [...(detail.totalSharesWad as bigint[])];
          resolvedPoolWei = detail.resolvedPoolWei as bigint;

          if (stage === STAGE.Cancelled || stage === STAGE.Expired) {
            const marketContract = new ethers.Contract(market, MARKET_ABI, readProvider);
            totalNetDepositedWei = await marketContract.totalNetDepositedWei();
            contractBalanceWei = await readProvider.getBalance(market);
          }
        } catch (err) {
          console.error(`Failed to fetch ROI detail for ${market}:`, err);
        }
      }

      return {
        market,
        marketId: addrToIdCache.current.get(market.toLowerCase()) ?? null,
        title: p.title as string,
        category: p.category as string,
        outcomeLabels: [...(p.outcomeLabels as string[])],
        sharesPerOutcome: [...(p.sharesPerOutcome as bigint[])],
        netDepositedWei: p.netDepositedWei as bigint,
        canRedeem: p.canRedeem as boolean,
        canRefund: p.canRefund as boolean,
        hasRedeemed: p.hasRedeemed as boolean,
        hasRefunded: p.hasRefunded as boolean,
        stage,
        winningOutcome,
        totalSharesWad,
        resolvedPoolWei,
        totalNetDepositedWei,
        contractBalanceWei,
      };
    }));
  }, [readProvider]);

  useEffect(() => {
    if (!address) {
      setPositions([]);
      setTxPending(null);
      setLoadError(false);
      return;
    }

    setPositions([]);
    setTxPending(null);
    setLoadError(false);
    setLoading(true);

    let cancelled = false;
    const fetch = async () => {
      try {
        const positions = await refreshPortfolio(address);
        if (!cancelled) {
          setPositions(positions);
          setLoadError(false);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to fetch portfolio:', err);
          setLoadError(true);
        }
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
    if (!signer || !address) return;
    const submittingAddress = address;
    setTxPending(marketAddr);
    setTxMsg(null);
    try {
      const market = new ethers.Contract(marketAddr, MARKET_ABI, signer);
      const tx = action === 'redeem' ? await market.redeem() : await market.refund();
      await tx.wait();
      if (latestAddressRef.current === submittingAddress) {
        setTxMsg({ type: 'success', text: `${action === 'redeem' ? 'Winnings' : 'Refund'} claimed!` });
        try {
          const refreshed = await refreshPortfolio(submittingAddress);
          if (latestAddressRef.current === submittingAddress) {
            setPositions(refreshed);
            clearClaim(marketAddr);
          }
        } catch (err) {
          console.error('Failed to refresh portfolio after claim:', err);
        }
      }
    } catch (err) {
      if (latestAddressRef.current === submittingAddress) {
        setTxMsg({ type: 'error', text: parseContractError(err) });
      }
    } finally {
      if (latestAddressRef.current === submittingAddress) {
        setTxPending(null);
      }
    }
  };

  const totalDeposited = positions.reduce((acc, p) => acc + p.netDepositedWei, 0n);
  const activeDeposits = positions.filter((p) => p.stage === STAGE.Active).reduce((acc, p) => acc + p.netDepositedWei, 0n);
  const estimatedReturnWei = positions.reduce((acc, p) => acc + (getEstimatedReturnWei(p) ?? 0n), 0n);
  const estimatedProfitWei = estimatedReturnWei - totalDeposited;
  const portfolioRoiPct = totalDeposited > 0n ? ((weiToNumber(estimatedReturnWei) - weiToNumber(totalDeposited)) / weiToNumber(totalDeposited)) * 100 : null;

  const totalMarkets = new Set(positions.map((p) => p.market)).size;
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
    const withIndex = positions.map((p, i) => ({ ...p, originalIndex: i }));
    return withIndex
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
        const compareMarketId = (x: number | null, y: number | null): number => {
          if (x !== null && y === null) return -1;
          if (x === null && y !== null) return 1;
          if (x !== null && y !== null) return y - x;
          return a.originalIndex - b.originalIndex;
        };

        if (sortBy === 'highest_deposit') {
          if (a.netDepositedWei === b.netDepositedWei) return compareMarketId(b.marketId, a.marketId);
          return a.netDepositedWei > b.netDepositedWei ? -1 : 1;
        }

        if (sortBy === 'lowest_deposit') {
          if (a.netDepositedWei === b.netDepositedWei) return compareMarketId(b.marketId, a.marketId);
          return a.netDepositedWei < b.netDepositedWei ? -1 : 1;
        }

        if (sortBy === 'newest') return compareMarketId(b.marketId, a.marketId);
        if (sortBy === 'oldest') return compareMarketId(a.marketId, b.marketId);
        if (sortBy === 'title_az') return a.title.localeCompare(b.title);
        if (sortBy === 'title_za') return b.title.localeCompare(a.title);

        const aClaimable = (a.canRedeem && !a.hasRedeemed) || (a.canRefund && !a.hasRefunded && a.netDepositedWei > 0n);
        const bClaimable = (b.canRedeem && !b.hasRedeemed) || (b.canRefund && !b.hasRefunded && b.netDepositedWei > 0n);
        if (aClaimable !== bClaimable) return aClaimable ? -1 : 1;
        if (a.netDepositedWei === b.netDepositedWei) return compareMarketId(b.marketId, a.marketId);
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

  const walletTitle = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : 'Trader';

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
    <div className="portfolio-page mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-5 sm:py-8 animate-fade-in">
      <section className="portfolio-hero">
        <div className="portfolio-hero-copy">
          <p className="portfolio-eyebrow">Account Console</p>
          <h1>{walletTitle}</h1>
          <p>Positions, claimable outcomes, and portfolio performance in one view.</p>
          <div className="portfolio-hero-badges">
            <span>{positions.length} positions</span>
            <span>{claimableWinnings + claimableRefunds} claimable</span>
          </div>
        </div>
        <Link to="/profile" className="portfolio-ghost-button">
          Profile Hub
        </Link>
      </section>

      <section className="portfolio-section-head">
        <div>
          <h2>Positions</h2>
          <p>{positions.length} position{positions.length !== 1 ? 's' : ''} across {totalMarkets} market{totalMarkets !== 1 ? 's' : ''}</p>
        </div>
        <Link to="/" className="portfolio-outline-button">
          Browse Markets
        </Link>
      </section>

      {/* Summary stats */}
      {positions.length > 0 && (
        <div className="portfolio-stats-row">
          <SummaryCard label="Total Deposited" value={formatCompactUSDC(totalDeposited)} suffix="USDC" icon={<UsdcIcon size={16} />} accent="neutral" />
          <SummaryCard label="Est. Return" value={formatCompactUSDC(estimatedReturnWei)} suffix="USDC" icon={<UsdcIcon size={16} />} accent="success" />
          <SummaryCard label="Est. P/L" value={formatSignedCompactUSDC(estimatedProfitWei)} suffix="USDC" icon={<MiniTrendIcon positive={estimatedProfitWei >= 0n} />} accent={estimatedProfitWei >= 0n ? 'success' : 'danger'} />
          <SummaryCard label="ROI" value={portfolioRoiPct === null ? '--' : formatRoi(portfolioRoiPct)} icon={<MiniTrendIcon positive={(portfolioRoiPct ?? 0) >= 0} />} accent={(portfolioRoiPct ?? 0) >= 0 ? 'info' : 'danger'} />
          <SummaryCard label="Active Deposits" value={formatCompactUSDC(activeDeposits)} suffix="USDC" icon={<UsdcIcon size={16} />} accent="primary" />
          <SummaryCard label="Claimable" value={`${claimableWinnings + claimableRefunds}`} icon={<MiniBoltIcon />} accent="neutral" />
        </div>
      )}

      {/* Tab Chips */}
      {positions.length > 0 && (
        <section className="portfolio-filter-panel">
          <div className="portfolio-tabs" role="tablist" aria-label="Portfolio filter tabs">
              {(['all', 'active', 'winnings', 'refunds', 'claimed'] as TabType[]).map((tab) => (
                <button
                  key={tab}
                  role="tab"
                  aria-selected={activeTab === tab}
                  aria-pressed={activeTab === tab}
                  onClick={() => setActiveTab(tab)}
                  className={`portfolio-tab ${activeTab === tab ? 'portfolio-tab-active' : ''}`}
                >
                  {tab === 'winnings' ? 'Est. Winnings' : tab === 'refunds' ? 'Est. Refunds' : tab.charAt(0).toUpperCase() + tab.slice(1)}
                  <span>{tabCounts[tab]}</span>
                </button>
              ))}
          </div>

          <div className="portfolio-filter-bottom">
            <div className="portfolio-segment-group">
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                aria-label="Filter by category"
                className="portfolio-segment-select"
              >
                {categoryCounts.map((category) => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortBy)}
                aria-label="Sort positions"
                className="portfolio-segment-select"
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
        </section>
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
      {loadError ? (
        <EmptyState
          title="Failed to load portfolio"
          description="Could not fetch your portfolio data. Please try refreshing the page."
          action={<button onClick={() => window.location.reload()} className="btn-secondary text-sm">Refresh</button>}
        />
      ) : filteredPositions.length === 0 ? (
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
         <div className="portfolio-position-list">
          {filteredPositions.map((pos, idx) => {
            const estimatedReturn = getEstimatedReturnWei(pos);
            const estimatedProfit = estimatedReturn === null ? null : estimatedReturn - pos.netDepositedWei;
            const roiPct = estimatedReturn === null || pos.netDepositedWei === 0n
              ? null
              : ((weiToNumber(estimatedReturn) - weiToNumber(pos.netDepositedWei)) / weiToNumber(pos.netDepositedWei)) * 100;
            const heldOutcomes = pos.sharesPerOutcome.filter((shares) => shares > 0n).length;
            const bestOutcomeIndex = getLargestShareIndex(pos.sharesPerOutcome);
            const bestOutcomeLabel = bestOutcomeIndex === null ? 'None' : (pos.outcomeLabels[bestOutcomeIndex] ?? `Outcome ${bestOutcomeIndex + 1}`);
            const statusText = getPositionStatusText(pos);
            const shownOutcomeIndexes = pos.sharesPerOutcome
              .map((shares, i) => ({ shares, i }))
              .filter((item) => item.shares > 0n)
              .slice(0, 3);
            const hiddenOutcomeCount = Math.max(0, heldOutcomes - shownOutcomeIndexes.length);

            return (
            <article key={pos.market} className="portfolio-position-card animate-fade-in-up" style={{ animationDelay: `${idx * 50}ms`, animationFillMode: 'both' }}>
              <div className="portfolio-position-header">
                <div className="portfolio-position-title-block">
                  {pos.marketId !== null ? (
                    <Link
                      to={`/market/${makeMarketSlug(pos.marketId, pos.title)}`}
                      className="portfolio-position-title"
                    >
                      {pos.title}
                    </Link>
                  ) : (
                    <span className="portfolio-position-title" aria-disabled="true">
                      {pos.title}
                    </span>
                  )}
                  <div className="portfolio-position-badges">
                    <span className={`portfolio-stage-pill ${getStageTone(pos.stage)}`}>{STAGE_LABELS[pos.stage]}</span>
                    <span className="portfolio-category-pill">{pos.category || 'Other'}</span>
                    {(pos.canRedeem && !pos.hasRedeemed) && (
                      <span className="portfolio-claim-pill">Claim Winnings</span>
                    )}
                    {(pos.canRefund && !pos.hasRefunded && pos.netDepositedWei > 0n) && (
                      <span className="portfolio-claim-pill">Claim Refund</span>
                    )}
                  </div>
                </div>
                <div className="portfolio-deposit">
                  <span>Deposited</span>
                  <strong><UsdcIcon size={13} />{formatUSDC(pos.netDepositedWei)}</strong>
                </div>
              </div>

              <div className="portfolio-position-metrics">
                <PositionMetric label="Est. Return" value={estimatedReturn === null ? '--' : `${formatUSDC(estimatedReturn)} USDC`} tone={estimatedProfit === null ? 'neutral' : estimatedProfit >= 0n ? 'positive' : 'negative'} />
                <PositionMetric label="ROI" value={roiPct === null ? 'Pending' : formatRoi(roiPct)} tone={roiPct === null ? 'neutral' : roiPct >= 0 ? 'positive' : 'negative'} />
                <PositionMetric label="Best Outcome" value={bestOutcomeLabel} tone="neutral" />
                <PositionMetric
                  label="Status"
                  value={statusText}
                  tone={pos.canRedeem || pos.canRefund ? 'positive' : pos.hasRedeemed || pos.hasRefunded ? 'neutral' : 'info'}
                  dot={getStatusDotTone(pos)}
                />
              </div>

              <div className="portfolio-outcome-row">
                {shownOutcomeIndexes.map(({ shares, i }) => {
                  const color = getOutcomeColor(i);
                  return (
                    <span key={i} className="portfolio-outcome-pill">
                      <span className={`portfolio-outcome-dot ${color.bg}`} />
                      <strong>{pos.outcomeLabels[i]}</strong>
                      <em>{formatWad(shares)}</em>
                    </span>
                  );
                })}
                {hiddenOutcomeCount > 0 && (
                  <span className="portfolio-outcome-more">+{hiddenOutcomeCount} more</span>
                )}
              </div>

              <div className="portfolio-position-footer">
                <div className="portfolio-position-actions">
                {pos.canRedeem && (
                  <button
                    onClick={() => handleAction(pos.market, 'redeem')}
                    disabled={txPending === pos.market}
                    className="portfolio-action-button portfolio-action-success"
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
                    className="portfolio-action-button portfolio-action-primary"
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
                  <span className="portfolio-confirmation">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    Winnings claimed
                  </span>
                )}
                {pos.hasRefunded && (
                  <span className="portfolio-confirmation">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    Refund claimed
                  </span>
                )}
                </div>

                {pos.marketId !== null ? (
                  <Link
                    to={`/market/${makeMarketSlug(pos.marketId, pos.title)}`}
                    className="portfolio-view-link"
                  >
                    View
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </Link>
                ) : (
                  <span className="portfolio-view-link opacity-40" aria-disabled="true" tabIndex={-1}>
                    View
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </span>
                )}
              </div>
            </article>
            );
          })}
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
  return (
    <div className={`portfolio-stat-card portfolio-stat-${accent}`}>
      <div className="portfolio-stat-icon">
          {icon}
      </div>
      <p className="portfolio-stat-value">
        {value}
        {suffix ? <span>{suffix}</span> : null}
      </p>
      <span className="portfolio-stat-label">{label}</span>
    </div>
  );
}

function PositionMetric({
  label,
  value,
  tone,
  dot,
}: {
  label: string;
  value: string;
  tone: 'neutral' | 'positive' | 'negative' | 'info';
  dot?: 'green' | 'gray' | 'red';
}) {
  return (
    <div className={`portfolio-position-metric portfolio-position-metric-${tone}`}>
      <p>{label}</p>
      <strong>
        {dot ? <span className={`portfolio-status-dot portfolio-status-dot-${dot}`} /> : null}
        {value}
      </strong>
    </div>
  );
}

function getStageTone(stage: number): string {
  if (stage === STAGE.Active) return 'stage-green';
  if (stage === STAGE.Resolved) return 'stage-gray';
  if (stage === STAGE.Cancelled || stage === STAGE.Expired) return 'stage-red';
  return 'stage-blue';
}

function getStatusDotTone(pos: Position): 'green' | 'gray' | 'red' {
  if (pos.stage === STAGE.Active || pos.canRedeem || pos.canRefund) return 'green';
  if (pos.stage === STAGE.Cancelled || pos.stage === STAGE.Expired) return 'red';
  return 'gray';
}

function getEstimatedReturnWei(pos: Position): bigint | null {
  if (pos.stage === STAGE.Resolved && pos.winningOutcome !== null) {
    const userWinShares = pos.sharesPerOutcome[pos.winningOutcome] ?? 0n;
    const totalWinShares = pos.totalSharesWad[pos.winningOutcome] ?? 0n;
    if (userWinShares <= 0n || totalWinShares <= 0n || pos.resolvedPoolWei <= 0n) return 0n;
    return (userWinShares * pos.resolvedPoolWei) / totalWinShares;
  }

  if ((pos.stage === STAGE.Cancelled || pos.stage === STAGE.Expired) && pos.netDepositedWei > 0n) {
    if (pos.totalNetDepositedWei <= 0n || pos.contractBalanceWei <= 0n) return pos.netDepositedWei;
    return (pos.netDepositedWei * pos.contractBalanceWei) / pos.totalNetDepositedWei;
  }

  return null;
}

function getLargestShareIndex(shares: bigint[]): number | null {
  let bestIndex: number | null = null;
  let bestShares = 0n;
  shares.forEach((share, index) => {
    if (share > bestShares) {
      bestShares = share;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function getPositionStatusText(pos: Position): string {
  if (pos.canRedeem && !pos.hasRedeemed) return 'Ready to claim';
  if (pos.canRefund && !pos.hasRefunded) return 'Refund ready';
  if (pos.hasRedeemed) return 'Winnings claimed';
  if (pos.hasRefunded) return 'Refund claimed';
  if (pos.stage === STAGE.Active) return 'Open';
  if (pos.stage === STAGE.Suspended) return 'Suspended';
  if (pos.stage === STAGE.Resolved) return 'Resolved';
  return 'Closed';
}

function weiToNumber(value: bigint): number {
  return Number(ethers.formatEther(value));
}

function formatRoi(value: number): string {
  if (!Number.isFinite(value)) return '--';
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}

function formatSignedCompactUSDC(value: bigint): string {
  if (value === 0n) return '0';
  const sign = value > 0n ? '+' : '-';
  const abs = value > 0n ? value : -value;
  return `${sign}${formatCompactUSDC(abs)}`;
}

function MiniTrendIcon({ positive }: { positive: boolean }) {
  return (
    <svg className={`w-3.5 h-3.5 ${positive ? 'text-emerald-300' : 'text-red-300'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d={positive ? 'M4 16l6-6 4 4 6-8M14 6h6v6' : 'M4 8l6 6 4-4 6 8M14 18h6v-6'} />
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
