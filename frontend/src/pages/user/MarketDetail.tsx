import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
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
  applyBuySlippage, applySellSlippage, parseContractError, resolveImageUri
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
  const { id } = useParams<{ id: string }>();
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
  const [previewCost, setPreviewCost] = useState<bigint | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [txPending, setTxPending] = useState(false);
  const [txMessage, setTxMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Resolve market ID to address
  useEffect(() => {
    if (!id) return;
    const resolve = async () => {
      try {
        const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, readProvider);
        const addr = await factory.markets(BigInt(id));
        if (!addr || addr === ethers.ZeroAddress) {
          setError('Market not found');
          setLoading(false);
          return;
        }
        setMarketAddress(addr);
      } catch {
        setError('Invalid market ID');
        setLoading(false);
      }
    };
    resolve();
  }, [id, readProvider]);

  const fetchDetail = useCallback(async () => {
    if (!marketAddress) return;
    try {
      setLoading(true);
      const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, readProvider);
      const d = await factory.getMarketDetail(marketAddress);

      const parsed: MarketDetailData = {
        market: d.market,
        title: d.title,
        description: d.description,
        category: d.category,
        imageUri: d.imageUri,
        proofUri: d.proofUri,
        outcomeLabels: [...d.outcomeLabels],
        totalSharesWad: [...d.totalSharesWad],
        impliedProbabilitiesWad: [...d.impliedProbabilitiesWad],
        stage: Number(d.stage),
        winningOutcome: Number(d.winningOutcome),
        createdAt: Number(d.createdAt),
        marketDeadline: Number(d.marketDeadline),
        bWad: d.bWad,
        totalVolumeWei: d.totalVolumeWei,
        participants: Number(d.participants),
      };
      setDetail(parsed);
    } catch (err) {
      console.error('Failed to fetch market detail:', err);
      setError('Failed to load market details');
    } finally {
      setLoading(false);
    }
  }, [marketAddress, readProvider]);

  const fetchUserInfo = useCallback(async () => {
    if (!marketAddress || !userAddress) return;
    try {
      const market = new ethers.Contract(marketAddress, MARKET_ABI, readProvider);
      const info = await market.getUserInfo(userAddress);
      setUserInfo({
        shares: [...info._shares],
        netDeposited: info._netDeposited,
        redeemed: info._redeemed,
        refunded: info._refunded,
        canRedeem: info._canRedeem,
        canRefund: info._canRefund,
      });
    } catch (err) {
      console.error('Failed to fetch user info:', err);
    }
  }, [marketAddress, userAddress, readProvider]);

  const fetchProbHistory = useCallback(async () => {
    if (!marketAddress || !detail) return;
    try {
      const market = new ethers.Contract(marketAddress, MARKET_ABI, readProvider);

      // Fetch buy and sell events
      const buyFilter = market.filters.SharesBought();
      const sellFilter = market.filters.SharesSold();
      const [buyEvents, sellEvents] = await Promise.all([
        market.queryFilter(buyFilter, 0),
        market.queryFilter(sellFilter, 0),
      ]);

      // Combine and sort by block
      type TradeEvent = { blockNumber: number; type: string; log: ethers.EventLog };
      const allEvents: TradeEvent[] = [
        ...buyEvents.map(e => ({ blockNumber: e.blockNumber, type: 'buy', log: e as ethers.EventLog })),
        ...sellEvents.map(e => ({ blockNumber: e.blockNumber, type: 'sell', log: e as ethers.EventLog })),
      ].sort((a, b) => a.blockNumber - b.blockNumber);

      if (allEvents.length === 0) return;

      // Build history by fetching probabilities at trade points
      // We'll simulate by accumulating shares and computing probabilities locally
      const outcomeCount = detail.outcomeLabels.length;
      const bWad = detail.bWad;
      const shares = new Array(outcomeCount).fill(0n);
      const history: ProbHistoryPoint[] = [];

      // Initial uniform state
      const uniformProb = 100 / outcomeCount;
      const initialPoint: ProbHistoryPoint = { time: detail.createdAt };
      detail.outcomeLabels.forEach((label, i) => {
        initialPoint[label] = Number(uniformProb.toFixed(1));
      });
      history.push(initialPoint);

      // Process each event
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

        // Get block timestamp
        let timestamp: number;
        try {
          const block = await readProvider.getBlock(event.blockNumber);
          timestamp = block ? block.timestamp : detail.createdAt;
        } catch {
          timestamp = detail.createdAt;
        }

        // Compute probabilities using the LMSR formula
        // p_i = exp(q_i/b) / sum(exp(q_j/b))
        const probs = computeProbabilities(shares, bWad);

        const point: ProbHistoryPoint = { time: timestamp };
        detail.outcomeLabels.forEach((label, i) => {
          point[label] = Number((probs[i] * 100).toFixed(1));
        });
        history.push(point);
      }

      setProbHistory(history);
    } catch (err) {
      console.error('Failed to fetch prob history:', err);
    }
  }, [marketAddress, detail, readProvider]);

  useEffect(() => { fetchDetail(); }, [fetchDetail]);
  useEffect(() => { fetchUserInfo(); }, [fetchUserInfo]);
  useEffect(() => {
    if (detail) fetchProbHistory();
  }, [detail?.market]); // Only run once when detail first loads

  // Preview cost/proceeds
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (!marketAddress || !shareAmount || parseFloat(shareAmount) <= 0) {
        setPreviewCost(null);
        return;
      }
      try {
        setPreviewLoading(true);
        const market = new ethers.Contract(marketAddress, MARKET_ABI, readProvider);
        const sharesWad = ethers.parseEther(shareAmount);

        if (tradeTab === 'buy') {
          const cost = await market.previewBuy(selectedOutcome, sharesWad);
          setPreviewCost(cost);
        } else {
          const proceeds = await market.previewSell(selectedOutcome, sharesWad);
          setPreviewCost(proceeds);
        }
      } catch {
        setPreviewCost(null);
      } finally {
        setPreviewLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [marketAddress, shareAmount, selectedOutcome, tradeTab, readProvider]);

  const handleBuy = async () => {
    if (!signer || !marketAddress || !previewCost || !shareAmount) return;
    setTxPending(true);
    setTxMessage(null);
    try {
      const market = new ethers.Contract(marketAddress, MARKET_ABI, signer);
      const sharesWad = ethers.parseEther(shareAmount);
      const maxCost = applyBuySlippage(previewCost, slippage);

      const tx = await market.buy(selectedOutcome, sharesWad, maxCost, { value: maxCost });
      setTxMessage({ type: 'success', text: 'Transaction submitted. Waiting for confirmation...' });
      await tx.wait();
      setTxMessage({ type: 'success', text: 'Shares purchased successfully!' });
      setShareAmount('');
      fetchDetail();
      fetchUserInfo();
    } catch (err) {
      setTxMessage({ type: 'error', text: parseContractError(err) });
    } finally {
      setTxPending(false);
    }
  };

  const handleSell = async () => {
    if (!signer || !marketAddress || !previewCost || !shareAmount) return;
    setTxPending(true);
    setTxMessage(null);
    try {
      const market = new ethers.Contract(marketAddress, MARKET_ABI, signer);
      const sharesWad = ethers.parseEther(shareAmount);
      const minReceive = applySellSlippage(previewCost, slippage);

      const tx = await market.sell(selectedOutcome, sharesWad, minReceive);
      setTxMessage({ type: 'success', text: 'Transaction submitted. Waiting for confirmation...' });
      await tx.wait();
      setTxMessage({ type: 'success', text: 'Shares sold successfully!' });
      setShareAmount('');
      fetchDetail();
      fetchUserInfo();
    } catch (err) {
      setTxMessage({ type: 'error', text: parseContractError(err) });
    } finally {
      setTxPending(false);
    }
  };

  const handleRedeem = async () => {
    if (!signer || !marketAddress) return;
    setTxPending(true);
    setTxMessage(null);
    try {
      const market = new ethers.Contract(marketAddress, MARKET_ABI, signer);
      const tx = await market.redeem();
      setTxMessage({ type: 'success', text: 'Redeem transaction submitted...' });
      await tx.wait();
      setTxMessage({ type: 'success', text: 'Winnings claimed successfully!' });
      fetchUserInfo();
    } catch (err) {
      setTxMessage({ type: 'error', text: parseContractError(err) });
    } finally {
      setTxPending(false);
    }
  };

  const handleRefund = async () => {
    if (!signer || !marketAddress) return;
    setTxPending(true);
    setTxMessage(null);
    try {
      const market = new ethers.Contract(marketAddress, MARKET_ABI, signer);
      const tx = await market.refund();
      setTxMessage({ type: 'success', text: 'Refund transaction submitted...' });
      await tx.wait();
      setTxMessage({ type: 'success', text: 'Refund claimed successfully!' });
      fetchUserInfo();
    } catch (err) {
      setTxMessage({ type: 'error', text: parseContractError(err) });
    } finally {
      setTxPending(false);
    }
  };

  if (loading) return <PageLoader />;
  if (error || !detail) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 text-center">
        <p className="text-red-400">{error || 'Market not found'}</p>
      </div>
    );
  }

  const isActive = detail.stage === STAGE.Active;
  const isResolved = detail.stage === STAGE.Resolved;
  const isCancelledOrExpired = detail.stage === STAGE.Cancelled || detail.stage === STAGE.Expired;

  // Estimate payout for buy preview
  let estimatedPayout: bigint | null = null;
  let multiplier = 0;
  if (previewCost && shareAmount && tradeTab === 'buy') {
    const sharesWad = ethers.parseEther(shareAmount);
    const totalWinShares = detail.totalSharesWad[selectedOutcome] + sharesWad;
    const userWinShares = (userInfo?.shares[selectedOutcome] || 0n) + sharesWad;
    // Approximate: total pool is current balance + cost
    // Payout = userWinShares / totalWinShares * pool
    // This is approximate since we don't know exact contract balance
    if (totalWinShares > 0n) {
      estimatedPayout = (userWinShares * (detail.totalVolumeWei + previewCost)) / totalWinShares;
      multiplier = Number(estimatedPayout) / Number(previewCost);
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-fade-in">
      {/* Header */}
      <div className="card overflow-hidden mb-8">
        <div className="relative">
          <ImageWithFallback src={detail.imageUri} alt={detail.title} className="h-48 sm:h-64 w-full" />
          <div className="absolute inset-0 bg-gradient-to-t from-dark-900/90 via-dark-900/20 to-transparent" />
          <div className="absolute bottom-4 left-4 right-4">
            <div className="flex items-center gap-2 mb-2">
              <span className={`badge ${STAGE_COLORS[detail.stage]}`}>{STAGE_LABELS[detail.stage]}</span>
              <span className="badge bg-dark-900/80 text-dark-200 border-dark-700/50 backdrop-blur-sm">{detail.category}</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white leading-tight">{detail.title}</h1>
          </div>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-dark-300 leading-relaxed whitespace-pre-wrap">{detail.description}</p>

          <div className="flex flex-wrap gap-6 text-sm">
            <div>
              <span className="text-dark-400">Volume</span>
              <p className="font-semibold text-white">{formatUSDC(detail.totalVolumeWei)} USDC</p>
            </div>
            <div>
              <span className="text-dark-400">Participants</span>
              <p className="font-semibold text-white">{detail.participants}</p>
            </div>
            <div>
              <span className="text-dark-400">Created</span>
              <p className="font-semibold text-white">{formatDate(detail.createdAt)}</p>
            </div>
            <div>
              <span className="text-dark-400">{isActive ? 'Ends' : 'Ended'}</span>
              <p className="font-semibold text-white">{formatDate(detail.marketDeadline)}</p>
            </div>
            {isActive && (
              <div>
                <span className="text-dark-400">Time Remaining</span>
                <Countdown deadline={detail.marketDeadline} />
              </div>
            )}
          </div>

          {/* Resolution proof */}
          {isResolved && detail.proofUri && (
            <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/20">
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div>
                  <p className="text-sm font-medium text-blue-400 mb-1">
                    Resolved: {detail.outcomeLabels[detail.winningOutcome]} wins
                  </p>
                  <a
                    href={resolveImageUri(detail.proofUri)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-300 hover:text-blue-200 underline break-all"
                  >
                    View Resolution Proof
                  </a>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left: Chart + Probabilities */}
        <div className="lg:col-span-2 space-y-6">
          {/* Current probabilities */}
          <div className="card p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Outcome Probabilities</h2>
            <ProbabilityBar
              labels={detail.outcomeLabels}
              probabilities={detail.impliedProbabilitiesWad}
              winningOutcome={detail.winningOutcome}
              isResolved={isResolved}
            />
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-6">
              {detail.outcomeLabels.map((label, i) => {
                const color = getOutcomeColor(i);
                return (
                  <div key={i} className={`p-3 rounded-xl ${color.light} text-center`}>
                    <p className="text-xs text-dark-300 mb-1">{label}</p>
                    <p className={`text-2xl font-bold ${color.text}`}>
                      {formatProbability(detail.impliedProbabilitiesWad[i])}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Probability history chart */}
          {probHistory.length > 1 && (
            <div className="card p-6">
              <h2 className="text-lg font-semibold text-white mb-4">Probability History</h2>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={probHistory}>
                  <XAxis
                    dataKey="time"
                    tickFormatter={(t) => new Date(t * 1000).toLocaleDateString()}
                    stroke="#475569"
                    tick={{ fontSize: 11 }}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tickFormatter={(v) => `${v}%`}
                    stroke="#475569"
                    tick={{ fontSize: 11 }}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '12px' }}
                    labelFormatter={(t) => formatDate(t as number)}
                    formatter={(value: number) => [`${value.toFixed(1)}%`]}
                  />
                  <Legend />
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
                      />
                    );
                  })}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Right: Trade panel + Position */}
        <div className="space-y-6">
          {/* Trade panel */}
          {isActive && isConnected && isCorrectNetwork && (
            <div className="card p-6">
              <div className="flex rounded-xl bg-dark-900/60 p-1 mb-6">
                <button
                  onClick={() => { setTradeTab('buy'); setShareAmount(''); setPreviewCost(null); }}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                    tradeTab === 'buy' ? 'bg-green-500/20 text-green-400' : 'text-dark-400 hover:text-white'
                  }`}
                >
                  Buy
                </button>
                <button
                  onClick={() => { setTradeTab('sell'); setShareAmount(''); setPreviewCost(null); }}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                    tradeTab === 'sell' ? 'bg-red-500/20 text-red-400' : 'text-dark-400 hover:text-white'
                  }`}
                >
                  Sell
                </button>
              </div>

              {/* Outcome selector */}
              <label className="label">Select Outcome</label>
              <div className="space-y-2 mb-4">
                {detail.outcomeLabels.map((label, i) => {
                  const color = getOutcomeColor(i);
                  const userShares = userInfo?.shares[i] || 0n;
                  return (
                    <button
                      key={i}
                      onClick={() => setSelectedOutcome(i)}
                      className={`w-full p-3 rounded-xl text-left text-sm transition-all border ${
                        selectedOutcome === i
                          ? 'border-primary-500/50 bg-primary-500/10'
                          : 'border-dark-700/30 bg-dark-900/40 hover:border-dark-600'
                      }`}
                    >
                      <div className="flex justify-between items-center">
                        <span className="font-medium text-white">{label}</span>
                        <span className={`font-mono text-xs ${color.text}`}>
                          {formatProbability(detail.impliedProbabilitiesWad[i])}
                        </span>
                      </div>
                      {tradeTab === 'sell' && userShares > 0n && (
                        <p className="text-xs text-dark-400 mt-1">
                          Your shares: {formatWad(userShares)}
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Share amount input */}
              <label className="label">
                {tradeTab === 'buy' ? 'Shares to Buy' : 'Shares to Sell'}
              </label>
              <input
                type="number"
                value={shareAmount}
                onChange={(e) => setShareAmount(e.target.value)}
                placeholder="e.g. 10"
                min="0"
                step="0.1"
                className="input-field mb-4"
              />

              {/* Slippage */}
              <div className="flex items-center justify-between mb-4">
                <label className="text-xs text-dark-400">Slippage Tolerance</label>
                <div className="flex items-center gap-1">
                  {[0.5, 1, 2, 5].map(s => (
                    <button
                      key={s}
                      onClick={() => setSlippage(s)}
                      className={`px-2 py-1 rounded text-xs font-medium transition-all ${
                        slippage === s
                          ? 'bg-primary-600 text-white'
                          : 'bg-dark-700/50 text-dark-400 hover:text-white'
                      }`}
                    >
                      {s}%
                    </button>
                  ))}
                </div>
              </div>

              {/* Cost preview */}
              {previewCost !== null && shareAmount && (
                <div className="p-4 rounded-xl bg-dark-900/60 border border-dark-700/30 mb-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-dark-400">
                      {tradeTab === 'buy' ? 'Estimated Cost' : 'Estimated Proceeds'}
                    </span>
                    <span className="font-semibold text-white">
                      {previewLoading ? '...' : `${formatUSDC(previewCost)} USDC`}
                    </span>
                  </div>
                  {tradeTab === 'buy' && estimatedPayout !== null && (
                    <>
                      <div className="flex justify-between text-sm">
                        <span className="text-dark-400">Potential Payout (if wins)</span>
                        <span className="text-green-400 font-semibold">{formatUSDC(estimatedPayout)} USDC</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-dark-400">Multiplier</span>
                        <span className="text-green-400 font-semibold">{multiplier.toFixed(2)}x</span>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between text-sm">
                    <span className="text-dark-400">
                      {tradeTab === 'buy' ? 'Max Cost (with slippage)' : 'Min Receive (with slippage)'}
                    </span>
                    <span className="text-dark-300 font-mono text-xs">
                      {tradeTab === 'buy'
                        ? formatUSDC(applyBuySlippage(previewCost, slippage))
                        : formatUSDC(applySellSlippage(previewCost, slippage))
                      } USDC
                    </span>
                  </div>
                </div>
              )}

              {/* Submit */}
              <button
                onClick={tradeTab === 'buy' ? handleBuy : handleSell}
                disabled={txPending || !shareAmount || !previewCost || parseFloat(shareAmount) <= 0}
                className={`w-full py-3 rounded-xl font-semibold transition-all ${
                  tradeTab === 'buy'
                    ? 'bg-green-600 hover:bg-green-500 text-white disabled:bg-green-600/30 disabled:text-green-400/50'
                    : 'bg-red-600 hover:bg-red-500 text-white disabled:bg-red-600/30 disabled:text-red-400/50'
                }`}
              >
                {txPending ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Processing...
                  </span>
                ) : tradeTab === 'buy' ? (
                  `Buy ${detail.outcomeLabels[selectedOutcome]} Shares`
                ) : (
                  `Sell ${detail.outcomeLabels[selectedOutcome]} Shares`
                )}
              </button>

              {/* Transaction message */}
              {txMessage && (
                <div className={`mt-3 p-3 rounded-xl text-sm ${
                  txMessage.type === 'success'
                    ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                    : 'bg-red-500/10 text-red-400 border border-red-500/20'
                }`}>
                  {txMessage.text}
                </div>
              )}
            </div>
          )}

          {/* Connect wallet prompt */}
          {isActive && !isConnected && (
            <div className="card p-6 text-center">
              <p className="text-dark-400 text-sm mb-3">Connect your wallet to trade</p>
            </div>
          )}

          {/* Wrong network prompt */}
          {isActive && isConnected && !isCorrectNetwork && (
            <div className="card p-6 text-center">
              <p className="text-yellow-400 text-sm">Switch to ARC Testnet to trade</p>
            </div>
          )}

          {/* User Position */}
          {userInfo && isConnected && (
            <div className="card p-6">
              <h3 className="text-lg font-semibold text-white mb-4">Your Position</h3>

              <div className="space-y-3 mb-4">
                {detail.outcomeLabels.map((label, i) => {
                  const shares = userInfo.shares[i];
                  if (shares === 0n) return null;
                  const color = getOutcomeColor(i);
                  const isWinner = isResolved && detail.winningOutcome === i;
                  return (
                    <div key={i} className={`p-3 rounded-xl ${isWinner ? 'bg-green-500/10 border border-green-500/20' : 'bg-dark-900/40'}`}>
                      <div className="flex justify-between items-center">
                        <span className={`text-sm font-medium ${isWinner ? 'text-green-400' : 'text-dark-200'}`}>
                          {isWinner && '* '}{label}
                        </span>
                        <span className={`font-mono text-sm ${color.text}`}>{formatWad(shares)} shares</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="p-3 rounded-xl bg-dark-900/40 mb-4">
                <div className="flex justify-between text-sm">
                  <span className="text-dark-400">Net Deposited</span>
                  <span className="font-semibold text-white">{formatUSDC(userInfo.netDeposited)} USDC</span>
                </div>
              </div>

              {/* Redeem button */}
              {userInfo.canRedeem && (
                <button onClick={handleRedeem} disabled={txPending} className="w-full btn-success py-3 text-base font-semibold pulse-glow">
                  {txPending ? 'Processing...' : 'Claim Winnings'}
                </button>
              )}

              {/* Refund button */}
              {userInfo.canRefund && (
                <button onClick={handleRefund} disabled={txPending} className="w-full btn-primary py-3 text-base font-semibold">
                  {txPending ? 'Processing...' : 'Claim Refund'}
                </button>
              )}

              {/* Already claimed */}
              {userInfo.redeemed && (
                <div className="p-3 rounded-xl bg-green-500/10 border border-green-500/20 text-center">
                  <p className="text-sm text-green-400">Winnings already claimed</p>
                </div>
              )}
              {userInfo.refunded && (
                <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-center">
                  <p className="text-sm text-blue-400">Refund already claimed</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Compute LMSR implied probabilities client-side.
 * p_i = exp(q_i / b) / sum(exp(q_j / b))
 * All values are in WAD (1e18 = 1.0)
 */
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
