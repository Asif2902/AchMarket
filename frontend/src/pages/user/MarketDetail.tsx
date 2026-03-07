import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ethers } from 'ethers';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { useWallet } from '../../context/WalletContext';
import { FACTORY_ADDRESS, LENS_ADDRESS, STAGE, STAGE_LABELS, STAGE_COLORS } from '../../config/network';
import { FACTORY_ABI, LENS_ABI, MARKET_ABI } from '../../config/abis';
import ImageWithFallback from '../../components/ImageWithFallback';
import ProbabilityBar, { getOutcomeColor } from '../../components/ProbabilityBar';
import Countdown from '../../components/Countdown';
import { PageLoader } from '../../components/LoadingSpinner';
import UsdcIcon from '../../components/UsdcIcon';
import { fetchTradeEvents, computeVolumeFromEvents } from '../../services/blockscout';
import {
  formatUSDC, formatWad, formatProbability, probToPercent, formatDate,
  applyBuySlippage, applySellSlippage, parseContractError, resolveImageUri,
  parseMarketSlug, parseProofLinks
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
  cancelReason: string;
  cancelProofUri: string;
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
  const [accurateVolume, setAccurateVolume] = useState<bigint | null>(null);
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
  const [poolBalance, setPoolBalance] = useState<bigint>(0n);
  const [showMainFrame, setShowMainFrame] = useState(false);
  const [hoveredImage, setHoveredImage] = useState<number | null>(null);

  const fetchAll = useCallback(async () => {
    if (marketId === null) return;
    try {
      setLoading(true);
      const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, readProvider);
      const lens = new ethers.Contract(LENS_ADDRESS, LENS_ABI, readProvider);
      const addr = await factory.markets(BigInt(marketId));
      if (!addr || addr === ethers.ZeroAddress) {
        setError('Market not found');
        setLoading(false);
        return;
      }
      setMarketAddress(addr);

      // Core data — must succeed
      const d = await lens.getMarketDetail(addr);

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
        cancelReason: d.cancelReason || '', cancelProofUri: d.cancelProofUri || '',
      };
      setDetail(parsed);

      // Auxiliary data — non-critical, fetch in parallel and handle failures individually
      const [bal, uInfo] = await Promise.all([
        readProvider.getBalance(addr).catch(() => parsed.totalVolumeWei),
        userAddress
          ? new ethers.Contract(addr, MARKET_ABI, readProvider).getUserInfo(userAddress).catch(() => null)
          : Promise.resolve(null),
      ]);

      setPoolBalance(bal);

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
      const lens = new ethers.Contract(LENS_ADDRESS, LENS_ABI, readProvider);
      const d = await lens.getMarketDetail(marketAddress);

      const parsed = {
        market: d.market, title: d.title, description: d.description,
        category: d.category, imageUri: d.imageUri, proofUri: d.proofUri,
        outcomeLabels: [...d.outcomeLabels], totalSharesWad: [...d.totalSharesWad],
        impliedProbabilitiesWad: [...d.impliedProbabilitiesWad],
        stage: Number(d.stage), winningOutcome: Number(d.winningOutcome),
        createdAt: Number(d.createdAt), marketDeadline: Number(d.marketDeadline),
        bWad: d.bWad, totalVolumeWei: d.totalVolumeWei,
        participants: Number(d.participants), resolvedPoolWei: d.resolvedPoolWei,
        resolutionDeadline: Number(d.resolutionDeadline),
        cancelReason: d.cancelReason || '', cancelProofUri: d.cancelProofUri || '',
      };
      setDetail(parsed);

      const [bal, uInfo] = await Promise.all([
        readProvider.getBalance(marketAddress).catch(() => parsed.totalVolumeWei),
        userAddress
          ? new ethers.Contract(marketAddress, MARKET_ABI, readProvider).getUserInfo(userAddress).catch(() => null)
          : Promise.resolve(null),
      ]);

      setPoolBalance(bal);

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
      const outcomeCount = detailData.outcomeLabels.length;
      const bWad = detailData.bWad;
      const shares = new Array(outcomeCount).fill(0n);
      const history: ProbHistoryPoint[] = [];

      // Initial point at market creation — uniform probabilities
      const uniformProb = 100 / outcomeCount;
      const initialPoint: ProbHistoryPoint = { time: detailData.createdAt };
      detailData.outcomeLabels.forEach((label) => {
        initialPoint[label] = Number(uniformProb.toFixed(1));
      });
      history.push(initialPoint);

      // Fetch trade events from BlockScout API (reliable, includes timestamps)
      const events = await fetchTradeEvents(addr);

      // Compute accurate volume from all trade events (buys + sells)
      setAccurateVolume(computeVolumeFromEvents(events));

      for (const event of events) {
        if (event.type === 'buy') {
          shares[event.outcomeIndex] = shares[event.outcomeIndex] + event.sharesWad;
        } else {
          shares[event.outcomeIndex] = shares[event.outcomeIndex] - event.sharesWad;
        }
        const probs = computeProbabilities(shares, bWad);
        const point: ProbHistoryPoint = { time: event.timestamp };
        detailData.outcomeLabels.forEach((label, i) => {
          point[label] = Number((probs[i] * 100).toFixed(1));
        });
        history.push(point);
      }

      // Add a "now" point with current probabilities so the chart extends to present
      const nowTs = Math.floor(Date.now() / 1000);
      const currentProbs = computeProbabilities(detailData.totalSharesWad, bWad);
      const nowPoint: ProbHistoryPoint = { time: nowTs };
      detailData.outcomeLabels.forEach((label, i) => {
        nowPoint[label] = Number((currentProbs[i] * 100).toFixed(1));
      });
      // Only add if it's after the last event
      if (history.length === 0 || nowTs > history[history.length - 1].time) {
        history.push(nowPoint);
      }

      setProbHistory(history);
    } catch (err) {
      console.error('Failed to fetch prob history from BlockScout:', err);
      // Fallback: show current state as a single-point chart
      const currentProbs = computeProbabilities(detailData.totalSharesWad, detailData.bWad);
      const fallback: ProbHistoryPoint[] = [
        (() => {
          const p: ProbHistoryPoint = { time: detailData.createdAt };
          detailData.outcomeLabels.forEach((l, i) => { p[l] = Number((currentProbs[i] * 100).toFixed(1)); });
          return p;
        })(),
        (() => {
          const p: ProbHistoryPoint = { time: Math.floor(Date.now() / 1000) };
          detailData.outcomeLabels.forEach((l, i) => { p[l] = Number((currentProbs[i] * 100).toFixed(1)); });
          return p;
        })(),
      ];
      setProbHistory(fallback);
    }
  }, []);

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
  const isCancelled = detail.stage === STAGE.Cancelled;
  const isExpired = detail.stage === STAGE.Expired;
  const isCancelledOrExpired = isCancelled || isExpired;
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
    // Use actual contract balance (more accurate than totalVolumeWei if sells occurred)
    const poolAfterTrade = poolBalance + costWei;
    // Apply 0.25% resolution fee (matches contract's resolve() logic)
    const resolvedPool = poolAfterTrade * 9975n / 10000n;
    if (totalWinShares > 0n) {
      // Payout for THIS trade's new shares only
      estimatedPayout = (sharesWad * resolvedPool) / totalWinShares;
      multiplier = Number(estimatedPayout) / Number(costWei);
      avgPrice = estimatedShares > 0 ? usdcInput / estimatedShares : 0;
      profit = Number(estimatedPayout - costWei) / 1e18;
      // Total position payout (existing + new shares) — shown separately if user has existing shares
      if (hasExistingShares) {
        const userWinShares = userInfo!.shares[selectedOutcome] + sharesWad;
        totalPositionPayout = (userWinShares * resolvedPool) / totalWinShares;
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
              <MiniStat label="Volume" value={`${formatUSDC(accurateVolume ?? detail.totalVolumeWei)}`} suffix="USDC" icon={<UsdcIcon size={14} />} />
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
            {isResolved && detail.proofUri && (() => {
              const proof = parseProofLinks(detail.proofUri);
              return (
                <div className="card border-emerald-500/20 bg-emerald-500/5 p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/15 flex items-center justify-center shrink-0 mt-0.5">
                      <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-emerald-400 mb-2">
                        Resolved: {detail.outcomeLabels[detail.winningOutcome]} wins
                      </p>
                      
                      {/* Image proof */}
                      {proof.image && (
                        <div className="mb-3">
                          <p className="text-2xs font-medium text-emerald-500/70 uppercase tracking-wider mb-1.5">Proof Image</p>
                          <a href={resolveImageUri(proof.image)} target="_blank" rel="noopener noreferrer">
                            <img
                              src={resolveImageUri(proof.image)}
                              alt="Resolution proof"
                              className="rounded-lg border border-white/[0.06] max-h-64 w-auto object-contain bg-dark-800 hover:opacity-80 transition-opacity cursor-pointer"
                              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                            />
                          </a>
                        </div>
                      )}
                      
                      {/* Main link with frame toggle */}
                      {proof.mainLink ? (() => {
                        const mainLinkStr = proof.mainLink;
                        const isUnsupportedFrame = (url: string) => {
                          const lower = url.toLowerCase();
                          return lower.includes('twitter.com') || 
                                 lower.includes('x.com') || 
                                 lower.includes('facebook.com') ||
                                 lower.includes('instagram.com') ||
                                 lower.includes('linkedin.com') ||
                                 lower.includes('tiktok.com');
                        };
                        const unsupported = isUnsupportedFrame(mainLinkStr);
                        return (
                        <div className="mb-3">
                          <div className="flex items-center gap-2 mb-1.5">
                            <p className="text-2xs font-medium text-emerald-500/70 uppercase tracking-wider">Main Proof</p>
                            {unsupported ? (
                              <span className="text-2xs text-dark-500">(embed not supported)</span>
                            ) : (
                              <button
                                onClick={() => setShowMainFrame(!showMainFrame)}
                                className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1 transition-colors"
                              >
                                {showMainFrame ? (
                                  <>
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                                    </svg>
                                    Hide Frame
                                  </>
                                ) : (
                                  <>
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                    </svg>
                                    Show Frame
                                  </>
                                )}
                              </button>
                            )}
                          </div>
                          {unsupported ? (
                            <a
                              href={resolveImageUri(mainLinkStr)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-emerald-300/70 hover:text-emerald-300 transition-colors inline-flex items-center gap-1"
                            >
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                              </svg>
                              Open {mainLinkStr.length > 40 ? mainLinkStr.slice(0, 40) + '...' : mainLinkStr}
                            </a>
                          ) : showMainFrame ? (
                            <iframe
                              src={resolveImageUri(mainLinkStr)}
                              className="w-full h-64 rounded-lg border border-white/[0.06] bg-dark-900"
                              title="Main proof"
                              sandbox="allow-same-origin allow-forms"
                            />
                          ) : (
                            <a
                              href={resolveImageUri(mainLinkStr)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-emerald-300/70 hover:text-emerald-300 transition-colors inline-flex items-center gap-1"
                            >
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                              </svg>
                              {mainLinkStr.length > 40 ? mainLinkStr.slice(0, 40) + '...' : mainLinkStr}
                            </a>
                          )}
                        </div>
                        );
                      })() : null}
                      
                      {/* Extra links */}
                      {proof.extraLinks.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-emerald-500/10">
                          <p className="text-2xs font-medium text-emerald-500/70 uppercase tracking-wider mb-2">Additional Proofs</p>
                          <div className="flex flex-wrap gap-3">
                            {proof.extraLinks.map((link, i) => (
                              <div key={i} className="relative">
                                {link.type === 'image' ? (
                                  <div 
                                    className="relative"
                                    onMouseEnter={() => setHoveredImage(i)}
                                    onMouseLeave={() => setHoveredImage(null)}
                                  >
                                    <a 
                                      href={resolveImageUri(link.url)} 
                                      target="_blank" 
                                      rel="noopener noreferrer" 
                                      className="text-xs text-emerald-300 hover:text-emerald-200 underline"
                                    >
                                      <span className="inline-flex items-center gap-1">
                                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                        </svg>
                                        Image {i + 1}
                                      </span>
                                    </a>
                                    {hoveredImage === i && (
                                      <div className="absolute z-10 bottom-full left-0 mb-2">
                                        <ImageWithFallback
                                          src={resolveImageUri(link.url)}
                                          alt={`Proof ${i + 1}`}
                                          className="w-48 h-auto rounded-lg border border-white/[0.12] shadow-xl bg-dark-800"
                                        />
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <a href={resolveImageUri(link.url)} target="_blank" rel="noopener noreferrer" className="text-xs text-emerald-300 hover:text-emerald-200 underline">
                                    <span className="inline-flex items-center gap-1">
                                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                                      </svg>
                                      Link {i + 1}
                                    </span>
                                  </a>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Cancellation reason & proof */}
            {(isCancelled || isExpired) && (detail.cancelReason || detail.cancelProofUri) && (
              <div className="card border-red-500/20 bg-red-500/5 p-4">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-red-500/15 flex items-center justify-center shrink-0 mt-0.5">
                    <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                    </svg>
                  </div>
                  <div className="flex-1 space-y-2.5">
                    <p className="text-sm font-semibold text-red-400">
                      {isExpired ? 'Expired' : 'Cancelled'}
                    </p>
                    {detail.cancelReason && (
                      <div>
                        <p className="text-2xs font-medium text-dark-500 uppercase tracking-wider mb-1">Reason</p>
                        <p className="text-xs text-dark-300 whitespace-pre-wrap leading-relaxed">{detail.cancelReason}</p>
                      </div>
                    )}
                    {detail.cancelProofUri && (
                      <div>
                        <p className="text-2xs font-medium text-dark-500 uppercase tracking-wider mb-1.5">Proof / Evidence</p>
                        <a href={resolveImageUri(detail.cancelProofUri)} target="_blank" rel="noopener noreferrer">
                          <img
                            src={resolveImageUri(detail.cancelProofUri)}
                            alt="Cancellation proof"
                            className="rounded-lg border border-white/[0.06] max-h-56 w-auto object-contain bg-dark-800 hover:opacity-80 transition-opacity cursor-pointer"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Resolved pool & fee info */}
            {isResolved && detail.resolvedPoolWei > 0n && (() => {
              const fee = (detail.resolvedPoolWei * 25n) / 9975n;
              return (
                <div className="card p-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="text-2xs text-dark-500 font-medium uppercase tracking-wider">Prize Pool (after fee)</span>
                      <p className="text-base font-bold text-white mt-0.5 flex items-center gap-1.5"><UsdcIcon size={16} />{formatUSDC(detail.resolvedPoolWei)} USDC</p>
                    </div>
                    <div>
                      <span className="text-2xs text-dark-500 font-medium uppercase tracking-wider">Platform Fee (0.25%)</span>
                      <p className="text-base font-bold text-dark-400 mt-0.5 flex items-center gap-1.5"><UsdcIcon size={16} className="opacity-50" />{formatUSDC(fee)} USDC</p>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Description */}
            {detail.description && (
              <div className="card p-5">
                <h2 className="text-sm font-semibold text-dark-300 uppercase tracking-wider mb-3">About</h2>
                <p className="text-sm text-dark-300 leading-relaxed whitespace-pre-wrap">{detail.description}</p>
              </div>
            )}

            {/* Probability history chart — Polymarket-style */}
            {probHistory.length > 0 && (
              <ProbabilityChart
                history={probHistory}
                outcomeLabels={detail.outcomeLabels}
                createdAt={detail.createdAt}
              />
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
          </div>

          {/* Right column — sticky on desktop */}
          <div className="space-y-5 lg:sticky lg:top-20 lg:self-start">
            {/* Trade panel */}
            {isActive && !tradingEnded && isConnected && isCorrectNetwork && (
              <div className="card p-5">
                <h3 className="text-sm font-semibold text-dark-300 uppercase tracking-wider mb-4">Trade</h3>

                {/* Buy/Sell tabs */}
                <div className="flex rounded-xl bg-dark-900/60 p-0.5 mb-5 border border-white/[0.06]">
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
                            : 'border-white/[0.06] bg-dark-900/30 hover:border-white/[0.08]'
                        }`}
                      >
                        <div className="flex justify-between items-center">
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${color.bg} ${selectedOutcome === i ? 'ring-2 ring-offset-1 ring-offset-dark-900' : ''}`} style={selectedOutcome === i ? { boxShadow: `0 0 0 2px var(--tw-ring-offset-color), 0 0 0 4px currentColor`, color: 'rgba(99,102,241,0.3)' } : {}} />
                            <span className="font-medium text-white text-sm">{label}</span>
                          </div>
                          <span className={`font-mono text-xs font-bold tabular-nums flex items-center gap-1 ${color.text}`}><UsdcIcon size={12} />{(pct / 100).toFixed(2)} USDC</span>
                        </div>
                        {tradeTab === 'sell' && userShares > 0n && (
                          <p className="text-2xs text-dark-500 mt-1 ml-4">Your shares: {formatWad(userShares)}</p>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Amount input */}
                <label className="text-2xs font-semibold text-dark-500 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                  {tradeTab === 'buy' ? <><UsdcIcon size={12} />Amount (USDC)</> : 'Shares to Sell'}
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
                    <span className="text-2xs text-dark-500 font-medium flex items-center gap-1">
                      {tradeTab === 'buy' && <UsdcIcon size={12} />}
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
                  <div className="p-3 rounded-xl bg-dark-900/40 border border-white/[0.06] mb-4 space-y-2">
                    <PreviewRow label="Est. Shares" value={previewLoading ? '...' : `${estimatedShares.toFixed(4)}`} />
                    <PreviewRow label="Avg Price" value={previewLoading ? '...' : `${avgPrice.toFixed(4)} USDC`} />
                    {estimatedPayout !== null && (
                      <>
                        <PreviewRow label="Est. Payout if Wins" value={`${formatUSDC(estimatedPayout)} USDC`} accent={profit >= 0 ? 'green' : 'red'} />
                        <PreviewRow label="Profit" value={`${profit >= 0 ? '+' : ''}${profit.toFixed(4)} USDC`} accent={profit >= 0 ? 'green' : 'red'} />
                        <PreviewRow label="Return" value={`${multiplier.toFixed(2)}x`} accent={multiplier >= 1 ? 'green' : 'red'} />
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
                  <div className="p-3 rounded-xl bg-dark-900/40 border border-white/[0.06] mb-4 space-y-2">
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
                      <div key={i} className={`p-3 rounded-xl ${isWinner ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-dark-900/30 border border-white/[0.06]'}`}>
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

                <div className="p-3 rounded-xl bg-dark-900/30 border border-white/[0.06] mb-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-dark-500 font-medium">Net Deposited</span>
                    <span className="font-bold text-white tabular-nums flex items-center gap-1"><UsdcIcon size={14} />{formatUSDC(userInfo.netDeposited)} USDC</span>
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

/* ─── Probability Chart (Polymarket-style) ─── */

const CHART_COLORS = ['#22c55e', '#ef4444', '#3b82f6', '#a855f7', '#f97316', '#06b6d4'];

const TIME_RANGES = [
  { key: '1H', label: '1H', seconds: 3600 },
  { key: '6H', label: '6H', seconds: 21600 },
  { key: '1D', label: '1D', seconds: 86400 },
  { key: '1W', label: '1W', seconds: 604800 },
  { key: '1M', label: '1M', seconds: 2592000 },
  { key: 'ALL', label: 'All', seconds: 0 },
] as const;

function ProbabilityChart({
  history,
  outcomeLabels,
  createdAt,
}: {
  history: ProbHistoryPoint[];
  outcomeLabels: string[];
  createdAt: number;
}) {
  const [timeRange, setTimeRange] = useState<string>('ALL');
  const [hoveredData, setHoveredData] = useState<ProbHistoryPoint | null>(null);
  const [activeOutcome, setActiveOutcome] = useState<string | null>(null);

  const filteredHistory = (() => {
    if (timeRange === 'ALL' || history.length === 0) return history;
    const range = TIME_RANGES.find(r => r.key === timeRange);
    if (!range || range.seconds === 0) return history;
    const cutoff = Math.floor(Date.now() / 1000) - range.seconds;
    const filtered = history.filter(p => p.time >= cutoff);
    // Always include at least one point before the cutoff for continuity
    if (filtered.length < history.length && filtered.length > 0) {
      const prevIdx = history.findIndex(p => p.time >= cutoff);
      if (prevIdx > 0) return [history[prevIdx - 1], ...filtered];
    }
    return filtered.length > 0 ? filtered : history;
  })();

  // Current values (last point or hovered)
  const displayData = hoveredData ?? (filteredHistory.length > 0 ? filteredHistory[filteredHistory.length - 1] : null);
  const latestData = filteredHistory.length > 0 ? filteredHistory[filteredHistory.length - 1] : null;

  // Compute change from first visible point
  const firstData = filteredHistory.length > 0 ? filteredHistory[0] : null;

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div className="p-5 pb-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-dark-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
            </svg>
            <h2 className="text-sm font-semibold text-dark-300 uppercase tracking-wider">Price History</h2>
          </div>
          {/* Time range selector */}
          <div className="flex items-center rounded-lg bg-dark-900/60 p-0.5 border border-white/[0.06]">
            {TIME_RANGES.map(range => (
              <button
                key={range.key}
                onClick={() => setTimeRange(range.key)}
                className={`px-2 py-1 rounded-md text-2xs font-semibold transition-all ${
                  timeRange === range.key
                    ? 'bg-primary-600/20 text-primary-400'
                    : 'text-dark-500 hover:text-dark-300'
                }`}
              >
                {range.label}
              </button>
            ))}
          </div>
        </div>

        {/* Outcome legend / price display — Polymarket style */}
        {displayData && (
          <div className="space-y-2 mb-4">
            {outcomeLabels.map((label, i) => {
              const value = displayData[label] as number | undefined;
              const firstValue = firstData ? (firstData[label] as number | undefined) : undefined;
              const change = value != null && firstValue != null ? value - firstValue : null;
              const isActive = activeOutcome === null || activeOutcome === label;
              return (
                <button
                  key={label}
                  onClick={() => setActiveOutcome(prev => prev === label ? null : label)}
                  className={`w-full flex items-center justify-between p-2.5 rounded-xl transition-all border ${
                    isActive
                      ? 'border-white/[0.08] bg-dark-900/40'
                      : 'border-transparent bg-dark-900/20 opacity-40'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <div
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
                    />
                    <span className="text-sm font-medium text-white">{label}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {change !== null && change !== 0 && (
                      <span className={`text-2xs font-semibold tabular-nums ${change > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {change > 0 ? '+' : ''}{change.toFixed(1)}%
                      </span>
                    )}
                    <span
                      className="text-lg font-bold tabular-nums"
                      style={{ color: CHART_COLORS[i % CHART_COLORS.length] }}
                    >
                      {value != null ? `${value.toFixed(1)}` : '--'}
                      <span className="text-xs opacity-60">¢</span>
                    </span>
                  </div>
                </button>
              );
            })}
            {hoveredData && (
              <div className="text-center">
                <span className="text-2xs text-dark-600">
                  {formatDate(hoveredData.time)}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Chart */}
      <div className="h-64 sm:h-72 px-2 pb-3">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={filteredHistory}
            margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
            onMouseMove={(state: { activePayload?: Array<{ payload: ProbHistoryPoint }> }) => {
              if (state?.activePayload?.[0]) {
                setHoveredData(state.activePayload[0].payload);
              }
            }}
            onMouseLeave={() => setHoveredData(null)}
          >
            <defs>
              {outcomeLabels.map((_, i) => (
                <linearGradient key={i} id={`prob-gradient-${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CHART_COLORS[i % CHART_COLORS.length]} stopOpacity={0.15} />
                  <stop offset="100%" stopColor={CHART_COLORS[i % CHART_COLORS.length]} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="rgba(255,255,255,0.03)"
              vertical={false}
            />
            <XAxis
              dataKey="time"
              tickFormatter={(t) => {
                const d = new Date(t * 1000);
                if (timeRange === '1H' || timeRange === '6H' || timeRange === '1D') {
                  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                }
                return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
              }}
              stroke="transparent"
              tick={{ fontSize: 10, fill: '#3b4252' }}
              axisLine={false}
              tickLine={false}
              minTickGap={50}
            />
            <YAxis
              domain={[0, 100]}
              tickFormatter={(v) => `${v}¢`}
              stroke="transparent"
              tick={{ fontSize: 10, fill: '#3b4252' }}
              axisLine={false}
              tickLine={false}
              width={32}
              ticks={[0, 25, 50, 75, 100]}
            />
            <Tooltip
              cursor={{
                stroke: 'rgba(255,255,255,0.15)',
                strokeWidth: 1,
              }}
              contentStyle={{
                backgroundColor: 'rgba(10, 15, 25, 0.95)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '10px',
                backdropFilter: 'blur(16px)',
                padding: '10px 14px',
                fontSize: '12px',
                boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
              }}
              labelFormatter={(t) => formatDate(t as number)}
              formatter={(value: number, name: string) => {
                const idx = outcomeLabels.indexOf(name);
                const color = CHART_COLORS[idx % CHART_COLORS.length] || '#fff';
                return [`${value.toFixed(1)}¢`, name];
              }}
              itemStyle={{ fontSize: '11px', padding: '1px 0' }}
            />
            {outcomeLabels.map((label, i) => {
              const isVisible = activeOutcome === null || activeOutcome === label;
              return (
                <Area
                  key={label}
                  type="stepAfter"
                  dataKey={label}
                  stroke={isVisible ? CHART_COLORS[i % CHART_COLORS.length] : 'transparent'}
                  strokeWidth={isVisible ? 2.5 : 0}
                  fill={isVisible ? `url(#prob-gradient-${i})` : 'transparent'}
                  fillOpacity={1}
                  dot={false}
                  activeDot={isVisible ? {
                    r: 4,
                    strokeWidth: 2,
                    stroke: CHART_COLORS[i % CHART_COLORS.length],
                    fill: '#0a0f19',
                  } : false}
                  animationDuration={500}
                />
              );
            })}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Trade count indicator */}
      <div className="px-5 pb-3 flex items-center justify-between">
        <span className="text-2xs text-dark-600">
          {history.length - 1} trade{history.length - 1 !== 1 ? 's' : ''} recorded
        </span>
        <span className="text-2xs text-dark-600">
          Powered by BlockScout
        </span>
      </div>
    </div>
  );
}

/* ─── Sub-components ─── */

function MiniStat({ label, value, suffix, small, icon }: { label: string; value: string; suffix?: string; small?: boolean; icon?: React.ReactNode }) {
  return (
    <div className="card p-3">
      <span className="text-2xs text-dark-500 font-medium uppercase tracking-wider">{label}</span>
      <div className="flex items-center gap-1 mt-0.5">
        {icon}
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
        accent === 'red' ? 'text-red-400' :
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
