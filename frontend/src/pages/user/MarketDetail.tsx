import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ethers } from 'ethers';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useWallet } from '../../context/WalletContext';
import { FACTORY_ADDRESS, STAGE, STAGE_LABELS, STAGE_COLORS } from '../../config/network';
import { FACTORY_ABI, MARKET_ABI } from '../../config/abis';
import ImageWithFallback from '../../components/ImageWithFallback';
import ProbabilityBar, { getOutcomeColor } from '../../components/ProbabilityBar';
import Countdown from '../../components/Countdown';
import { PageLoader } from '../../components/LoadingSpinner';
import {
  formatUSDC, formatWad, formatProbability, probToPercent, formatDate,
  applyBuySlippage, applySellSlippage, parseContractError, resolveImageUri,
  parseMarketSlug
} from '../../utils/format';

interface MarketDetailData {
  market: string;
  title: string;
  description: string;
  category: string;
  imageUri: string;
  proofUri: string;
  outcomeLabels: string[];
  totalSharesWad: bigint[];
  impliedProbabilitiesWad: bigint[];
  stage: number;
  winningOutcome: number;
  createdAt: number;
  marketDeadline: number;
  bWad: bigint;
  totalVolumeWei: bigint;
  participants: number;
  resolvedPoolWei: bigint;
  resolutionDeadline: number;
}

interface UserInfo {
  shares: bigint[];
  netDeposited: bigint;
  redeemed: boolean;
  refunded: boolean;
  canRedeem: boolean;
  canRefund: boolean;
}

interface ProbHistoryPoint {
  time: number;
  [key: string]: number;
}

