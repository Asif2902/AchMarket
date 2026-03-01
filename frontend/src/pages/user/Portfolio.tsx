import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ethers } from 'ethers';
import { useWallet } from '../../context/WalletContext';
import { FACTORY_ADDRESS, STAGE_LABELS, STAGE_COLORS } from '../../config/network';
import { FACTORY_ABI, MARKET_ABI } from '../../config/abis';
import { PageLoader } from '../../components/LoadingSpinner';
import EmptyState from '../../components/EmptyState';
import { formatUSDC, formatWad, parseContractError } from '../../utils/format';
import { getOutcomeColor } from '../../components/ProbabilityBar';

interface Position {
  market: string;
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
        const portfolio = await factory.getUserPortfolio(address);

        setPositions(portfolio.map((p: Record<string, unknown>) => ({
          market: p.market as string,
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
      const portfolio = await factory.getUserPortfolio(address!);
      setPositions(portfolio.map((p: Record<string, unknown>) => ({
        market: p.market as string,
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
      <div className="max-w-4xl mx-auto px-4 py-16">
        <EmptyState title="Connect Wallet" description="Connect your wallet to view your portfolio." />
      </div>
    );
  }

  if (loading) return <PageLoader />;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <h1 className="text-2xl font-bold text-white">Your Portfolio</h1>

      {txMsg && (
        <div className={`p-3 rounded-xl text-sm ${
          txMsg.type === 'success' ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'
        }`}>
          {txMsg.text}
        </div>
      )}

      {positions.length === 0 ? (
        <EmptyState
          title="No positions yet"
          description="You haven't traded in any prediction markets yet. Browse markets to get started."
          action={<Link to="/" className="btn-primary text-sm">Browse Markets</Link>}
        />
      ) : (
        <div className="space-y-4">
          {positions.map((pos) => (
            <div key={pos.market} className="card p-5 animate-fade-in">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <Link to={`/market/${pos.market}`} className="font-semibold text-white hover:text-primary-400 transition-colors">
                    {pos.title}
                  </Link>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`badge text-xs ${STAGE_COLORS[pos.stage]}`}>{STAGE_LABELS[pos.stage]}</span>
                    <span className="text-xs text-dark-400">{pos.category}</span>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs text-dark-400">Net Deposited</p>
                  <p className="font-semibold text-white">{formatUSDC(pos.netDepositedWei)} USDC</p>
                </div>
              </div>

              {/* Shares */}
              <div className="flex flex-wrap gap-2 mb-3">
                {pos.outcomeLabels.map((label, i) => {
                  const shares = pos.sharesPerOutcome[i];
                  if (shares === 0n) return null;
                  const color = getOutcomeColor(i);
                  return (
                    <span key={i} className={`px-2.5 py-1 rounded-lg text-xs font-medium ${color.light} ${color.text}`}>
                      {label}: {formatWad(shares)}
                    </span>
                  );
                })}
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                {pos.canRedeem && (
                  <button
                    onClick={() => handleAction(pos.market, 'redeem')}
                    disabled={txPending === pos.market}
                    className="btn-success text-xs"
                  >
                    {txPending === pos.market ? 'Claiming...' : 'Claim Winnings'}
                  </button>
                )}
                {pos.canRefund && (
                  <button
                    onClick={() => handleAction(pos.market, 'refund')}
                    disabled={txPending === pos.market}
                    className="btn-primary text-xs"
                  >
                    {txPending === pos.market ? 'Claiming...' : 'Claim Refund'}
                  </button>
                )}
                {pos.hasRedeemed && (
                  <span className="text-xs text-green-400 flex items-center gap-1">
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    Winnings claimed
                  </span>
                )}
                {pos.hasRefunded && (
                  <span className="text-xs text-blue-400 flex items-center gap-1">
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    Refund claimed
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
