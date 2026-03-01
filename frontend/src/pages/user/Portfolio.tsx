import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ethers } from 'ethers';
import { useWallet } from '../../context/WalletContext';
import { FACTORY_ADDRESS, STAGE_LABELS, STAGE_COLORS } from '../../config/network';
import { FACTORY_ABI, MARKET_ABI } from '../../config/abis';
import { PageLoader } from '../../components/LoadingSpinner';
import EmptyState from '../../components/EmptyState';
import { formatUSDC, formatWad, parseContractError, makeMarketSlug } from '../../utils/format';
import { getOutcomeColor } from '../../components/ProbabilityBar';

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

export default function Portfolio() {
  const { address, readProvider, signer, isConnected } = useWallet();
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [txPending, setTxPending] = useState<string | null>(null);
  const [txMsg, setTxMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!address) return;
    const fetch = async () => {
      try {
        setLoading(true);
        const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, readProvider);
        const [portfolio, totalMarkets] = await Promise.all([
          factory.getUserPortfolio(address),
          factory.totalMarkets(),
        ]);

        const total = Number(totalMarkets);
        let summaries: Record<string, unknown>[] = [];
        if (total > 0) {
          summaries = await factory.getMarketSummaries(0, total);
        }
        const addrToId = new Map<string, number>();
        for (const s of summaries) {
          addrToId.set((s.market as string).toLowerCase(), Number(s.marketId));
        }

        setPositions(portfolio.map((p: Record<string, unknown>) => ({
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
        })));
      } catch (err) {
        console.error('Failed to fetch portfolio:', err);
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, [address, readProvider]);

  const handleAction = async (marketAddr: string, action: 'redeem' | 'refund') => {
    if (!signer) return;
    setTxPending(marketAddr);
    setTxMsg(null);
    try {
      const market = new ethers.Contract(marketAddr, MARKET_ABI, signer);
      const tx = action === 'redeem' ? await market.redeem() : await market.refund();
      await tx.wait();
      setTxMsg({ type: 'success', text: `${action === 'redeem' ? 'Winnings' : 'Refund'} claimed!` });
      // Refresh
      const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, readProvider);
      const [portfolio, totalMarkets2] = await Promise.all([
        factory.getUserPortfolio(address!),
        factory.totalMarkets(),
      ]);
      const total2 = Number(totalMarkets2);
      let sums2: Record<string, unknown>[] = [];
      if (total2 > 0) {
        sums2 = await factory.getMarketSummaries(0, total2);
      }
      const addrToId2 = new Map<string, number>();
      for (const s of sums2) {
        addrToId2.set((s.market as string).toLowerCase(), Number(s.marketId));
      }
      setPositions(portfolio.map((p: Record<string, unknown>) => ({
        market: p.market as string,
        marketId: addrToId2.get((p.market as string).toLowerCase()) ?? 0,
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
      })));
    } catch (err) {
      setTxMsg({ type: 'error', text: parseContractError(err) });
    } finally {
      setTxPending(null);
    }
  };

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

  // Compute summary stats
  const totalDeposited = positions.reduce((acc, p) => acc + p.netDepositedWei, 0n);
  const activePositions = positions.filter(p => p.stage === 0).length;
  const claimable = positions.filter(p => p.canRedeem || p.canRefund).length;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white">Portfolio</h1>
          <p className="text-xs text-dark-500 mt-0.5">{positions.length} position{positions.length !== 1 ? 's' : ''}</p>
        </div>
        <Link to="/" className="btn-secondary text-xs px-3 py-1.5">
          Browse Markets
        </Link>
      </div>

      {/* Summary stats */}
      {positions.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="card p-3.5">
            <span className="text-2xs text-dark-500 font-medium uppercase tracking-wider">Total Deposited</span>
            <p className="text-base sm:text-lg font-bold text-white mt-0.5 tabular-nums">{formatUSDC(totalDeposited)} <span className="text-2xs text-dark-500">USDC</span></p>
          </div>
          <div className="card p-3.5">
            <span className="text-2xs text-dark-500 font-medium uppercase tracking-wider">Active</span>
            <p className="text-base sm:text-lg font-bold text-white mt-0.5">{activePositions}</p>
          </div>
          <div className="card p-3.5">
            <span className="text-2xs text-dark-500 font-medium uppercase tracking-wider">Claimable</span>
            <p className={`text-base sm:text-lg font-bold mt-0.5 ${claimable > 0 ? 'text-emerald-400' : 'text-white'}`}>{claimable}</p>
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
      {positions.length === 0 ? (
        <EmptyState
          title="No positions yet"
          description="You haven't traded in any prediction markets yet. Browse markets to get started."
          action={<Link to="/" className="btn-primary text-sm">Browse Markets</Link>}
        />
      ) : (
        <div className="space-y-3">
          {positions.map((pos, idx) => (
            <div key={pos.market} className="card p-4 sm:p-5 animate-fade-in-up" style={{ animationDelay: `${idx * 50}ms`, animationFillMode: 'both' }}>
              {/* Title + Badge */}
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/market/${makeMarketSlug(pos.marketId, pos.title)}`}
                    className="font-semibold text-sm text-white hover:text-primary-400 transition-colors line-clamp-1"
                  >
                    {pos.title}
                  </Link>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className={`badge text-2xs ${STAGE_COLORS[pos.stage]}`}>{STAGE_LABELS[pos.stage]}</span>
                    <span className="text-2xs text-dark-500">{pos.category}</span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-2xs text-dark-500 font-medium">Deposited</p>
                  <p className="text-sm font-bold text-white tabular-nums">{formatUSDC(pos.netDepositedWei)}</p>
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
              <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-white/[0.04]">
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