export default function MarketDetail() {
  const { slug } = useParams<{ slug: string }>();
  const marketId = slug ? parseMarketSlug(slug) : null;
  const { address: userAddress, signer, readProvider, isConnected, isCorrectNetwork } = useWallet();

  const [marketAddress, setMarketAddress] = useState<string | null>(null);
  const [detail, setDetail] = useState<MarketDetailData | null>(null);
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [probHistory, setProbHistory] = useState<ProbHistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Trade state
  const [tradeTab, setTradeTab] = useState<'buy' | 'sell'>('buy');
  const [selectedOutcome, setSelectedOutcome] = useState(0);
  const [shareAmount, setShareAmount] = useState('');
  const [slippage, setSlippage] = useState(1);
  const [estimatedShares, setEstimatedShares] = useState<number | null>(null);
  const [previewCost, setPreviewCost] = useState<bigint | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [txPending, setTxPending] = useState(false);
  const [txMessage, setTxMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchAll = useCallback(async () => {
    if (marketId === null) return;
    try {
      setLoading(true);
      const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, readProvider);
      const addr = await factory.markets(BigInt(marketId));
      if (!addr || addr === ethers.ZeroAddress) {
        setError('Market not found');
        setLoading(false);
        return;
      }
      setMarketAddress(addr);

      const detailPromise = factory.getMarketDetail(addr);
      const userInfoPromise = userAddress
        ? new ethers.Contract(addr, MARKET_ABI, readProvider).getUserInfo(userAddress)
        : null;

      const [d, uInfo] = await Promise.all([detailPromise, userInfoPromise]);

      const parsed: MarketDetailData = {
        market: d.market, title: d.title, description: d.description,
        category: d.category, imageUri: d.imageUri, proofUri: d.proofUri,
        outcomeLabels: [...d.outcomeLabels], totalSharesWad: [...d.totalSharesWad],
        impliedProbabilitiesWad: [...d.impliedProbabilitiesWad],
        stage: Number(d.stage), winningOutcome: Number(d.winningOutcome),
        createdAt: Number(d.createdAt), marketDeadline: Number(d.marketDeadline),
        bWad: d.bWad, totalVolumeWei: d.totalVolumeWei,
        participants: Number(d.participants), resolvedPoolWei: d.resolvedPoolWei,
        resolutionDeadline: Number(d.resolutionDeadline),
      };
      setDetail(parsed);

      if (uInfo) {
        setUserInfo({
          shares: [...uInfo._shares], netDeposited: uInfo._netDeposited,
          redeemed: uInfo._redeemed, refunded: uInfo._refunded,
          canRedeem: uInfo._canRedeem, canRefund: uInfo._canRefund,
        });
      }
    } catch (err) {
      console.error('Failed to fetch market:', err);
      setError('Failed to load market details');
    } finally {
      setLoading(false);
    }
  }, [marketId, userAddress, readProvider]);

  const refreshData = useCallback(async () => {
    if (!marketAddress) return;
    try {
      const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, readProvider);
      const detailPromise = factory.getMarketDetail(marketAddress);
      const userInfoPromise = userAddress
        ? new ethers.Contract(marketAddress, MARKET_ABI, readProvider).getUserInfo(userAddress)
        : null;

      const [d, uInfo] = await Promise.all([detailPromise, userInfoPromise]);

      setDetail({
        market: d.market, title: d.title, description: d.description,
        category: d.category, imageUri: d.imageUri, proofUri: d.proofUri,
        outcomeLabels: [...d.outcomeLabels], totalSharesWad: [...d.totalSharesWad],
        impliedProbabilitiesWad: [...d.impliedProbabilitiesWad],
        stage: Number(d.stage), winningOutcome: Number(d.winningOutcome),
        createdAt: Number(d.createdAt), marketDeadline: Number(d.marketDeadline),
        bWad: d.bWad, totalVolumeWei: d.totalVolumeWei,
        participants: Number(d.participants), resolvedPoolWei: d.resolvedPoolWei,
        resolutionDeadline: Number(d.resolutionDeadline),
      });

      if (uInfo) {
        setUserInfo({
          shares: [...uInfo._shares], netDeposited: uInfo._netDeposited,
          redeemed: uInfo._redeemed, refunded: uInfo._refunded,
          canRedeem: uInfo._canRedeem, canRefund: uInfo._canRefund,
        });
      }
    } catch (err) {
      console.error('Failed to refresh market data:', err);
    }
  }, [marketAddress, userAddress, readProvider]);

  const fetchProbHistory = useCallback(async (addr: string, detailData: MarketDetailData) => {
    try {
      const market = new ethers.Contract(addr, MARKET_ABI, readProvider);
      const buyFilter = market.filters.SharesBought();
      const sellFilter = market.filters.SharesSold();
      const [buyEvents, sellEvents] = await Promise.all([
        market.queryFilter(buyFilter, 0),
        market.queryFilter(sellFilter, 0),
      ]);

      type TradeEvent = { blockNumber: number; type: string; log: ethers.EventLog };
      const allEvents: TradeEvent[] = [
        ...buyEvents.map(e => ({ blockNumber: e.blockNumber, type: 'buy', log: e as ethers.EventLog })),
        ...sellEvents.map(e => ({ blockNumber: e.blockNumber, type: 'sell', log: e as ethers.EventLog })),
      ].sort((a, b) => a.blockNumber - b.blockNumber);

      if (allEvents.length === 0) return;

      const uniqueBlocks = [...new Set(allEvents.map(e => e.blockNumber))];
      const blockTimestamps = new Map<number, number>();
      const blockResults = await Promise.all(
        uniqueBlocks.map(bn => readProvider.getBlock(bn).catch(() => null))
      );
      uniqueBlocks.forEach((bn, i) => {
        blockTimestamps.set(bn, blockResults[i]?.timestamp ?? detailData.createdAt);
      });

      const outcomeCount = detailData.outcomeLabels.length;
      const bWad = detailData.bWad;
      const shares = new Array(outcomeCount).fill(0n);
      const history: ProbHistoryPoint[] = [];

      const uniformProb = 100 / outcomeCount;
      const initialPoint: ProbHistoryPoint = { time: detailData.createdAt };
      detailData.outcomeLabels.forEach((label) => {
        initialPoint[label] = Number(uniformProb.toFixed(1));
      });
      history.push(initialPoint);

      for (const event of allEvents) {
        const log = event.log;
        if (!log.args) continue;
        const outcomeIdx = Number(log.args[1]);
        const sharesWad = log.args[2] as bigint;
        if (event.type === 'buy') {
          shares[outcomeIdx] = shares[outcomeIdx] + sharesWad;
        } else {
          shares[outcomeIdx] = shares[outcomeIdx] - sharesWad;
        }
        const timestamp = blockTimestamps.get(event.blockNumber) ?? detailData.createdAt;
        const probs = computeProbabilities(shares, bWad);
        const point: ProbHistoryPoint = { time: timestamp };
        detailData.outcomeLabels.forEach((label, i) => {
          point[label] = Number((probs[i] * 100).toFixed(1));
        });
        history.push(point);
      }
      setProbHistory(history);
    } catch (err) {
      console.error('Failed to fetch prob history:', err);
    }
  }, [readProvider]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    if (detail && marketAddress) {
      fetchProbHistory(marketAddress, detail);
    }
  }, [detail?.market]); // eslint-disable-line react-hooks/exhaustive-deps

  // Preview
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (!shareAmount || parseFloat(shareAmount) <= 0) {
        setPreviewCost(null);
        setEstimatedShares(null);
        return;
      }
      if (tradeTab === 'buy') {
        if (!detail) { setEstimatedShares(null); return; }
        setPreviewLoading(true);
        try {
          const budgetUSDC = parseFloat(shareAmount);
          const shares = findSharesForCost(detail.totalSharesWad, detail.bWad, selectedOutcome, budgetUSDC);
          setEstimatedShares(shares);
          setPreviewCost(null);
        } finally {
          setPreviewLoading(false);
        }
      } else {
        if (!marketAddress) { setPreviewCost(null); return; }
        try {
          setPreviewLoading(true);
          const market = new ethers.Contract(marketAddress, MARKET_ABI, readProvider);
          const sharesWad = ethers.parseEther(shareAmount);
          const proceeds = await market.previewSell(selectedOutcome, sharesWad);
          setPreviewCost(proceeds);
          setEstimatedShares(null);
        } catch {
          setPreviewCost(null);
        } finally {
          setPreviewLoading(false);
        }
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [marketAddress, shareAmount, selectedOutcome, tradeTab, readProvider, detail]);

  const handleBuy = async () => {
    if (!signer || !marketAddress || estimatedShares === null || !shareAmount) return;
    setTxPending(true); setTxMessage(null);
    try {
      const market = new ethers.Contract(marketAddress, MARKET_ABI, signer);
      const sharesWad = ethers.parseEther(estimatedShares.toFixed(18));
      const usdcInput = ethers.parseEther(shareAmount);
      const maxCost = applyBuySlippage(usdcInput, slippage);
      const tx = await market.buy(selectedOutcome, sharesWad, maxCost, { value: maxCost });
      setTxMessage({ type: 'success', text: 'Transaction submitted. Waiting for confirmation...' });
      await tx.wait();
      setTxMessage({ type: 'success', text: 'Shares purchased successfully!' });
      setShareAmount(''); setEstimatedShares(null);
      refreshData();
    } catch (err) {
      setTxMessage({ type: 'error', text: parseContractError(err) });
    } finally { setTxPending(false); }
  };

  const handleSell = async () => {
    if (!signer || !marketAddress || !previewCost || !shareAmount) return;
    setTxPending(true); setTxMessage(null);
    try {
      const market = new ethers.Contract(marketAddress, MARKET_ABI, signer);
      const sharesWad = ethers.parseEther(shareAmount);
      const minReceive = applySellSlippage(previewCost, slippage);
      const tx = await market.sell(selectedOutcome, sharesWad, minReceive);
      setTxMessage({ type: 'success', text: 'Transaction submitted. Waiting for confirmation...' });
      await tx.wait();
      setTxMessage({ type: 'success', text: 'Shares sold successfully!' });
      setShareAmount('');
      refreshData();
    } catch (err) {
      setTxMessage({ type: 'error', text: parseContractError(err) });
    } finally { setTxPending(false); }
  };

  const handleRedeem = async () => {
    if (!signer || !marketAddress) return;
    setTxPending(true); setTxMessage(null);
    try {
      const market = new ethers.Contract(marketAddress, MARKET_ABI, signer);
      const tx = await market.redeem();
      setTxMessage({ type: 'success', text: 'Redeem transaction submitted...' });
      await tx.wait();
      setTxMessage({ type: 'success', text: 'Winnings claimed successfully!' });
      refreshData();
    } catch (err) {
      setTxMessage({ type: 'error', text: parseContractError(err) });
    } finally { setTxPending(false); }
  };

  const handleRefund = async () => {
    if (!signer || !marketAddress) return;
    setTxPending(true); setTxMessage(null);
    try {
      const market = new ethers.Contract(marketAddress, MARKET_ABI, signer);
      const tx = await market.refund();
      setTxMessage({ type: 'success', text: 'Refund transaction submitted...' });
      await tx.wait();
      setTxMessage({ type: 'success', text: 'Refund claimed successfully!' });
      refreshData();
    } catch (err) {
      setTxMessage({ type: 'error', text: parseContractError(err) });
    } finally { setTxPending(false); }
  };

  const handleTriggerExpiry = async () => {
    if (!signer || !marketAddress) return;
    setTxPending(true); setTxMessage(null);
    try {
      const market = new ethers.Contract(marketAddress, MARKET_ABI, signer);
      const tx = await market.triggerExpiry();
      setTxMessage({ type: 'success', text: 'Expiry transaction submitted...' });
      await tx.wait();
      setTxMessage({ type: 'success', text: 'Market expired! Refunds are now available.' });
      refreshData();
    } catch (err) {
      setTxMessage({ type: 'error', text: parseContractError(err) });
    } finally { setTxPending(false); }
  };

  if (loading) return <PageLoader />;
  if (error || !detail) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-20 text-center animate-fade-in">
        <div className="w-14 h-14 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-4">
          <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
        </div>
        <p className="text-red-400 font-medium mb-2">{error || 'Market not found'}</p>
        <Link to="/" className="text-sm text-primary-400 hover:text-primary-300 transition-colors">Back to Markets</Link>
      </div>
    );
  }

  const isActive = detail.stage === STAGE.Active;
  const isResolved = detail.stage === STAGE.Resolved;
  const isCancelledOrExpired = detail.stage === STAGE.Cancelled || detail.stage === STAGE.Expired;
  const now = Math.floor(Date.now() / 1000);
  const tradingEnded = now > detail.marketDeadline;
  const inGracePeriod = isActive && tradingEnded && now <= detail.resolutionDeadline;

  let estimatedPayout: bigint | null = null;
  let totalPositionPayout: bigint | null = null;
  let multiplier = 0;
  let avgPrice = 0;
  let profit = 0;
  const hasExistingShares = userInfo?.shares[selectedOutcome] && userInfo.shares[selectedOutcome] > 0n;
  if (estimatedShares !== null && shareAmount && tradeTab === 'buy') {
    const usdcInput = parseFloat(shareAmount);
    const sharesWad = BigInt(Math.round(estimatedShares * 1e18));
    const totalWinShares = detail.totalSharesWad[selectedOutcome] + sharesWad;
    const costWei = ethers.parseEther(usdcInput.toString());
    const poolAfterTrade = detail.totalVolumeWei + costWei;
    if (totalWinShares > 0n) {
      // Payout for THIS trade's new shares only
      estimatedPayout = (sharesWad * poolAfterTrade) / totalWinShares;
      multiplier = Number(estimatedPayout) / Number(costWei);
      avgPrice = estimatedShares > 0 ? usdcInput / estimatedShares : 0;
      profit = Number(estimatedPayout - costWei) / 1e18;
      // Total position payout (existing + new shares) — shown separately if user has existing shares
      if (hasExistingShares) {
        const userWinShares = userInfo!.shares[selectedOutcome] + sharesWad;
        totalPositionPayout = (userWinShares * poolAfterTrade) / totalWinShares;
      }
    }
  }

  return (
    <div className="min-h-screen animate-fade-in">
      {/* Hero Header */}
      <div className="relative">
        <ImageWithFallback src={detail.imageUri} alt={detail.title} className="h-48 sm:h-56 lg:h-64 w-full" />
        <div className="absolute inset-0 bg-gradient-to-t from-dark-950 via-dark-950/40 to-dark-950/20" />

        {/* Back button */}
        <div className="absolute top-4 left-4">
          <Link to="/" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-dark-900/70 backdrop-blur-sm border border-white/[0.1] text-sm text-dark-200 hover:text-white transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Markets
          </Link>
        </div>

        {/* Title overlay */}
        <div className="absolute bottom-0 left-0 right-0 p-4 sm:p-6 lg:p-8">
          <div className="max-w-7xl mx-auto">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span className={`badge ${STAGE_COLORS[detail.stage]} backdrop-blur-sm`}>{STAGE_LABELS[detail.stage]}</span>
              <span className="badge bg-dark-900/70 text-dark-200 border-white/[0.1] backdrop-blur-sm">{detail.category}</span>
            </div>
            <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-white leading-tight max-w-3xl">{detail.title}</h1>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left column */}
          <div className="lg:col-span-2 space-y-5">
            {/* Quick stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <MiniStat label="Volume" value={`${formatUSDC(detail.totalVolumeWei)}`} suffix="USDC" />
              <MiniStat label="Traders" value={detail.participants.toString()} />
              <MiniStat label="Created" value={formatDate(detail.createdAt)} small />
              <MiniStat label={isActive ? 'Ends' : 'Ended'} value={formatDate(detail.marketDeadline)} small />
            </div>

            {/* Countdown (active) */}
            {isActive && !tradingEnded && (
              <div className="card p-4 flex items-center justify-between">
                <span className="text-sm text-dark-400 font-medium">Time Remaining</span>
                <Countdown deadline={detail.marketDeadline} />
              </div>
            )}

            {/* Grace period banner */}
            {inGracePeriod && (
              <div className="card border-amber-500/20 bg-amber-500/5 p-4">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center shrink-0 mt-0.5">
                    <svg className="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-amber-400 mb-1">Awaiting Resolution</p>
                    <p className="text-xs text-dark-400 leading-relaxed">
                      Trading has ended. The admin has until {formatDate(detail.resolutionDeadline)} to resolve.
                      If not resolved, the market will auto-expire and all participants can claim full refunds.
                    </p>
                    <div className="mt-2.5 flex items-center gap-2">
                      <span className="text-2xs text-dark-500 font-medium">Resolution deadline:</span>
                      <Countdown deadline={detail.resolutionDeadline} compact className="text-xs text-amber-400 font-medium" />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Resolution proof */}
            {isResolved && detail.proofUri && (
              <div className="card border-emerald-500/20 bg-emerald-500/5 p-4">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/15 flex items-center justify-center shrink-0 mt-0.5">
                    <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-emerald-400">
                      Resolved: {detail.outcomeLabels[detail.winningOutcome]} wins
                    </p>
                    <a
                      href={resolveImageUri(detail.proofUri)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-emerald-300/70 hover:text-emerald-300 transition-colors mt-1 inline-flex items-center gap-1"
                    >
                      View Resolution Proof
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>
                  </div>
                </div>
              </div>
            )}

            {/* Resolved pool & fee info */}
            {isResolved && detail.resolvedPoolWei > 0n && (
              <div className="card p-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-2xs text-dark-500 font-medium uppercase tracking-wider">Prize Pool (after fee)</span>
                    <p className="text-base font-bold text-white mt-0.5">{formatUSDC(detail.resolvedPoolWei)} USDC</p>
                  </div>
                  <div>
                    <span className="text-2xs text-dark-500 font-medium uppercase tracking-wider">Platform Fee (0.25%)</span>
                    <p className="text-base font-bold text-dark-400 mt-0.5">{formatUSDC((detail.totalVolumeWei * 25n) / 10000n)} USDC</p>
                  </div>
                </div>
              </div>
            )}

            {/* Description */}
            {detail.description && (
              <div className="card p-5">
                <h2 className="text-sm font-semibold text-dark-300 uppercase tracking-wider mb-3">About</h2>
                <p className="text-sm text-dark-300 leading-relaxed whitespace-pre-wrap">{detail.description}</p>
              </div>
            )}

            {/* Outcome Probabilities */}
            <div className="card p-5">
              <h2 className="text-sm font-semibold text-dark-300 uppercase tracking-wider mb-4">Outcome Probabilities</h2>
              <ProbabilityBar
                labels={detail.outcomeLabels}
                probabilities={detail.impliedProbabilitiesWad}
                winningOutcome={detail.winningOutcome}
                isResolved={isResolved}
              />
              <div className="grid grid-cols-2 gap-3 mt-5">
                {detail.outcomeLabels.map((label, i) => {
                  const color = getOutcomeColor(i);
                  const pct = probToPercent(detail.impliedProbabilitiesWad[i]);
                  const isWinner = isResolved && detail.winningOutcome === i;
                  return (
                    <div key={i} className={`p-3 rounded-xl text-center ${isWinner ? 'bg-emerald-500/10 border border-emerald-500/20' : color.light}`}>
                      <p className="text-2xs text-dark-400 font-medium mb-1">{label}</p>
                      <p className={`text-xl sm:text-2xl font-bold tabular-nums ${isWinner ? 'text-emerald-400' : color.text}`}>
                        {pct.toFixed(1)}%
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Probability history chart */}
            {probHistory.length > 1 && (
              <div className="card p-5">
                <h2 className="text-sm font-semibold text-dark-300 uppercase tracking-wider mb-4">Probability History</h2>
                <div className="h-64 sm:h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={probHistory}>
                      <XAxis
                        dataKey="time"
                        tickFormatter={(t) => new Date(t * 1000).toLocaleDateString()}
                        stroke="#334155"
                        tick={{ fontSize: 10, fill: '#64748b' }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        domain={[0, 100]}
                        tickFormatter={(v) => `${v}%`}
                        stroke="#334155"
                        tick={{ fontSize: 10, fill: '#64748b' }}
                        axisLine={false}
                        tickLine={false}
                        width={35}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'rgba(15, 23, 42, 0.95)',
                          border: '1px solid rgba(255,255,255,0.06)',
                          borderRadius: '12px',
                          backdropFilter: 'blur(12px)',
                          padding: '8px 12px',
                          fontSize: '12px',
                        }}
                        labelFormatter={(t) => formatDate(t as number)}
                        formatter={(value: number) => [`${value.toFixed(1)}%`]}
                      />
                      <Legend wrapperStyle={{ fontSize: '11px' }} />
                      {detail.outcomeLabels.map((label, i) => {
                        const colors = ['#22c55e', '#ef4444', '#3b82f6', '#a855f7', '#f97316', '#06b6d4'];
                        return (
                          <Line
                            key={label}
                            type="monotone"
                            dataKey={label}
                            stroke={colors[i % colors.length]}
                            strokeWidth={2}
                            dot={false}
                            activeDot={{ r: 4, strokeWidth: 0 }}
                          />
                        );
                      })}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </div>

          {/* Right column — sticky on desktop */}
          <div className="space-y-5 lg:sticky lg:top-20 lg:self-start">
            {/* Trade panel */}
            {isActive && !tradingEnded && isConnected && isCorrectNetwork && (
              <div className="card p-5">
                <h3 className="text-sm font-semibold text-dark-300 uppercase tracking-wider mb-4">Trade</h3>

                {/* Buy/Sell tabs */}
                <div className="flex rounded-xl bg-dark-900/60 p-0.5 mb-5 border border-white/[0.04]">
                  <button
                    onClick={() => { setTradeTab('buy'); setShareAmount(''); setPreviewCost(null); setEstimatedShares(null); }}
                    className={`flex-1 py-2 rounded-[10px] text-sm font-semibold transition-all ${
                      tradeTab === 'buy' ? 'bg-emerald-500/15 text-emerald-400 shadow-sm' : 'text-dark-500 hover:text-dark-300'
                    }`}
                  >
                    Buy
                  </button>
                  <button
                    onClick={() => { setTradeTab('sell'); setShareAmount(''); setPreviewCost(null); setEstimatedShares(null); }}
                    className={`flex-1 py-2 rounded-[10px] text-sm font-semibold transition-all ${
                      tradeTab === 'sell' ? 'bg-red-500/15 text-red-400 shadow-sm' : 'text-dark-500 hover:text-dark-300'
                    }`}
                  >
                    Sell
                  </button>
                </div>

                {/* Outcome selector */}
                <div className="space-y-1.5 mb-4">
                  {detail.outcomeLabels.map((label, i) => {
                    const color = getOutcomeColor(i);
                    const userShares = userInfo?.shares[i] || 0n;
                    const pct = probToPercent(detail.impliedProbabilitiesWad[i]);
                    return (
                      <button
                        key={i}
                        onClick={() => setSelectedOutcome(i)}
                        className={`w-full p-3 rounded-xl text-left text-sm transition-all border ${
                          selectedOutcome === i
                            ? 'border-primary-500/30 bg-primary-500/8'
                            : 'border-white/[0.04] bg-dark-900/30 hover:border-white/[0.08]'
                        }`}
                      >
                        <div className="flex justify-between items-center">
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${color.bg} ${selectedOutcome === i ? 'ring-2 ring-offset-1 ring-offset-dark-900' : ''}`} style={selectedOutcome === i ? { boxShadow: `0 0 0 2px var(--tw-ring-offset-color), 0 0 0 4px currentColor`, color: 'rgba(99,102,241,0.3)' } : {}} />
                            <span className="font-medium text-white text-sm">{label}</span>
                          </div>
                          <span className={`font-mono text-xs font-bold tabular-nums ${color.text}`}>{pct.toFixed(1)}%</span>
                        </div>
                        {tradeTab === 'sell' && userShares > 0n && (
                          <p className="text-2xs text-dark-500 mt-1 ml-4">Your shares: {formatWad(userShares)}</p>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Amount input */}
                <label className="text-2xs font-semibold text-dark-500 uppercase tracking-wider mb-1.5 block">
                  {tradeTab === 'buy' ? 'Amount (USDC)' : 'Shares to Sell'}
                </label>
                <div className="relative mb-3">
                  <input
                    type="number"
                    value={shareAmount}
                    onChange={(e) => setShareAmount(e.target.value)}
                    placeholder={tradeTab === 'buy' ? '0.00' : '0'}
                    min="0"
                    step={tradeTab === 'buy' ? '0.01' : '0.1'}
                    className="input-field text-sm pr-16"
                  />
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                    {tradeTab === 'sell' && userInfo && (userInfo.shares[selectedOutcome] || 0n) > 0n && (
                      <button
                        onClick={() => {
                          const maxShares = Number(userInfo.shares[selectedOutcome]) / 1e18;
                          setShareAmount(maxShares.toString());
                        }}
                        className="px-2 py-0.5 rounded text-2xs font-semibold bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-all"
                      >
                        Max
                      </button>
                    )}
                    <span className="text-2xs text-dark-500 font-medium">
                      {tradeTab === 'buy' ? 'USDC' : 'shares'}
                    </span>
                  </div>
                </div>

                {/* Slippage */}
                <div className="flex items-center justify-between mb-4">
                  <label className="text-2xs text-dark-500 font-medium">Slippage</label>
                  <div className="flex items-center gap-0.5">
                    {[0.5, 1, 2, 5].map(s => (
                      <button
                        key={s}
                        onClick={() => setSlippage(s)}
                        className={`px-2 py-1 rounded-md text-2xs font-semibold transition-all ${
                          slippage === s
                            ? 'bg-primary-600/20 text-primary-400'
                            : 'text-dark-500 hover:text-dark-300 hover:bg-white/[0.04]'
                        }`}
                      >
                        {s}%
                      </button>
                    ))}
                  </div>
                </div>

                {/* Buy preview */}
                {tradeTab === 'buy' && estimatedShares !== null && shareAmount && (
                  <div className="p-3 rounded-xl bg-dark-900/40 border border-white/[0.04] mb-4 space-y-2">
                    <PreviewRow label="Est. Shares" value={previewLoading ? '...' : `${estimatedShares.toFixed(4)}`} />
                    <PreviewRow label="Avg Price" value={previewLoading ? '...' : `${avgPrice.toFixed(4)} USDC`} />
                    {estimatedPayout !== null && (
                      <>
                        <PreviewRow label="Potential Payout" value={`${formatUSDC(estimatedPayout)} USDC`} accent="green" />
                        <PreviewRow label="Profit" value={`${profit >= 0 ? '+' : ''}${profit.toFixed(4)} USDC`} accent="green" />
                        <PreviewRow label="Multiplier" value={`${multiplier.toFixed(2)}x`} accent="green" />
                      </>
                    )}
                    {totalPositionPayout !== null && (
                      <>
                        <div className="divider" />
                        <PreviewRow label="Total Position Payout" value={`${formatUSDC(totalPositionPayout)} USDC`} />
                      </>
                    )}
                    <div className="divider" />
                    <PreviewRow
                      label={`Max Cost (${slippage}% slip.)`}
                      value={`${formatUSDC(applyBuySlippage(ethers.parseEther(shareAmount), slippage))} USDC`}
                      muted
                    />
                  </div>
                )}

                {/* Sell preview */}
                {tradeTab === 'sell' && previewCost !== null && shareAmount && (
                  <div className="p-3 rounded-xl bg-dark-900/40 border border-white/[0.04] mb-4 space-y-2">
                    <PreviewRow label="Est. Proceeds" value={previewLoading ? '...' : `${formatUSDC(previewCost)} USDC`} />
                    <div className="divider" />
                    <PreviewRow
                      label={`Min Receive (${slippage}% slip.)`}
                      value={`${formatUSDC(applySellSlippage(previewCost, slippage))} USDC`}
                      muted
                    />
                  </div>
                )}

                {/* Submit */}
                <button
                  onClick={tradeTab === 'buy' ? handleBuy : handleSell}
                  disabled={txPending || !shareAmount || parseFloat(shareAmount) <= 0 || (tradeTab === 'buy' ? estimatedShares === null : previewCost === null)}
                  className={`w-full py-3 rounded-xl font-semibold text-sm transition-all active:scale-[0.97] ${
                    tradeTab === 'buy'
                      ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-glow-yes disabled:bg-emerald-600/20 disabled:text-emerald-400/40 disabled:shadow-none'
                      : 'bg-red-600 hover:bg-red-500 text-white shadow-glow-no disabled:bg-red-600/20 disabled:text-red-400/40 disabled:shadow-none'
                  }`}
                >
                  {txPending ? (
                    <span className="flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Processing...
                    </span>
                  ) : tradeTab === 'buy' ? (
                    `Buy ${detail.outcomeLabels[selectedOutcome]} for ${shareAmount || '0'} USDC`
                  ) : (
                    `Sell ${detail.outcomeLabels[selectedOutcome]} Shares`
                  )}
                </button>

                {txMessage && (
                  <div className={`mt-3 p-3 rounded-xl text-xs ${
                    txMessage.type === 'success'
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      : 'bg-red-500/10 text-red-400 border border-red-500/20'
                  }`}>
                    {txMessage.text}
                  </div>
                )}
              </div>
            )}

            {/* Connect wallet prompt */}
            {isActive && !tradingEnded && !isConnected && (
              <div className="card p-6 text-center">
                <div className="w-10 h-10 rounded-xl bg-primary-500/10 flex items-center justify-center mx-auto mb-3">
                  <svg className="w-5 h-5 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                  </svg>
                </div>
                <p className="text-sm text-dark-400 font-medium">Connect your wallet to trade</p>
              </div>
            )}

            {/* Wrong network prompt */}
            {isActive && isConnected && !isCorrectNetwork && (
              <div className="card p-6 text-center">
                <p className="text-sm text-amber-400 font-medium">Switch to ARC Testnet to trade</p>
              </div>
            )}

            {/* Trigger Expiry */}
            {isActive && tradingEnded && !inGracePeriod && isConnected && isCorrectNetwork && (
              <div className="card p-5 text-center space-y-3">
                <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center mx-auto">
                  <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                  </svg>
                </div>
                <p className="text-sm text-red-400 font-semibold">Grace period expired</p>
                <p className="text-xs text-dark-400 leading-relaxed">
                  This market was not resolved within the 3-day grace period. Trigger expiry to enable refunds.
                </p>
                <button onClick={handleTriggerExpiry} disabled={txPending} className="w-full btn-primary py-3 text-sm font-semibold">
                  {txPending ? 'Processing...' : 'Trigger Expiry'}
                </button>
                {txMessage && (
                  <div className={`p-3 rounded-xl text-xs ${txMessage.type === 'success' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
                    {txMessage.text}
                  </div>
                )}
              </div>
            )}

            {/* User Position */}
            {userInfo && isConnected && (
              <div className="card p-5">
                <h3 className="text-sm font-semibold text-dark-300 uppercase tracking-wider mb-4">Your Position</h3>

                <div className="space-y-2 mb-4">
                  {detail.outcomeLabels.map((label, i) => {
                    const shares = userInfo.shares[i];
                    if (shares === 0n) return null;
                    const color = getOutcomeColor(i);
                    const isWinner = isResolved && detail.winningOutcome === i;
                    return (
                      <div key={i} className={`p-3 rounded-xl ${isWinner ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-dark-900/30 border border-white/[0.04]'}`}>
                        <div className="flex justify-between items-center">
                          <span className={`text-sm font-medium ${isWinner ? 'text-emerald-400' : 'text-dark-200'}`}>
                            {isWinner && (
                              <svg className="w-3.5 h-3.5 inline mr-1 -mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                            )}
                            {label}
                          </span>
                          <span className={`font-mono text-xs font-bold ${color.text}`}>{formatWad(shares)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="p-3 rounded-xl bg-dark-900/30 border border-white/[0.04] mb-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-dark-500 font-medium">Net Deposited</span>
                    <span className="font-bold text-white tabular-nums">{formatUSDC(userInfo.netDeposited)} USDC</span>
                  </div>
                </div>

                {userInfo.canRedeem && (
                  <button onClick={handleRedeem} disabled={txPending} className="w-full btn-yes py-3 text-sm pulse-glow">
                    {txPending ? 'Processing...' : 'Claim Winnings'}
                  </button>
                )}

                {userInfo.canRefund && (
                  <button onClick={handleRefund} disabled={txPending} className="w-full btn-primary py-3 text-sm">
                    {txPending ? 'Processing...' : 'Claim Refund'}
                  </button>
                )}

                {userInfo.redeemed && (
                  <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-center">
                    <p className="text-xs text-emerald-400 font-medium">Winnings already claimed</p>
                  </div>
                )}
                {userInfo.refunded && (
                  <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-center">
                    <p className="text-xs text-blue-400 font-medium">Refund already claimed</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Sub-components ─── */

function MiniStat({ label, value, suffix, small }: { label: string; value: string; suffix?: string; small?: boolean }) {
  return (
    <div className="card p-3">
      <span className="text-2xs text-dark-500 font-medium uppercase tracking-wider">{label}</span>
      <div className="flex items-baseline gap-1 mt-0.5">
        <span className={`font-bold text-white tabular-nums ${small ? 'text-xs' : 'text-sm'}`}>{value}</span>
        {suffix && <span className="text-2xs text-dark-500">{suffix}</span>}
      </div>
    </div>
  );
}

function PreviewRow({ label, value, accent, muted }: { label: string; value: string; accent?: string; muted?: boolean }) {
  return (
    <div className="flex justify-between items-center text-xs">
      <span className="text-dark-500">{label}</span>
      <span className={`font-semibold tabular-nums ${
        accent === 'green' ? 'text-emerald-400' :
        muted ? 'text-dark-400 font-mono text-2xs' :
        'text-white'
      }`}>
        {value}
      </span>
    </div>
  );
}

/* ─── LMSR Math ─── */

function computeProbabilities(sharesWad: bigint[], bWad: bigint): number[] {
  const b = Number(bWad) / 1e18;
  if (b === 0) return sharesWad.map(() => 1 / sharesWad.length);
  const exps = sharesWad.map(q => {
    const qNum = Number(q) / 1e18;
    return Math.exp(qNum / b);
  });
  const sumExp = exps.reduce((a, b) => a + b, 0);
  if (sumExp === 0) return sharesWad.map(() => 1 / sharesWad.length);
  return exps.map(e => e / sumExp);
}

function computeLMSRCostValue(sharesWad: bigint[], bWad: bigint): number {
  const b = Number(bWad) / 1e18;
  if (b === 0) return 0;
  const qNums = sharesWad.map(q => Number(q) / 1e18);
  const scaled = qNums.map(q => q / b);
  const maxScaled = Math.max(...scaled);
  const sumExp = scaled.reduce((acc, s) => acc + Math.exp(s - maxScaled), 0);
  return b * (maxScaled + Math.log(sumExp));
}

function computeLMSRTradeCost(
  sharesWad: bigint[], bWad: bigint, outcomeIdx: number, deltaShares: number
): number {
  const costBefore = computeLMSRCostValue(sharesWad, bWad);
  const deltaWad = BigInt(Math.round(deltaShares * 1e18));
  const sharesAfter = sharesWad.map((q, i) => i === outcomeIdx ? q + deltaWad : q);
  const costAfter = computeLMSRCostValue(sharesAfter, bWad);
  return costAfter - costBefore;
}

function findSharesForCost(
  sharesWad: bigint[], bWad: bigint, outcomeIdx: number,
  budgetUSDC: number, safetyMarginPct: number = 0.5
): number | null {
  if (budgetUSDC <= 0) return null;
  let lo = 0;
  let hi = budgetUSDC * 100;
  const epsilon = 1e-6;
  const minCost = computeLMSRTradeCost(sharesWad, bWad, outcomeIdx, epsilon);
  if (minCost > budgetUSDC) return null;
  for (let iter = 0; iter < 100; iter++) {
    const mid = (lo + hi) / 2;
    const cost = computeLMSRTradeCost(sharesWad, bWad, outcomeIdx, mid);
    if (Math.abs(cost - budgetUSDC) < epsilon * budgetUSDC) { lo = mid; break; }
    if (cost < budgetUSDC) { lo = mid; } else { hi = mid; }
  }
  const result = lo * (1 - safetyMarginPct / 100);
  return result > epsilon ? result : null;
}
