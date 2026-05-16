import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ethers } from 'ethers';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { ChevronDown, ChevronUp, Layers3, SlidersHorizontal, Zap } from 'lucide-react';
import { useWallet } from '../../context/WalletContext';
import { HYBRID_FACTORY_ADDRESS, HYBRID_LENS_ADDRESS, MARKET_ROUTER_ADDRESS, ORDER_BOOK_ADDRESS, STAGE, STAGE_LABELS, STAGE_COLORS } from '../../config/network';
import { HYBRID_FACTORY_ABI, HYBRID_LENS_ABI, MARKET_V2_ABI, MARKET_ROUTER_ABI, ORDER_BOOK_ABI } from '../../config/abis';
import ImageWithFallback from '../../components/ImageWithFallback';
import ProbabilityBar, { getOutcomeColor } from '../../components/ProbabilityBar';
import Countdown from '../../components/Countdown';
import { PageLoader } from '../../components/LoadingSpinner';
import UsdcIcon from '../../components/UsdcIcon';
import { fetchTradeEvents, computeVolumeFromEvents, type TradeEvent } from '../../services/blockscout';
import {
  formatUSDC, formatCompactUSDC, formatCompact, formatWad, formatProbability, probToPercent, formatDate,
  applyBuySlippage, parseContractError, resolveImageUri,
  parseMarketSlug, parseProofLinks, parseDescription
} from '../../utils/format';
import { showToast } from '../../components/Toast';
import { NETWORK } from '../../config/network';
import ChatThread from '../../components/chat/ChatThread';
import { fetchProfileByAddress } from '../../services/profile';
import { fetchLinkPreview, type LinkPreviewData } from '../../services/linkPreview';
import { fetchLiveMarketData } from '../../services/live';
import type { LiveMarketDataResponse } from '../../types/live';

const DEFAULT_META_TITLE = 'AchMarket - Prediction Markets';
const DEFAULT_META_DESCRIPTION = 'Trade prediction markets on ARC Testnet with USDC.';
const WAD = 1_000_000_000_000_000_000n;

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
  resolutionTime: number;
  bWad: bigint;
  totalVolumeWei: bigint;
  participants: number;
  mode: number;
  resolvedPoolWei: bigint;
  cancelReason: string;
  cancelProofUri: string;
  resolutionSource: string;
  fallbackResolutionSource: string;
  invalidCondition: string;
  resolutionManager: string;
}

interface UserInfo {
  shares: bigint[];
  redeemed: boolean;
  canRedeem: boolean;
}

interface ProbHistoryPoint {
  time: number;
  [key: string]: number;
}

interface DepthLevel {
  price: bigint;
  shares: bigint;
}

interface MMQuoteState {
  initialSharesWad: bigint;
  availableSharesWad: bigint;
  soldSharesWad: bigint;
  reserveWei: bigint;
  bidPriceWad: bigint;
  askPriceWad: bigint;
}

interface UserLimitOrder {
  id: bigint;
  market: string;
  outcome: number;
  owner: string;
  side: 0 | 1;
  priceWad: bigint;
  remainingSharesWad: bigint;
  escrowWei: bigint;
  expiry: number;
  active: boolean;
  originalSharesWad: bigint;
  status: number;
}

type DepthResult = {
  pricesWad?: bigint[];
  sharesWad?: bigint[];
  0?: bigint[];
  1?: bigint[];
};

const ORDER_STATUS_LABELS: Record<number, string> = {
  0: 'Open',
  1: 'Partially Filled',
  2: 'Filled',
  3: 'Cancelled',
};

function formatInputWad(value: bigint): string {
  const formatted = ethers.formatEther(value);
  return formatted.includes('.')
    ? formatted.replace(/\.?0+$/, '')
    : formatted;
}

function safeParseAmount(value: string): bigint {
  try {
    return value && parseFloat(value) > 0 ? ethers.parseEther(value) : 0n;
  } catch {
    return 0n;
  }
}

function calculateSharesFromUsdc(usdcWei: bigint, priceWad: bigint): bigint {
  return usdcWei > 0n && priceWad > 0n
    ? (usdcWei * WAD) / priceWad
    : 0n;
}

function calculateUsdcFromShares(sharesWad: bigint, priceWad: bigint): bigint {
  return sharesWad > 0n && priceWad > 0n
    ? (sharesWad * priceWad) / WAD
    : 0n;
}

type RouterPreview = {
  requestedSharesWad?: bigint;
  filledSharesWad?: bigint;
  orderBookSharesWad?: bigint;
  mmSharesWad?: bigint;
  costWei?: bigint;
  proceedsWei?: bigint;
  feeWei?: bigint;
  usedOrderBook?: boolean;
  usedMM?: boolean;
  isPartial?: boolean;
  0?: bigint;
  1?: bigint;
  2?: bigint;
  3?: bigint;
  4?: bigint;
  5?: bigint;
  6?: bigint;
};

function getPreviewShares(preview: RouterPreview): bigint {
  return preview.filledSharesWad ?? preview[1] ?? 0n;
}

function getPreviewOrderBookShares(preview: RouterPreview): bigint {
  return preview.orderBookSharesWad ?? preview[2] ?? 0n;
}

function getPreviewMmShares(preview: RouterPreview): bigint {
  return preview.mmSharesWad ?? preview[3] ?? 0n;
}

function getPreviewCost(preview: RouterPreview): bigint {
  return preview.costWei ?? preview[4] ?? 0n;
}

function getPreviewProceeds(preview: RouterPreview): bigint {
  return preview.proceedsWei ?? preview[5] ?? 0n;
}

async function previewRouterTrade(
  router: ethers.Contract,
  market: string,
  outcome: number,
  side: 0 | 1,
  sharesWad: bigint,
  maxHops = 0,
): Promise<RouterPreview> {
  return await router.previewTrade(market, outcome, side, sharesWad, maxHops) as RouterPreview;
}

async function findBuySharesForBudget(
  router: ethers.Contract,
  market: string,
  outcome: number,
  budgetWei: bigint,
): Promise<{ sharesWad: bigint; preview: RouterPreview | null }> {
  if (budgetWei <= 0n) return { sharesWad: 0n, preview: null };

  try {
    const preview = await router.previewBuyForAmount(market, outcome, budgetWei, 0) as RouterPreview;
    const sharesWad = getPreviewShares(preview);
    const costWei = getPreviewCost(preview);
    if (sharesWad > 0n && costWei > 0n) return { sharesWad, preview };
  } catch {
    // Fall back for routers deployed before amount-based preview helpers.
  }

  let low = 0n;
  let high = budgetWei;
  let maxTradeSharesWad: bigint | null = null;
  try {
    maxTradeSharesWad = await router.maxTradeSharesWad() as bigint;
    if (maxTradeSharesWad > 0n && high > maxTradeSharesWad) high = maxTradeSharesWad;
  } catch {
    // Older routers may not expose the cap; preview calls will still enforce it.
  }
  try {
    const unitPreview = await previewRouterTrade(router, market, outcome, 0, WAD);
    const unitCost = getPreviewCost(unitPreview);
    if (unitCost > 0n) {
      high = (budgetWei * WAD) / unitCost;
      if (high < 1n) high = 1n;
      if (maxTradeSharesWad !== null && maxTradeSharesWad > 0n && high > maxTradeSharesWad) high = maxTradeSharesWad;
    }
  } catch {
    // Fall back to 1 USDC ~= 1 share as an upper bound.
  }
  let bestShares = 0n;
  let bestPreview: RouterPreview | null = null;

  for (let i = 0; i < 36; i++) {
    const mid = (low + high + 1n) / 2n;
    if (mid <= 0n) break;
    try {
      const preview = await previewRouterTrade(router, market, outcome, 0, mid);
      const costWei = getPreviewCost(preview);
      const filledShares = getPreviewShares(preview);
      if (filledShares === mid && costWei > 0n && costWei <= budgetWei) {
        bestShares = mid;
        bestPreview = preview;
        low = mid;
      } else {
        high = mid - 1n;
      }
    } catch {
      high = mid - 1n;
    }
  }

  return { sharesWad: bestShares, preview: bestPreview };
}

async function findSellSharesForTarget(
  router: ethers.Contract,
  market: string,
  outcome: number,
  targetWei: bigint,
  maxSharesWad: bigint,
): Promise<{ sharesWad: bigint; preview: RouterPreview | null }> {
  if (targetWei <= 0n || maxSharesWad <= 0n) return { sharesWad: 0n, preview: null };

  try {
    const preview = await router.previewSellForAmount(market, outcome, targetWei, maxSharesWad, 0) as RouterPreview;
    const sharesWad = getPreviewShares(preview);
    const proceedsWei = getPreviewProceeds(preview);
    if (sharesWad > 0n && proceedsWei > 0n) return { sharesWad, preview };
  } catch {
    // Fall back for routers deployed before amount-based preview helpers.
  }

  let low = 0n;
  let high = maxSharesWad;
  try {
    const maxTradeSharesWad = await router.maxTradeSharesWad() as bigint;
    if (maxTradeSharesWad > 0n && high > maxTradeSharesWad) high = maxTradeSharesWad;
  } catch {
    // Older routers may not expose the cap; preview calls will still enforce it.
  }
  let bestShares = 0n;
  let bestPreview: RouterPreview | null = null;
  let smallestTargetShares = 0n;
  let smallestTargetPreview: RouterPreview | null = null;

  for (let i = 0; i < 36; i++) {
    const mid = (low + high + 1n) / 2n;
    if (mid <= 0n) break;
    try {
      const preview = await previewRouterTrade(router, market, outcome, 1, mid);
      const proceedsWei = getPreviewProceeds(preview);
      const filledShares = getPreviewShares(preview);
      if (filledShares === 0n || proceedsWei === 0n) {
        high = mid - 1n;
        continue;
      }
      if (proceedsWei < targetWei) {
        bestShares = mid;
        bestPreview = preview;
        low = mid;
      } else {
        smallestTargetShares = mid;
        smallestTargetPreview = preview;
        high = mid - 1n;
      }
    } catch {
      high = mid - 1n;
    }
  }

  if (smallestTargetPreview) return { sharesWad: smallestTargetShares, preview: smallestTargetPreview };
  return { sharesWad: bestShares, preview: bestPreview };
}

function buildTradeHistory(detailData: MarketDetailData, events: TradeEvent[]): ProbHistoryPoint[] {
  const outcomeCount = detailData.outcomeLabels.length;
  if (events.length === 0 || outcomeCount === 0) return [];

  const lastPrices: Array<number | null> = detailData.outcomeLabels.map(() => null);
  const history: ProbHistoryPoint[] = [];

  for (const event of events) {
    if (event.outcomeIndex >= outcomeCount || event.priceWad === 0n) continue;
    const tradedPrice = Number(ethers.formatEther(event.priceWad)) * 100;
    lastPrices[event.outcomeIndex] = tradedPrice;

    const point: ProbHistoryPoint = { time: event.timestamp };
    detailData.outcomeLabels.forEach((label, i) => {
      const value = lastPrices[i];
      if (value !== null) point[label] = Number(value.toFixed(1));
    });
    history.push(point);
  }

  return history;
}

function parseUserLimitOrder(order: Record<string, unknown>): UserLimitOrder {
  return {
    id: order.id as bigint,
    market: order.market as string,
    outcome: Number(order.outcome),
    owner: order.owner as string,
    side: Number(order.side) as 0 | 1,
    priceWad: order.priceWad as bigint,
    remainingSharesWad: order.remainingSharesWad as bigint,
    escrowWei: order.escrowWei as bigint,
    expiry: Number(order.expiry),
    active: Boolean(order.active),
    originalSharesWad: order.originalSharesWad as bigint,
    status: Number(order.status),
  };
}

function ensureMetaTag(kind: 'name' | 'property', key: string): HTMLMetaElement {
  const selector = `meta[${kind}="${key}"]`;
  const existing = document.head.querySelector(selector);
  if (existing instanceof HTMLMetaElement) return existing;
  const meta = document.createElement('meta');
  meta.setAttribute(kind, key);
  document.head.appendChild(meta);
  return meta;
}

function setMetaTag(kind: 'name' | 'property', key: string, value: string): void {
  const meta = ensureMetaTag(kind, key);
  meta.setAttribute('content', value);
}

function setCanonicalUrl(url: string): void {
  const existing = document.head.querySelector('link[rel="canonical"]');
  if (existing instanceof HTMLLinkElement) {
    existing.href = url;
    return;
  }
  const link = document.createElement('link');
  link.rel = 'canonical';
  link.href = url;
  document.head.appendChild(link);
}

function formatLivePrice(price: number): string {
  if (!Number.isFinite(price)) return '--';
  const abs = Math.abs(price);
  if (abs >= 1000) {
    return price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (abs >= 1) {
    return price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  }
  return price.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 8 });
}

function formatLiveAge(iso: string): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return 'unknown';
  const seconds = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatLiveMetric(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '--';
  return formatCompact(value);
}

function formatCryptoPrimaryMetric(data: {
  metric: 'price' | 'market-cap' | 'volume-24h';
  price: number;
  marketCap: number | null;
  volume24h: number | null;
}): string {
  if (data.metric === 'market-cap') return formatLiveMetric(data.marketCap);
  if (data.metric === 'volume-24h') return formatLiveMetric(data.volume24h);
  return formatLivePrice(data.price);
}

function formatCryptoPrimaryLabel(metric: 'price' | 'market-cap' | 'volume-24h'): string {
  if (metric === 'market-cap') return 'Market Cap';
  if (metric === 'volume-24h') return '24h Volume';
  return 'Price';
}

function formatCryptoPrimaryChangeLabel(metric: 'price' | 'market-cap' | 'volume-24h'): string {
  if (metric === 'market-cap') return '24h price change';
  if (metric === 'volume-24h') return '24h price change';
  return '24h change';
}

export default function MarketDetail() {
  const { slug } = useParams<{ slug: string }>();
  const marketId = slug ? parseMarketSlug(slug) : null;
  const { address: userAddress, signer, readProvider, isConnected, isCorrectNetwork } = useWallet();

  const [marketAddress, setMarketAddress] = useState<string | null>(null);
  const [detail, setDetail] = useState<MarketDetailData | null>(null);
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [probHistory, setProbHistory] = useState<ProbHistoryPoint[]>([]);
  const [recentTrades, setRecentTrades] = useState<TradeEvent[]>([]);
  const [accurateVolume, setAccurateVolume] = useState<bigint | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Trade state
  const [executionMode, setExecutionMode] = useState<'instant' | 'limit'>('instant');
  const [showAdvancedTrade, setShowAdvancedTrade] = useState(false);
  const [tradeTab, setTradeTab] = useState<'buy' | 'sell'>('buy');
  const [selectedOutcome, setSelectedOutcome] = useState(0);
  const [usdcAmount, setUsdcAmount] = useState('');
  const [limitPrice, setLimitPrice] = useState('');
  const [limitExpiryMinutes, setLimitExpiryMinutes] = useState('1440');
  const [allowPartialFill, setAllowPartialFill] = useState(false);
  const [estimatedShares, setEstimatedShares] = useState<number | null>(null);
  const [previewFilledSharesWad, setPreviewFilledSharesWad] = useState<bigint>(0n);
  const [previewCost, setPreviewCost] = useState<bigint | null>(null);
  const [executionSource, setExecutionSource] = useState('');
  const [orderBookBids, setOrderBookBids] = useState<DepthLevel[]>([]);
  const [orderBookAsks, setOrderBookAsks] = useState<DepthLevel[]>([]);
  const [mmQuote, setMmQuote] = useState<MMQuoteState | null>(null);
  const [orderBookLoading, setOrderBookLoading] = useState(false);
  const [userOrders, setUserOrders] = useState<UserLimitOrder[]>([]);
  const [userOrdersLoading, setUserOrdersLoading] = useState(false);
  const [cancellingOrderId, setCancellingOrderId] = useState<bigint | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewKey, setPreviewKey] = useState('');
  const [txPending, setTxPending] = useState(false);
  const [txMessage, setTxMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const txMessageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [poolBalance, setPoolBalance] = useState<bigint>(0n);
  const [showMainFrame, setShowMainFrame] = useState(false);
  const [mainLinkPreview, setMainLinkPreview] = useState<LinkPreviewData | null>(null);
  const [mainLinkPreviewLoading, setMainLinkPreviewLoading] = useState(false);
  const [mainLinkPreviewError, setMainLinkPreviewError] = useState<string | null>(null);
  const [hoveredImage, setHoveredImage] = useState<number | null>(null);
  const [aboutExpanded, setAboutExpanded] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [userBalance, setUserBalance] = useState<bigint | null>(null);
  const [hasProfile, setHasProfile] = useState(false);
  const [liveData, setLiveData] = useState<LiveMarketDataResponse | null>(null);
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const hasLoadedOnce = useRef(false);
  const requestSeqRef = useRef(0);
  const prevMarketIdRef = useRef<number | null>(null);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 768) {
        setAboutExpanded(true);
      } else {
        setAboutExpanded(false);
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (txMessage) {
      if (txMessageTimer.current) clearTimeout(txMessageTimer.current);
      if (txMessage.type !== 'error') {
        txMessageTimer.current = setTimeout(() => setTxMessage(null), 5000);
      }
    }
    return () => {
      if (txMessageTimer.current) clearTimeout(txMessageTimer.current);
    };
  }, [txMessage]);

  useEffect(() => {
    if (marketId !== prevMarketIdRef.current) {
      prevMarketIdRef.current = marketId;
      if (marketId === null) {
        setLoading(false);
        setError('Invalid market link');
        setDetail(null);
        setMarketAddress(null);
        return;
      }
      hasLoadedOnce.current = false;
      setLoading(true);
      setDetail(null);
      setUserInfo(null);
      setMarketAddress(null);
      setError(null);
      setProbHistory([]);
      setRecentTrades([]);
      setAccurateVolume(null);
      setSelectedOutcome(0);
      setShowAdvancedTrade(false);
      setExecutionMode('instant');
      setUsdcAmount('');
      setMmQuote(null);
      setEstimatedShares(null);
      setPreviewFilledSharesWad(0n);
      setPreviewCost(null);
      setPreviewKey('');
      setUserOrders([]);
      setLiveData(null);
      setLiveLoading(false);
      setLiveError(null);
    }
  }, [marketId]);

  const fetchAll = useCallback(async () => {
    if (marketId === null) return;

    const seq = ++requestSeqRef.current;

    const attemptFetch = async (): Promise<void> => {
      const factory = new ethers.Contract(HYBRID_FACTORY_ADDRESS, HYBRID_FACTORY_ABI, readProvider);
      const lens = new ethers.Contract(HYBRID_LENS_ADDRESS, HYBRID_LENS_ABI, readProvider);
      const addr = await factory.markets(BigInt(marketId));
      if (!addr || addr === ethers.ZeroAddress) {
        throw new Error('Market not found');
      }
      if (seq !== requestSeqRef.current) return;
      setMarketAddress(addr);

      const d = await lens.getMarketDetail(addr);
      if (seq !== requestSeqRef.current) return;

      const parsed: MarketDetailData = {
        market: d.market, title: d.title, description: d.description,
        category: d.category, imageUri: d.imageUri, proofUri: d.proofUri,
        outcomeLabels: [...d.outcomeLabels], totalSharesWad: [...d.totalSharesWad],
        impliedProbabilitiesWad: [...d.impliedProbabilitiesWad],
        stage: Number(d.stage), winningOutcome: Number(d.winningOutcome),
        createdAt: Number(d.createdAt), marketDeadline: Number(d.marketDeadline),
        resolutionTime: Number(d.resolutionTime),
        bWad: d.bWad, totalVolumeWei: d.totalVolumeWei,
        participants: Number(d.participants), mode: Number(d.mode ?? 1), resolvedPoolWei: d.resolvedPoolWei,
        cancelReason: d.cancelReason || '', cancelProofUri: d.cancelProofUri || '',
        resolutionSource: d.resolutionSource || '',
        fallbackResolutionSource: d.fallbackResolutionSource || '',
        invalidCondition: d.invalidCondition || '',
        resolutionManager: d.resolutionManager || ethers.ZeroAddress,
      };
      setDetail(parsed);
      setError(null);

      const [bal, uInfo] = await Promise.all([
        readProvider.getBalance(addr).catch(() => parsed.totalVolumeWei),
        userAddress
          ? new ethers.Contract(addr, MARKET_V2_ABI, readProvider).getUserInfo(userAddress).catch(() => null)
          : Promise.resolve(null),
      ]);
      if (seq !== requestSeqRef.current) return;

      setPoolBalance(bal);

      if (uInfo) {
        setUserInfo({
          shares: [...uInfo._shares],
          redeemed: uInfo._redeemed,
          canRedeem: uInfo._canRedeem,
        });
      } else {
        setUserInfo(null);
      }
    };

    if (!hasLoadedOnce.current) setLoading(true);

    const maxAttempts = 4;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (seq !== requestSeqRef.current) return;
      try {
        await attemptFetch();
        if (seq !== requestSeqRef.current) return;
        hasLoadedOnce.current = true;
        setLoading(false);
        return;
      } catch (err) {
        if (seq !== requestSeqRef.current) return;
        console.error(`Market fetch attempt ${attempt}/${maxAttempts} failed:`, err);
        const isNotFound = err instanceof Error && err.message === 'Market not found';
        if (isNotFound || attempt === maxAttempts) {
          setError(isNotFound ? 'Market not found' : 'Failed to load market details. The RPC may be slow — try again.');
          hasLoadedOnce.current = true;
          setLoading(false);
          return;
        }
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 4000);
        console.log(`Retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }, [marketId, userAddress, readProvider]);

  const refreshData = useCallback(async () => {
    if (!marketAddress) return;
    try {
      const lens = new ethers.Contract(HYBRID_LENS_ADDRESS, HYBRID_LENS_ABI, readProvider);
      const d = await lens.getMarketDetail(marketAddress);

      const parsed = {
        market: d.market, title: d.title, description: d.description,
        category: d.category, imageUri: d.imageUri, proofUri: d.proofUri,
        outcomeLabels: [...d.outcomeLabels], totalSharesWad: [...d.totalSharesWad],
        impliedProbabilitiesWad: [...d.impliedProbabilitiesWad],
        stage: Number(d.stage), winningOutcome: Number(d.winningOutcome),
        createdAt: Number(d.createdAt), marketDeadline: Number(d.marketDeadline),
        resolutionTime: Number(d.resolutionTime),
        bWad: d.bWad, totalVolumeWei: d.totalVolumeWei,
        participants: Number(d.participants), mode: Number(d.mode ?? 1), resolvedPoolWei: d.resolvedPoolWei,
        cancelReason: d.cancelReason || '', cancelProofUri: d.cancelProofUri || '',
        resolutionSource: d.resolutionSource || '',
        fallbackResolutionSource: d.fallbackResolutionSource || '',
        invalidCondition: d.invalidCondition || '',
        resolutionManager: d.resolutionManager || ethers.ZeroAddress,
      };
      setDetail(parsed);

      const [bal, uInfo] = await Promise.all([
        readProvider.getBalance(marketAddress).catch(() => parsed.totalVolumeWei),
        userAddress
          ? new ethers.Contract(marketAddress, MARKET_V2_ABI, readProvider).getUserInfo(userAddress).catch(() => null)
          : Promise.resolve(null),
      ]);

      setPoolBalance(bal);

      if (uInfo) {
        setUserInfo({
          shares: [...uInfo._shares],
          redeemed: uInfo._redeemed,
          canRedeem: uInfo._canRedeem,
        });
      } else {
        setUserInfo(null);
      }
    } catch (err) {
      console.error('Failed to refresh market data:', err);
    }
  }, [marketAddress, userAddress, readProvider]);

  const fetchProbHistory = useCallback(async (addr: string, detailData: MarketDetailData) => {
    try {
      const events = await fetchTradeEvents(addr);
      setAccurateVolume(computeVolumeFromEvents(events));
      setRecentTrades(events.slice(-12).reverse());
      setProbHistory(buildTradeHistory(detailData, events));
    } catch (err) {
      console.error('Failed to fetch prob history from BlockScout:', err);
      setProbHistory([]);
    }
  }, []);

  useEffect(() => {
    if (!marketAddress || !detail) return;

    let cancelled = false;
    let pollInFlight = false;
    let timeoutId: ReturnType<typeof setTimeout>;

    const poll = async () => {
      if (pollInFlight || cancelled) return;
      pollInFlight = true;
      try {
        const events = await fetchTradeEvents(marketAddress);
        if (cancelled) return;
        const newVolume = computeVolumeFromEvents(events);
        setAccurateVolume(newVolume);
        setRecentTrades(events.slice(-12).reverse());
        if (!cancelled) setProbHistory(buildTradeHistory(detail, events));
      } catch (err) {
        console.error('Background poll failed:', err);
      } finally {
        pollInFlight = false;
      }
      if (!cancelled) timeoutId = setTimeout(poll, 15000);
    };

    timeoutId = setTimeout(poll, 15000);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [marketAddress, detail?.market, detail?.outcomeLabels, detail?.impliedProbabilitiesWad, detail?.createdAt]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    if (!marketAddress) {
      setOrderBookBids([]);
      setOrderBookAsks([]);
      setMmQuote(null);
      return;
    }

    let cancelled = false;
    const fetchDepth = async () => {
      setOrderBookLoading(true);
      try {
        const orderBook = new ethers.Contract(ORDER_BOOK_ADDRESS, ORDER_BOOK_ABI, readProvider);
        const market = new ethers.Contract(marketAddress, MARKET_V2_ABI, readProvider);
        const [bidDepth, askDepth, mmState] = await Promise.all([
          orderBook.getDepth(marketAddress, selectedOutcome, 0, 10),
          orderBook.getDepth(marketAddress, selectedOutcome, 1, 10),
          market.getMMOutcomeState(selectedOutcome).catch(() => null),
        ]);
        if (cancelled) return;
        const parseDepth = (depth: DepthResult): DepthLevel[] => {
          const prices: bigint[] = depth.pricesWad ?? depth[0] ?? [];
          const shares: bigint[] = depth.sharesWad ?? depth[1] ?? [];
          return prices
            .map((price: bigint, i: number) => ({ price, shares: shares[i] || 0n }))
            .filter((level: DepthLevel) => level.price > 0n && level.shares > 0n);
        };
        setOrderBookBids(parseDepth(bidDepth));
        setOrderBookAsks(parseDepth(askDepth));
        setMmQuote(mmState ? {
          initialSharesWad: mmState.initialSharesWad ?? mmState[0],
          availableSharesWad: mmState.availableSharesWad ?? mmState[1],
          soldSharesWad: mmState.soldSharesWad ?? mmState[2],
          reserveWei: mmState.reserveWei ?? mmState[3],
          bidPriceWad: mmState.bidPriceWad ?? mmState[4],
          askPriceWad: mmState.askPriceWad ?? mmState[5],
        } : null);
      } catch (err) {
        if (!cancelled) {
          setOrderBookBids([]);
          setOrderBookAsks([]);
          setMmQuote(null);
        }
      } finally {
        if (!cancelled) setOrderBookLoading(false);
      }
    };

    void fetchDepth();
  }, [marketAddress, selectedOutcome, refreshTrigger, readProvider]);

  useEffect(() => {
    if (!marketAddress || !userAddress || !isConnected) {
      setUserOrders([]);
      setUserOrdersLoading(false);
      return;
    }

    let cancelled = false;
    const fetchOrders = async () => {
      setUserOrdersLoading(true);
      try {
        const orderBook = new ethers.Contract(ORDER_BOOK_ADDRESS, ORDER_BOOK_ABI, readProvider);
        const orders = await orderBook.getUserOrders(userAddress, marketAddress, true, 0, 200);
        if (cancelled) return;
        setUserOrders((orders as Array<Record<string, unknown>>)
          .map(parseUserLimitOrder)
          .filter((order) => order.active && order.remainingSharesWad > 0n)
          .sort((a, b) => Number(a.id - b.id)));
      } catch (err) {
        console.error('Failed to fetch user orders:', err);
        if (!cancelled) setUserOrders([]);
      } finally {
        if (!cancelled) setUserOrdersLoading(false);
      }
    };

    void fetchOrders();
    return () => {
      cancelled = true;
    };
  }, [marketAddress, userAddress, isConnected, refreshTrigger, readProvider]);

  useEffect(() => {
    if (!marketAddress) {
      setLiveData(null);
      setLiveLoading(false);
      setLiveError(null);
      return;
    }

    let cancelled = false;
    let inFlight = false;
    let scheduleTimeoutId: ReturnType<typeof setTimeout> | undefined;
    let abortTimeoutId: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    let hasRequestedStageRefresh = false;

    const schedule = (seconds: number) => {
      if (cancelled) return;
      scheduleTimeoutId = setTimeout(() => {
        void poll(false);
      }, Math.max(5, seconds) * 1000);
    };

    const poll = async (initial: boolean) => {
      if (cancelled || inFlight) return;
      inFlight = true;
      if (initial) setLiveLoading(true);

      controller = new AbortController();
      const FETCH_TIMEOUT_MS = 12000;

      abortTimeoutId = setTimeout(() => {
        if (controller) {
          controller.abort();
        }
      }, FETCH_TIMEOUT_MS);

      try {
        const data = await fetchLiveMarketData(marketAddress, controller.signal);
        if (cancelled) return;
        setLiveData(data);
        setLiveError(null);
        if (data.configured && data.finalSnapshot && !hasRequestedStageRefresh) {
          hasRequestedStageRefresh = true;
          void refreshData();
        }
        if (!data.configured || !data.finalSnapshot) {
          const next = data.configured
            ? (data.refreshFailed ? 30 : Math.max(5, data.nextSuggestedPollSeconds || 15))
            : 30;
          schedule(next);
        }
      } catch (err) {
        if (cancelled) return;
        setLiveData((prev) => {
          if (!prev?.configured) return prev;
          return {
            ...prev,
            stale: true,
            refreshFailed: true,
          };
        });
        const message = err instanceof Error ? err.message : 'Failed to load live reference data.';
        setLiveError(message);
        schedule(30);
      } finally {
        if (abortTimeoutId !== undefined) {
          clearTimeout(abortTimeoutId);
          abortTimeoutId = undefined;
        }
        controller = undefined;
        inFlight = false;
        if (!cancelled) setLiveLoading(false);
      }
    };

    void poll(true);

    return () => {
      cancelled = true;
      if (scheduleTimeoutId !== undefined) {
        clearTimeout(scheduleTimeoutId);
      }
      if (abortTimeoutId !== undefined) {
        clearTimeout(abortTimeoutId);
      }
      if (controller) {
        controller.abort();
      }
    };
  }, [marketAddress, refreshData]);

  useEffect(() => {
    if (!userAddress || !isConnected) { setUserBalance(null); setHasProfile(false); return; }
    let cancelled = false;
    const fetchBalance = async () => {
      try {
        const bal = await readProvider.getBalance(userAddress);
        if (!cancelled) setUserBalance(bal);
      } catch { /* ignore */ }
    };
    const checkProfile = async () => {
      try {
        const resp = await fetchProfileByAddress(userAddress);
        if (!cancelled) setHasProfile(!!resp.profile);
      } catch {
        if (!cancelled) setHasProfile(false);
      }
    };
    fetchBalance();
    checkProfile();
    const interval = setInterval(fetchBalance, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [userAddress, isConnected, readProvider, refreshTrigger]);

  useEffect(() => {
    if (detail && marketAddress) {
      fetchProbHistory(marketAddress, detail);
    }
  }, [detail?.market, refreshTrigger]); // eslint-disable-line react-hooks/exhaustive-deps

  const proofInfo = parseProofLinks(detail?.proofUri ?? '');

  useEffect(() => {
    const isResolvedStage = detail?.stage === STAGE.Resolved;
    const link = proofInfo.mainLink?.trim();
    if (!isResolvedStage || !link) {
      setMainLinkPreview(null);
      setMainLinkPreviewError(null);
      setMainLinkPreviewLoading(false);
      return;
    }

    let cancelled = false;
    setMainLinkPreviewLoading(true);
    setMainLinkPreviewError(null);

    fetchLinkPreview(link)
      .then((preview) => {
        if (cancelled) return;
        setMainLinkPreview(preview);
      })
      .catch((err) => {
        if (cancelled) return;
        setMainLinkPreview(null);
        setMainLinkPreviewError(err instanceof Error ? err.message : 'Preview unavailable.');
      })
      .finally(() => {
        if (!cancelled) setMainLinkPreviewLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [detail?.stage, proofInfo.mainLink]);

  useEffect(() => {
    if (!detail || !slug) return;

    const baseUrl = window.location.origin;
    const marketUrl = `${baseUrl}/market/${slug}`;
    const defaultImage = `${baseUrl}/og.png`;
    const title = `${detail.title} | AchMarket`;
    const descriptionSource = parseDescription(detail.description).description;
    const description = (descriptionSource || DEFAULT_META_DESCRIPTION).slice(0, 180);

    document.title = title;
    setMetaTag('name', 'description', description);
    setMetaTag('property', 'og:title', title);
    setMetaTag('property', 'og:description', description);
    setMetaTag('property', 'og:type', 'website');
    setMetaTag('property', 'og:url', marketUrl);
    setMetaTag('property', 'og:image', defaultImage);
    setMetaTag('name', 'twitter:card', 'summary_large_image');
    setMetaTag('name', 'twitter:title', title);
    setMetaTag('name', 'twitter:description', description);
    setMetaTag('name', 'twitter:image', defaultImage);
    setCanonicalUrl(marketUrl);

    return () => {
      const homeUrl = `${baseUrl}/`;
      const defaultImage = `${baseUrl}/og.png`;
      document.title = DEFAULT_META_TITLE;
      setMetaTag('name', 'description', DEFAULT_META_DESCRIPTION);
      setMetaTag('property', 'og:title', DEFAULT_META_TITLE);
      setMetaTag('property', 'og:description', DEFAULT_META_DESCRIPTION);
      setMetaTag('property', 'og:url', homeUrl);
      setMetaTag('property', 'og:image', defaultImage);
      setMetaTag('name', 'twitter:title', DEFAULT_META_TITLE);
      setMetaTag('name', 'twitter:description', DEFAULT_META_DESCRIPTION);
      setMetaTag('name', 'twitter:image', defaultImage);
      setCanonicalUrl(homeUrl);
    };
  }, [detail, slug]);

  const currentInputKey = `${executionMode}:${tradeTab}:${selectedOutcome}:${usdcAmount}:${limitPrice}`;
  const tradeUsdcWei = safeParseAmount(usdcAmount);

  // Preview
  useEffect(() => {
    const inputKey = currentInputKey;
    setPreviewLoading(true);
    const timer = setTimeout(async () => {
      const usdcWei = safeParseAmount(usdcAmount);
      if (usdcWei <= 0n) {
        setPreviewCost(null);
        setEstimatedShares(null);
        setPreviewFilledSharesWad(0n);
        setExecutionSource('');
        setPreviewKey('');
        setPreviewLoading(false);
        return;
      }
      if (executionMode === 'limit') {
        const priceWad = safeParseAmount(limitPrice);
        const sharesWad = calculateSharesFromUsdc(usdcWei, priceWad);
        setPreviewCost(usdcWei);
        setEstimatedShares(sharesWad > 0n ? Number(ethers.formatEther(sharesWad)) : null);
        setPreviewFilledSharesWad(sharesWad);
        setExecutionSource('');
        setPreviewKey(inputKey);
        setPreviewLoading(false);
        return;
      }
      if (tradeTab === 'buy') {
        if (!detail || !marketAddress) { setEstimatedShares(null); setPreviewFilledSharesWad(0n); setPreviewLoading(false); return; }
        try {
          const router = new ethers.Contract(MARKET_ROUTER_ADDRESS, MARKET_ROUTER_ABI, readProvider);
          const { preview } = await findBuySharesForBudget(router, marketAddress, selectedOutcome, usdcWei);
          if (!preview) throw new Error('No buy liquidity');
          const filledSharesWad = getPreviewShares(preview);
          const filledShares = Number(ethers.formatEther(filledSharesWad));
          const costWei = getPreviewCost(preview);
          setPreviewFilledSharesWad(filledSharesWad);
          setEstimatedShares(filledShares > 0 && costWei > 0n ? filledShares : null);
          setPreviewCost(filledShares > 0 && costWei > 0n ? costWei : null);
          const mmShares = getPreviewMmShares(preview);
          const orderBookShares = getPreviewOrderBookShares(preview);
          setExecutionSource(mmShares > 0n
            ? `${formatWad(orderBookShares)} CLOB + ${formatWad(mmShares)} MM`
            : `${formatWad(orderBookShares)} CLOB`);
          setPreviewKey(inputKey);
        } catch {
          setEstimatedShares(null);
          setPreviewCost(null);
          setPreviewFilledSharesWad(0n);
          setExecutionSource('');
          setPreviewKey(inputKey);
        } finally {
          setPreviewLoading(false);
        }
      } else {
        if (!marketAddress) { setPreviewCost(null); setPreviewFilledSharesWad(0n); setPreviewLoading(false); return; }
        try {
          const router = new ethers.Contract(MARKET_ROUTER_ADDRESS, MARKET_ROUTER_ABI, readProvider);
          const maxShares = userInfo?.shares[selectedOutcome] ?? 0n;
          const { preview } = await findSellSharesForTarget(router, marketAddress, selectedOutcome, usdcWei, maxShares);
          if (!preview) throw new Error('No sell liquidity');
          const proceedsWei = getPreviewProceeds(preview);
          const filledShares = getPreviewShares(preview);
          setPreviewFilledSharesWad(filledShares);
          setPreviewCost(filledShares > 0n && proceedsWei > 0n ? proceedsWei : null);
          const mmShares = getPreviewMmShares(preview);
          const orderBookShares = getPreviewOrderBookShares(preview);
          setExecutionSource(mmShares > 0n
            ? `${formatWad(orderBookShares)} CLOB + ${formatWad(mmShares)} MM`
            : `${formatWad(orderBookShares)} CLOB`);
          setEstimatedShares(null);
          setPreviewKey(inputKey);
        } catch {
          setPreviewCost(null);
          setPreviewFilledSharesWad(0n);
          setExecutionSource('');
          setPreviewKey(inputKey);
        } finally {
          setPreviewLoading(false);
        }
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [marketAddress, usdcAmount, selectedOutcome, tradeTab, executionMode, limitPrice, readProvider, detail, userInfo]);

  const refreshAfterTransaction = useCallback(async () => {
    await refreshData();
    setRefreshTrigger(c => c + 1);
    window.setTimeout(() => {
      void refreshData();
      setRefreshTrigger(c => c + 1);
    }, 3500);
  }, [refreshData]);

  const handleBuy = async () => {
    if (!signer || !marketAddress || estimatedShares === null || !usdcAmount || !previewCost) return;
    setTxPending(true); setTxMessage(null);
    const outcomeName = detail?.outcomeLabels[selectedOutcome] || `Outcome ${selectedOutcome}`;
    try {
      const router = new ethers.Contract(MARKET_ROUTER_ADDRESS, MARKET_ROUTER_ABI, signer);
      const sharesWad = previewFilledSharesWad;
      if (sharesWad <= 0n) throw new Error('Enter a higher USDC amount or choose another outcome.');
      const minSharesOut = allowPartialFill ? 1n : sharesWad;
      const maxCost = safeParseAmount(usdcAmount);
      if (maxCost < previewCost) throw new Error('Refresh the quote and try again.');
      const deadline = Math.floor(Date.now() / 1000) + 300;
      const tx = await router.buy(marketAddress, selectedOutcome, sharesWad, minSharesOut, maxCost, 0, deadline, { value: maxCost });
      showToast({ type: 'pending', title: `Buying ${outcomeName}...`, message: `${formatUSDC(previewCost)} USDC submitted`, txHash: tx.hash });
      setTxMessage({ type: 'success', text: 'Transaction submitted. Waiting for confirmation...' });
      await tx.wait();
      showToast({ type: 'success', title: `Bought ${outcomeName}`, message: `${formatWad(sharesWad)} shares for ~${formatUSDC(previewCost)} USDC`, txHash: tx.hash });
      setTxMessage({ type: 'success', text: 'Shares purchased successfully!' });
      setUsdcAmount(''); setEstimatedShares(null); setPreviewFilledSharesWad(0n);
      await refreshAfterTransaction();
    } catch (err) {
      const errMsg = parseContractError(err);
      showToast({ type: 'error', title: `Buy ${outcomeName} Failed`, message: errMsg });
      setTxMessage({ type: 'error', text: errMsg });
    } finally { setTxPending(false); }
  };

  const handleSell = async () => {
    if (!signer || !marketAddress || !previewCost || !usdcAmount) return;
    setTxPending(true); setTxMessage(null);
    const outcomeName = detail?.outcomeLabels[selectedOutcome] || `Outcome ${selectedOutcome}`;
    try {
      const router = new ethers.Contract(MARKET_ROUTER_ADDRESS, MARKET_ROUTER_ABI, signer);
      const sharesWad = previewFilledSharesWad;
      if (sharesWad <= 0n) throw new Error('No sellable shares found for that USDC amount.');
      const minSharesOut = allowPartialFill ? 1n : sharesWad;
      const minReceive = safeParseAmount(usdcAmount);
      if (previewCost < minReceive) throw new Error('That USDC receive target is unavailable right now.');
      const deadline = Math.floor(Date.now() / 1000) + 300;
      const tx = await router.sell(marketAddress, selectedOutcome, sharesWad, minSharesOut, minReceive, 0, deadline);
      showToast({ type: 'pending', title: `Selling ${outcomeName}...`, message: `${formatUSDC(previewCost)} USDC target submitted`, txHash: tx.hash });
      setTxMessage({ type: 'success', text: 'Transaction submitted. Waiting for confirmation...' });
      await tx.wait();
      showToast({ type: 'success', title: `Sold ${outcomeName}`, message: `${formatWad(sharesWad)} shares for ~${formatUSDC(previewCost)} USDC`, txHash: tx.hash });
      setTxMessage({ type: 'success', text: 'Shares sold successfully!' });
      setUsdcAmount('');
      await refreshAfterTransaction();
    } catch (err) {
      const errMsg = parseContractError(err);
      showToast({ type: 'error', title: `Sell ${outcomeName} Failed`, message: errMsg });
      setTxMessage({ type: 'error', text: errMsg });
    } finally { setTxPending(false); }
  };

  const handlePlaceLimitOrder = async () => {
    if (!signer || !marketAddress || !usdcAmount || !limitPrice) return;
    setTxPending(true); setTxMessage(null);
    const outcomeName = detail?.outcomeLabels[selectedOutcome] || `Outcome ${selectedOutcome}`;
    try {
      const orderBook = new ethers.Contract(ORDER_BOOK_ADDRESS, ORDER_BOOK_ABI, signer);
      const usdcWei = safeParseAmount(usdcAmount);
      const priceWad = safeParseAmount(limitPrice);
      const sharesWad = calculateSharesFromUsdc(usdcWei, priceWad);
      if (sharesWad <= 0n) throw new Error('Enter a USDC amount and limit price.');
      const expiryMinutes = Math.max(0, Math.floor(parseFloat(limitExpiryMinutes || '0')));
      const expiry = expiryMinutes > 0 ? Math.floor(Date.now() / 1000) + expiryMinutes * 60 : 0;
      const side = tradeTab === 'buy' ? 0 : 1;
      const escrow: bigint = tradeTab === 'buy' ? (sharesWad * priceWad) / WAD : 0n;
      const value = tradeTab === 'buy' ? applyBuySlippage(escrow, 1) : 0n;
      const tx = await orderBook.placeLimitOrder(marketAddress, selectedOutcome, side, priceWad, sharesWad, expiry, { value });
      showToast({ type: 'pending', title: `Placing ${tradeTab === 'buy' ? 'bid' : 'ask'}...`, message: `${formatUSDC(value || usdcWei)} USDC of ${outcomeName} at ${limitPrice}`, txHash: tx.hash });
      setTxMessage({ type: 'success', text: 'Limit order submitted. Waiting for confirmation...' });
      await tx.wait();
      showToast({ type: 'success', title: 'Limit Order Placed', message: `${outcomeName} order is live on the CLOB`, txHash: tx.hash });
      setTxMessage({ type: 'success', text: 'Limit order placed successfully.' });
      setUsdcAmount('');
      await refreshAfterTransaction();
    } catch (err) {
      const errMsg = parseContractError(err);
      showToast({ type: 'error', title: 'Limit Order Failed', message: errMsg });
      setTxMessage({ type: 'error', text: errMsg });
    } finally { setTxPending(false); }
  };

  const handleCancelOrder = async (orderId: bigint) => {
    if (!signer) return;
    setCancellingOrderId(orderId);
    setTxMessage(null);
    try {
      const orderBook = new ethers.Contract(ORDER_BOOK_ADDRESS, ORDER_BOOK_ABI, signer);
      const tx = await orderBook.cancelOrder(orderId);
      showToast({ type: 'pending', title: 'Cancelling Order...', message: `Order #${orderId.toString()} submitted`, txHash: tx.hash });
      setTxMessage({ type: 'success', text: `Cancel submitted for order #${orderId.toString()}.` });
      await tx.wait();
      showToast({ type: 'success', title: 'Order Cancelled', message: `Order #${orderId.toString()} is no longer open`, txHash: tx.hash });
      setTxMessage({ type: 'success', text: `Order #${orderId.toString()} cancelled.` });
      await refreshAfterTransaction();
    } catch (err) {
      const errMsg = parseContractError(err);
      showToast({ type: 'error', title: 'Cancel Failed', message: errMsg });
      setTxMessage({ type: 'error', text: errMsg });
    } finally {
      setCancellingOrderId(null);
    }
  };

  const handleRedeem = async () => {
    if (!signer || !marketAddress) return;
    setTxPending(true); setTxMessage(null);
    try {
      const market = new ethers.Contract(marketAddress, MARKET_V2_ABI, signer);
      const tx = await market.redeem();
      showToast({ type: 'pending', title: 'Claiming Winnings...', message: 'Transaction submitted', txHash: tx.hash });
      setTxMessage({ type: 'success', text: 'Redeem transaction submitted...' });
      await tx.wait();
      showToast({ type: 'success', title: 'Winnings Claimed!', message: 'Your winnings have been sent to your wallet', txHash: tx.hash });
      setTxMessage({ type: 'success', text: 'Winnings claimed successfully!' });
      await refreshAfterTransaction();
    } catch (err) {
      const errMsg = parseContractError(err);
      showToast({ type: 'error', title: 'Claim Failed', message: errMsg });
      setTxMessage({ type: 'error', text: errMsg });
    } finally { setTxPending(false); }
  };

  const handleRefund = async () => {
    if (!signer || !marketAddress) return;
    setTxPending(true); setTxMessage(null);
    try {
      const market = new ethers.Contract(marketAddress, MARKET_V2_ABI, signer);
      const tx = await market.redeem();
      showToast({ type: 'pending', title: 'Claiming Refund...', message: 'Transaction submitted', txHash: tx.hash });
      setTxMessage({ type: 'success', text: 'Refund transaction submitted...' });
      await tx.wait();
      showToast({ type: 'success', title: 'Refund Claimed!', message: 'Your deposit has been returned to your wallet', txHash: tx.hash });
      setTxMessage({ type: 'success', text: 'Refund claimed successfully!' });
      await refreshAfterTransaction();
    } catch (err) {
      const errMsg = parseContractError(err);
      showToast({ type: 'error', title: 'Refund Failed', message: errMsg });
      setTxMessage({ type: 'error', text: errMsg });
    } finally { setTxPending(false); }
  };

  const handleTriggerExpiry = async () => {
    if (!signer || !marketAddress) return;
    setTxPending(true); setTxMessage(null);
    try {
      const market = new ethers.Contract(marketAddress, MARKET_V2_ABI, signer);
      const tx = await market.triggerExpiry();
      showToast({ type: 'pending', title: 'Triggering Expiry...', message: 'Transaction submitted', txHash: tx.hash });
      setTxMessage({ type: 'success', text: 'Expiry transaction submitted...' });
      await tx.wait();
      showToast({ type: 'success', title: 'Market Expired', message: 'Refunds are now available for all participants', txHash: tx.hash });
      setTxMessage({ type: 'success', text: 'Market expired! Refunds are now available.' });
      await refreshAfterTransaction();
    } catch (err) {
      const errMsg = parseContractError(err);
      showToast({ type: 'error', title: 'Expiry Failed', message: errMsg });
      setTxMessage({ type: 'error', text: errMsg });
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
        <div className="flex items-center justify-center gap-4 mt-4">
          <button
            onClick={() => { hasLoadedOnce.current = false; setError(null); setLoading(true); fetchAll(); }}
            className="px-4 py-2 rounded-xl bg-primary-600 hover:bg-primary-500 text-white text-sm font-semibold transition-colors"
          >
            Try Again
          </button>
          <Link to="/" className="text-sm text-primary-400 hover:text-primary-300 transition-colors">Back to Markets</Link>
        </div>
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
  const resolutionDeadline = detail.resolutionTime + 3 * 24 * 60 * 60;
  const inGracePeriod = isActive && tradingEnded && now <= resolutionDeadline;

  let estimatedPayout: bigint | null = null;
  let totalPositionPayout: bigint | null = null;
  let multiplier = 0;
  let avgPrice = 0;
  let profit = 0;
  const hasExistingShares = userInfo?.shares[selectedOutcome] && userInfo.shares[selectedOutcome] > 0n;
  if (estimatedShares !== null && usdcAmount && tradeTab === 'buy' && previewCost !== null) {
    const sharesWad = previewFilledSharesWad;
    const costWei = previewCost;
    if (sharesWad > 0n && costWei > 0n) {
      estimatedPayout = sharesWad;
      multiplier = Number(estimatedPayout) / Number(costWei);
      avgPrice = estimatedShares > 0 ? Number(ethers.formatEther(costWei)) / estimatedShares : 0;
      profit = Number(estimatedPayout - costWei) / 1e18;
      if (hasExistingShares) {
        totalPositionPayout = userInfo!.shares[selectedOutcome] + sharesWad;
      }
    }
  }

  const parsedAbout = parseDescription(detail?.description ?? '');
  const selectedOutcomeLabel = detail.outcomeLabels[selectedOutcome] ?? `Outcome ${selectedOutcome + 1}`;
  const selectedOutcomePriceWad = detail.impliedProbabilitiesWad[selectedOutcome] ?? 0n;
  const selectedOutcomePrice = Number(ethers.formatEther(selectedOutcomePriceWad));
  const selectedOwnedShares = userInfo?.shares[selectedOutcome] ?? 0n;
  const selectedLimitPriceValue = limitPrice ? Number(limitPrice) : null;
  const liveConfigured = liveData && liveData.configured ? liveData : null;
  const limitPriceWad = safeParseAmount(limitPrice);
  const limitSharesWad = calculateSharesFromUsdc(tradeUsdcWei, limitPriceWad);
  const buyUnfilledWei = executionMode === 'instant'
    && tradeTab === 'buy'
    && tradeUsdcWei > 0n
    && previewCost !== null
    && previewCost < tradeUsdcWei
    ? tradeUsdcWei - previewCost
    : 0n;
  const meaningfulBuyDustWei = tradeUsdcWei / 100n > 10_000_000_000_000n
    ? tradeUsdcWei / 100n
    : 10_000_000_000_000n;
  const isPreviewPartial = executionMode === 'instant'
    && tradeUsdcWei > 0n
    && previewCost !== null
    && tradeTab === 'buy'
    && buyUnfilledWei > meaningfulBuyDustWei
    && previewFilledSharesWad > 0n
    && previewKey === currentInputKey;
  const sellReceiveShortfallWei = executionMode === 'instant'
    && tradeTab === 'sell'
    && tradeUsdcWei > 0n
    && previewCost !== null
    && previewCost < tradeUsdcWei
    ? tradeUsdcWei - previewCost
    : 0n;
  const sellTargetUnavailable = executionMode === 'instant'
    && tradeTab === 'sell'
    && tradeUsdcWei > 0n
    && !previewLoading
    && previewKey === currentInputKey
    && sellReceiveShortfallWei > 10_000_000_000_000n;
  const noSellLiquidity = executionMode === 'instant'
    && tradeTab === 'sell'
    && tradeUsdcWei > 0n
    && !previewLoading
    && previewKey === currentInputKey
    && previewCost === null;
  const buyLiquidityInsufficient = executionMode === 'instant'
    && tradeTab === 'buy'
    && tradeUsdcWei > 0n
    && !previewLoading
    && previewKey === currentInputKey
    && (previewCost === null || (isPreviewPartial && !allowPartialFill));
  const limitNotionalWei = limitSharesWad > 0n && limitPriceWad > 0n ? tradeUsdcWei : 0n;
  const limitPayoutWei = limitSharesWad;
  const buyAvgPriceWad = previewCost !== null && previewFilledSharesWad > 0n
    ? (previewCost * WAD) / previewFilledSharesWad
    : 0n;
  const sellAvgPriceWad = previewCost !== null && previewFilledSharesWad > 0n
    ? (previewCost * WAD) / previewFilledSharesWad
    : 0n;
  const sellAvgPrice = previewCost !== null && tradeUsdcWei > 0n
    ? Number(ethers.formatEther(previewCost)) / Math.max(Number(ethers.formatEther(previewFilledSharesWad || limitSharesWad)), 0.0000001)
    : 0;
  const buyPriceImpactPct = buyAvgPriceWad > 0n && selectedOutcomePriceWad > 0n
    ? ((Number(ethers.formatEther(buyAvgPriceWad)) / selectedOutcomePrice) - 1) * 100
    : 0;
  const sellPriceImpactPct = sellAvgPriceWad > 0n && selectedOutcomePriceWad > 0n
    ? (1 - (Number(ethers.formatEther(sellAvgPriceWad)) / selectedOutcomePrice)) * 100
    : 0;
  return (
    <div className="min-h-screen animate-fade-in">
      <div className="relative overflow-hidden">
        <ImageWithFallback src={detail.imageUri} alt={detail.title} className="h-48 sm:h-56 lg:h-64 w-full" />
        <div className="absolute inset-0 bg-gradient-to-t from-dark-950 via-dark-950/50 to-dark-950/5" />

        <div className="absolute top-4 left-4 right-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-dark-900/70 backdrop-blur-sm border border-white/[0.1] text-sm text-dark-200 hover:text-white transition-colors group">
            <svg className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Markets
          </Link>
          <div className="flex items-center gap-2">
            <span className={`badge ${STAGE_COLORS[detail.stage]} backdrop-blur-sm`}>{STAGE_LABELS[detail.stage]}</span>
            <span className="badge bg-dark-900/70 text-dark-200 border-white/[0.1] backdrop-blur-sm">{detail.category}</span>
          </div>
        </div>

        <div className="absolute bottom-0 left-0 right-0 p-4 sm:p-6 lg:p-8">
          <div className="max-w-7xl mx-auto">
            <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-white leading-tight max-w-3xl drop-shadow-lg">{detail.title}</h1>
          </div>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="max-w-[1600px] mx-auto px-4 pt-5 md:pt-6 pb-8">
        <div className="mb-5 md:mb-6 card p-4 sm:p-5 bg-gradient-to-br from-primary-500/[0.08] via-transparent to-emerald-500/[0.06] border-primary-500/20">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <p className="text-2xs uppercase tracking-[0.14em] text-white/45 font-semibold mb-1">Trade Panel</p>
              <h2 className="text-lg sm:text-xl font-semibold text-white">Make your position before market close</h2>
              <p className="text-xs text-white/60 mt-1">
                Pick an outcome, enter a USDC amount, and review the shares before confirming.
              </p>
            </div>
            {isActive && !tradingEnded ? (
              <div className="px-3.5 py-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-xs font-semibold inline-flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                Trading Open
              </div>
            ) : (
              <div className="px-3.5 py-2 rounded-xl border border-white/[0.12] bg-white/[0.04] text-white/70 text-xs font-semibold inline-flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-white/50" />
                Trading Closed
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[1fr_420px] lg:gap-6">
          {/* Left Column — Market Info (scrollable) */}
          <div className="order-2 space-y-4 md:space-y-5 lg:order-1">
            {/* Quick stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <MiniStat label="Volume" value={`${formatCompactUSDC(detail.totalVolumeWei)}`} suffix="USDC" icon={<UsdcIcon size={14} />} />
              <MiniStat label="Traders" value={detail.participants.toString()} />
              <MiniStat label="Created" value={formatDate(detail.createdAt)} small />
              <MiniStat label={isActive ? 'Ends' : 'Ended'} value={formatDate(detail.marketDeadline)} small />
            </div>

            <div className="card p-4 border-primary-500/20 bg-gradient-to-br from-primary-500/[0.08] via-transparent to-emerald-500/[0.05]">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div>
                  <p className="text-2xs uppercase tracking-[0.14em] text-white/45 font-semibold">Live Reference</p>
                  <p className="text-xs text-white/70 mt-1">
                    {liveConfigured
                      ? liveConfigured.data.kind === 'crypto-price'
                        ? `${liveConfigured.data.baseSymbol}/${liveConfigured.data.quoteSymbol} ${formatCryptoPrimaryLabel(liveConfigured.data.metric).toLowerCase()} feed`
                        : `${liveConfigured.data.leagueName || 'Sports'} live score feed`
                      : liveData && !liveData.configured
                        ? 'This market resolves without an external reference feed'
                        : liveError
                          ? 'Error loading feed'
                          : 'Loading feed...'}
                  </p>
                </div>
                {liveData && !liveData.configured ? (
                  <span className="badge bg-dark-750/80 text-dark-300 border-white/[0.08]">No Feed</span>
                ) : liveError ? (
                  <span className="badge bg-red-500/15 text-red-400 border-red-500/25">Error</span>
                ) : !liveConfigured ? (
                  <span className="badge bg-dark-750/80 text-dark-400 border-white/[0.08]">Loading</span>
                ) : liveConfigured.finalSnapshot ? (
                  <span className="badge bg-cyan-500/15 text-cyan-300 border-cyan-500/25">Final Snapshot</span>
                ) : liveConfigured.effectiveStatus === 'upcoming' ? (
                  <span className="badge bg-purple-500/15 text-purple-400 border-purple-500/25">Upcoming</span>
                ) : liveConfigured.stale ? (
                  <span className="badge bg-amber-500/15 text-amber-400 border-amber-500/25">Delayed</span>
                ) : (
                  <span className="badge bg-emerald-500/15 text-emerald-400 border-emerald-500/25">Live</span>
                )}
              </div>

              {!liveConfigured && liveLoading && (
                <p className="text-xs text-dark-400">Loading live data...</p>
              )}

              {!liveConfigured && !liveLoading && (
                <p className="text-xs text-dark-400">
                  {liveData && !liveData.configured
                    ? (liveData.reason || 'This market does not use an external reference feed.')
                    : (liveError || 'This market does not use an external reference feed.')}
                </p>
              )}

              {liveConfigured && liveConfigured.data.kind === 'crypto-price' && (
                <div className="space-y-2">
                  <div className="flex items-end justify-between gap-2">
                    <p className="text-xl sm:text-2xl font-bold text-white tabular-nums leading-none">
                      {formatCryptoPrimaryMetric(liveConfigured.data)}
                      <span className="text-sm text-white/60 ml-1">{liveConfigured.data.quoteSymbol}</span>
                    </p>
                    <div className="text-right">
                      <p className={`text-sm font-semibold tabular-nums ${
                        liveConfigured.data.change24h === null
                          ? 'text-dark-400'
                          : liveConfigured.data.change24h >= 0
                            ? 'text-emerald-400'
                            : 'text-red-400'
                      }`}>
                        {liveConfigured.data.change24h === null
                          ? '--'
                          : `${liveConfigured.data.change24h >= 0 ? '+' : ''}${liveConfigured.data.change24h.toFixed(2)}%`}
                      </p>
                      <p className="text-2xs text-dark-500">{formatCryptoPrimaryChangeLabel(liveConfigured.data.metric)}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div className="rounded-lg bg-dark-900/40 border border-white/[0.08] px-2.5 py-2">
                      <p className="text-2xs text-dark-500">Market Cap</p>
                      <p className="text-xs font-semibold text-white tabular-nums mt-0.5">
                        {formatLiveMetric(liveConfigured.data.marketCap)} {liveConfigured.data.quoteSymbol}
                      </p>
                    </div>
                    <div className="rounded-lg bg-dark-900/40 border border-white/[0.08] px-2.5 py-2">
                      <p className="text-2xs text-dark-500">24h Volume</p>
                      <p className="text-xs font-semibold text-white tabular-nums mt-0.5">
                        {formatLiveMetric(liveConfigured.data.volume24h)} {liveConfigured.data.quoteSymbol}
                      </p>
                    </div>
                  </div>
                  {liveConfigured.data.sparkline && liveConfigured.data.sparkline.length > 0 && (
                    <div className="h-24 w-full mt-4 -mx-1">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={liveConfigured.data.sparkline.map((price, index) => ({ index, price }))}>
                          <defs>
                            <linearGradient id="colorSparkline" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor={liveConfigured.data.sparkline[0] <= liveConfigured.data.sparkline[liveConfigured.data.sparkline.length - 1] ? '#10b981' : '#ef4444'} stopOpacity={0.3}/>
                              <stop offset="95%" stopColor={liveConfigured.data.sparkline[0] <= liveConfigured.data.sparkline[liveConfigured.data.sparkline.length - 1] ? '#10b981' : '#ef4444'} stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <Area 
                            type="monotone" 
                            dataKey="price" 
                            stroke={liveConfigured.data.sparkline[0] <= liveConfigured.data.sparkline[liveConfigured.data.sparkline.length - 1] ? '#10b981' : '#ef4444'} 
                            strokeWidth={2}
                            fillOpacity={1} 
                            fill="url(#colorSparkline)" 
                            isAnimationActive={false}
                          />
                          <YAxis domain={['dataMin', 'dataMax']} hide />
                          <Tooltip 
                            content={({ active, payload }) => {
                              if (active && payload && payload.length) {
                                return (
                                  <div className="bg-dark-800 border border-white/[0.1] px-2 py-1 rounded text-xs text-white tabular-nums shadow-xl">
                                    {Number(payload[0].value).toLocaleString(undefined, { maximumFractionDigits: 6 })}
                                  </div>
                                );
                              }
                              return null;
                            }}
                            cursor={{ stroke: 'rgba(255,255,255,0.1)', strokeWidth: 1, strokeDasharray: '4 4' }}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-2xs text-dark-500 pt-2 border-t border-white/[0.08]">
                    <span>Source: {liveConfigured.data.provider}</span>
                    <span>Updated {formatLiveAge(liveConfigured.fetchedAt)}</span>
                  </div>
                </div>
              )}

              {liveConfigured && liveConfigured.data.kind === 'sports-score' && (
                <div className="space-y-2.5">
                  {liveConfigured.effectiveStatus === 'upcoming' && liveConfigured.data.kickoffAt && (
                    <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/20 text-sm text-purple-300">
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        Match starts {new Date(liveConfigured.data.kickoffAt).toLocaleString()}
                      </div>
                      <p className="text-2xs text-purple-400/80 mt-1">Live Score will begin when the match starts</p>
                    </div>
                  )}
                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                    <div className="min-w-0 text-left flex flex-col items-start">
                      <p className="text-xs text-dark-400 uppercase tracking-wider mb-1">Home</p>
                      {liveConfigured.data.homeLogo ? (
                        <img src={liveConfigured.data.homeLogo} alt={liveConfigured.data.homeTeam} className="w-10 h-10 object-contain mb-1" />
                      ) : null}
                      <p className="text-sm sm:text-base font-semibold text-white truncate w-full">{liveConfigured.data.homeTeam}</p>
                    </div>
                    <div className="text-center px-2 flex flex-col items-center justify-center">
                      <p className="text-2xl sm:text-3xl font-bold text-white tabular-nums leading-none">
                        {liveConfigured.data.homeScore ?? '-'}
                        <span className="text-white/35 mx-1">-</span>
                        {liveConfigured.data.awayScore ?? '-'}
                      </p>
                      <p className="text-2xs text-dark-500 mt-1">{liveConfigured.data.statusLabel}</p>
                    </div>
                    <div className="min-w-0 text-right flex flex-col items-end">
                      <p className="text-xs text-dark-400 uppercase tracking-wider mb-1">Away</p>
                      {liveConfigured.data.awayLogo ? (
                        <img src={liveConfigured.data.awayLogo} alt={liveConfigured.data.awayTeam} className="w-10 h-10 object-contain mb-1" />
                      ) : null}
                      <p className="text-sm sm:text-base font-semibold text-white truncate w-full">{liveConfigured.data.awayTeam}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-2xs text-dark-500 pt-2 border-t border-white/[0.08]">
                    <span>Source: {liveConfigured.data.provider}</span>
                    <span>Updated {formatLiveAge(liveConfigured.fetchedAt)}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Countdown (active) */}
            {isActive && !tradingEnded && (
              <div className="card p-4 flex items-center justify-between">
                <span className="text-xs text-dark-400 font-semibold uppercase tracking-wider flex items-center gap-2">
                  <svg className="w-3.5 h-3.5 text-primary-400/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Time Remaining
                </span>
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
                      Trading has ended. Resolution proposals can be finalized until {formatDate(resolutionDeadline)} before expiry.
                      If not resolved, the market will auto-expire and all participants can claim full refunds.
                    </p>
                    <div className="mt-2.5 flex items-center gap-2">
                      <span className="text-2xs text-dark-500 font-medium">Resolution deadline:</span>
                      <Countdown deadline={resolutionDeadline} compact className="text-xs text-amber-400 font-medium" />
                    </div>
                  </div>
                </div>
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

            {/* Resolution proof */}
            {isResolved && detail.proofUri && (() => {
              const proof = proofInfo;
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
                      {proof.image ? (
                        <div className="mb-3">
                          <p className="text-2xs font-medium text-emerald-500/70 uppercase tracking-wider mb-1.5">Proof Image</p>
                          <div className="proof-image-container inline-block max-w-full overflow-hidden rounded-lg border border-white/[0.06]">
                            <a href={resolveImageUri(proof.image)} target="_blank" rel="noopener noreferrer">
                              <img
                                src={resolveImageUri(proof.image)}
                                alt="Resolution proof"
                                className="block max-w-full max-h-48 sm:max-h-64 w-auto h-auto object-contain bg-dark-800 hover:opacity-80 transition-opacity cursor-pointer"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display = 'none';
                                  const wrapper = (e.target as HTMLElement).closest('.proof-image-container');
                                  const fallback = wrapper?.querySelector('.proof-image-fallback');
                                  if (fallback) (fallback as HTMLElement).style.display = 'flex';
                                }}
                              />
                            </a>
                          </div>
                          {proof.raw && (
                            <a
                              href={resolveImageUri(proof.raw)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="proof-image-fallback hidden text-sm text-emerald-300 hover:text-emerald-200 items-center gap-2 transition-colors mt-1.5 break-all"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                              </svg>
                              {proof.raw.length > 60 ? proof.raw.slice(0, 60) + '...' : proof.raw}
                            </a>
                          )}
                        </div>
                      ) : proof.mainLink ? (
                        <div className="mb-3">
                          <p className="text-2xs font-medium text-emerald-500/70 uppercase tracking-wider mb-1.5">Proof Link</p>
                          <a
                            href={resolveImageUri(proof.mainLink)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-emerald-300 hover:text-emerald-200 inline-flex items-center gap-2 transition-colors"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                            Open Proof
                          </a>
                        </div>
                      ) : null}
                      
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
                             mainLinkPreviewLoading ? (
                               <div className="w-full h-64 rounded-lg border border-white/[0.06] bg-dark-900/60 flex items-center justify-center">
                                 <p className="text-xs text-dark-400">Checking iframe support...</p>
                               </div>
                             ) : mainLinkPreview && !mainLinkPreview.embeddable ? (
                               <div className="w-full rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 space-y-2">
                                 <p className="text-xs font-semibold text-amber-300">This site blocks iframe embedding.</p>
                                 <p className="text-2xs text-amber-200/80">
                                   {mainLinkPreview.embedBlockReason || 'The target site sends security headers that prevent preview in an iframe.'}
                                 </p>
                                 <a
                                   href={resolveImageUri(mainLinkStr)}
                                   target="_blank"
                                   rel="noopener noreferrer"
                                   className="inline-flex items-center gap-1.5 text-xs text-amber-200 hover:text-amber-100"
                                 >
                                   <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                     <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                   </svg>
                                   Open in new tab
                                 </a>
                               </div>
                             ) : (
                               <div className="space-y-2">
                                 <iframe
                                   src={resolveImageUri(mainLinkStr)}
                                   className="w-full h-64 rounded-lg border border-white/[0.06] bg-dark-900"
                                   title="Main proof"
                                   sandbox="allow-same-origin allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-pointer-lock allow-top-navigation-by-user-activation allow-downloads"
                                   referrerPolicy="no-referrer-when-downgrade"
                                 />
                                 <p className="text-2xs text-dark-500">
                                   If frame stays blank, that site blocks embedding. Use the preview card/open link below.
                                 </p>
                               </div>
                             )
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

                      {proof.mainLink && (
                        <div className="mt-3 p-3 rounded-lg border border-white/[0.08] bg-dark-900/50">
                          <p className="text-2xs font-medium text-emerald-500/70 uppercase tracking-wider mb-2">Link Preview</p>
                          {mainLinkPreviewLoading ? (
                            <p className="text-xs text-dark-400">Loading preview...</p>
                          ) : mainLinkPreview ? (
                            <a
                              href={mainLinkPreview.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="group block rounded-lg border border-white/[0.08] bg-dark-850/70 overflow-hidden hover:border-emerald-400/30 transition-colors"
                            >
                              {mainLinkPreview.image && (
                                <div className="w-full h-36 bg-dark-800 overflow-hidden">
                                  <img
                                    src={resolveImageUri(mainLinkPreview.image)}
                                    alt={mainLinkPreview.title || 'Preview image'}
                                    className="w-full h-full object-cover"
                                    onError={(e) => {
                                      (e.target as HTMLImageElement).style.display = 'none';
                                    }}
                                  />
                                </div>
                              )}
                              <div className="p-3">
                                <p className="text-xs text-dark-500 mb-1">{mainLinkPreview.siteName}</p>
                                <p className="text-sm font-semibold text-white group-hover:text-emerald-300 transition-colors line-clamp-2">
                                  {mainLinkPreview.title || 'Open proof link'}
                                </p>
                                {mainLinkPreview.description && (
                                  <p className="text-xs text-dark-400 mt-1 line-clamp-2">{mainLinkPreview.description}</p>
                                )}
                              </div>
                            </a>
                          ) : (
                            <p className="text-xs text-dark-400">
                              {mainLinkPreviewError || 'Preview unavailable for this link.'}
                            </p>
                          )}
                        </div>
                      )}
                      
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

            {/* Resolved pool info */}
            {isResolved && detail.resolvedPoolWei > 0n && (() => {
              const winningShares = detail.totalSharesWad[detail.winningOutcome] > 0n ? detail.totalSharesWad[detail.winningOutcome] : 0n;
              const poolBackedPayout = winningShares > 0n ? (detail.resolvedPoolWei * WAD) / winningShares : 0n;
              const payoutPerShare = poolBackedPayout > WAD ? WAD : poolBackedPayout;
              return (
                <div className="card p-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="text-2xs text-dark-500 font-medium uppercase tracking-wider">Claimable Pool</span>
                      <p className="text-base font-bold text-white mt-0.5 flex items-center gap-1.5"><UsdcIcon size={16} />{formatCompactUSDC(detail.resolvedPoolWei)} USDC</p>
                    </div>
                    <div>
                      <span className="text-2xs text-dark-500 font-medium uppercase tracking-wider">Payout / Winning Share</span>
                      <p className="text-base font-bold text-emerald-400 mt-0.5 flex items-center gap-1.5"><UsdcIcon size={16} />{formatUSDC(payoutPerShare)} USDC</p>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Probability history chart */}
            {probHistory.length > 0 ? (
              <ProbabilityChart
                history={probHistory}
                outcomeLabels={detail.outcomeLabels}
                createdAt={detail.createdAt}
              />
            ) : (
              <div className="card p-5 border border-white/[0.08]">
                <h2 className="section-header mb-2">Price History</h2>
                <p className="text-xs text-dark-400">No executed trades yet. The chart starts when a real fill is recorded.</p>
              </div>
            )}

            {/* About / Description - collapsible */}
            {detail.description && (
              <div className="card overflow-hidden">
                <button 
                  onClick={() => setAboutExpanded(!aboutExpanded)}
                  className="w-full p-5 pb-4 flex items-center justify-between hover:bg-dark-800/30 transition-colors"
                >
                  <h2 className="section-header">About</h2>
                  <svg 
                    className={`w-4 h-4 text-dark-500 transition-transform ${aboutExpanded ? 'rotate-180' : ''}`} 
                    fill="none" 
                    viewBox="0 0 24 24" 
                    stroke="currentColor" 
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {aboutExpanded && (
                  <div className="px-5 pb-5">
                    <p className="text-sm text-dark-300 leading-relaxed whitespace-pre-wrap">{parsedAbout.description}</p>
                  </div>
                )}
                {!aboutExpanded && (
                  <div className="px-5 pb-5">
                    <p className="text-sm text-dark-500">
                      {parsedAbout.description && parsedAbout.description.length > 80
                        ? parsedAbout.description.slice(0, 80) + '...'
                        : parsedAbout.description}
                    </p>
                    <span className="text-xs text-[#00d46a] mt-2 inline-flex items-center gap-1">
                      Tap to read more
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Market Chat */}
            {marketAddress && (
              <ChatThread
                marketAddress={marketAddress}
                userAddress={userAddress}
                signer={signer}
                isConnected={isConnected}
                hasProfile={hasProfile}
              />
            )}
          </div>

          {/* Right Column — Trade Panel (sticky) */}
          <div className="order-1 space-y-4 lg:sticky lg:top-20 lg:order-2 lg:self-start lg:space-y-5">
            {/* Outcome Probabilities Card */}
            <div className="card p-5 border-primary-500/20 bg-gradient-to-br from-primary-500/[0.06] to-transparent">
              <div className="flex items-end justify-between gap-3 mb-4">
                <div>
                  <h2 className="section-header mb-1">Live Odds</h2>
                  <p className="text-2xs text-white/50">Current market pricing across all outcomes</p>
                </div>
                <span className="text-2xs px-2 py-1 rounded-md border border-white/[0.1] bg-white/[0.03] text-white/65">
                  {detail.outcomeLabels.length} outcomes
                </span>
              </div>
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
                    <div key={i} className={`p-3.5 rounded-xl text-center transition-all ${isWinner ? 'bg-emerald-500/10 border border-emerald-500/20' : color.light} relative overflow-hidden`}>
                      <p className="text-2xs text-dark-400 font-semibold uppercase tracking-wider mb-1.5">{label}</p>
                      <p className={`text-xl sm:text-2xl font-bold tabular-nums leading-none ${isWinner ? 'text-emerald-400' : color.text}`}>
                        {pct.toFixed(1)}%
                      </p>
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 p-3 rounded-xl border border-white/[0.08] bg-dark-900/45">
                <p className="text-2xs uppercase tracking-[0.12em] text-white/45 font-semibold mb-1">Selected Outcome</p>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-white truncate">{selectedOutcomeLabel}</p>
                  <span className="text-sm font-bold text-emerald-300 tabular-nums">${selectedOutcomePrice.toFixed(2)}</span>
                </div>
              </div>
            </div>

            {/* Trade Panel */}
            {isActive && !tradingEnded && isConnected && isCorrectNetwork && (
              <div className="card p-4 sm:p-5 border-white/[0.12] bg-gradient-to-b from-white/[0.035] to-transparent shadow-[0_16px_46px_rgba(0,0,0,0.45)]">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="mb-1.5 inline-flex items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-2xs font-semibold uppercase tracking-[0.12em] text-emerald-300">
                      <Zap className="h-3 w-3" />
                      Simple Trade
                    </div>
                    <h3 className="text-lg font-bold text-white">Buy or sell in seconds</h3>
                    <p className="mt-1 text-xs leading-relaxed text-white/55">
                      Pick a side, choose an outcome, enter USDC, then review the shares before confirming.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const next = !showAdvancedTrade;
                      setShowAdvancedTrade(next);
                      if (!next) {
                        setExecutionMode('instant');
                        setLimitPrice('');
                      }
                    }}
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition-all ${
                      showAdvancedTrade
                        ? 'border-cyan-400/30 bg-cyan-400/10 text-cyan-200'
                        : 'border-white/[0.08] bg-dark-900/55 text-white/65 hover:text-white'
                    }`}
                    aria-expanded={showAdvancedTrade}
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                    Advanced
                    {showAdvancedTrade ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </button>
                </div>

                {showAdvancedTrade && (
                  <>
                    <div className="grid grid-cols-2 gap-2 mb-3">
                      <button
                        onClick={() => { setExecutionMode('instant'); setUsdcAmount(''); setPreviewCost(null); setEstimatedShares(null); setPreviewFilledSharesWad(0n); }}
                        className={`p-2.5 rounded-xl text-xs font-semibold border transition-all ${
                          executionMode === 'instant'
                            ? 'bg-primary-500/15 text-primary-300 border-primary-500/30'
                            : 'bg-dark-900/40 text-dark-400 border-white/[0.08] hover:text-white'
                        }`}
                      >
                        Instant
                      </button>
                      <button
                        onClick={() => { setExecutionMode('limit'); setUsdcAmount(''); setPreviewCost(null); setEstimatedShares(null); setPreviewFilledSharesWad(0n); }}
                        className={`p-2.5 rounded-xl text-xs font-semibold border transition-all ${
                          executionMode === 'limit'
                            ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                            : 'bg-dark-900/40 text-dark-400 border-white/[0.08] hover:text-white'
                        }`}
                      >
                        Limit Order
                      </button>
                    </div>

                    <div className="mb-5 rounded-xl border border-white/[0.08] bg-dark-900/35 p-3">
                      <div className="flex items-start gap-2">
                        <Layers3 className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300/80" />
                        <div>
                          <p className="text-2xs uppercase tracking-[0.12em] text-white/45 font-semibold mb-1">
                            {executionMode === 'instant' ? 'Best available liquidity' : 'Manual limit order'}
                          </p>
                          <p className="text-xs text-white/60">
                            {executionMode === 'instant'
                              ? detail.mode === 1
                                ? 'Fills the order book first, then uses instant liquidity only if needed.'
                                : 'Fills immediately against available order book liquidity.'
                              : 'Matches immediately when possible. Any remaining size rests in the book.'}
                          </p>
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {/* Buy/Sell tabs */}
                <div className="flex rounded-2xl bg-dark-900/70 p-1 mb-5 border border-white/[0.06]">
                  <button
                    onClick={() => { setTradeTab('buy'); setUsdcAmount(''); setPreviewCost(null); setEstimatedShares(null); setPreviewFilledSharesWad(0n); }}
                    className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all ${
                      tradeTab === 'buy' ? 'bg-emerald-500 text-white shadow-glow-yes' : 'text-dark-400 hover:text-dark-200'
                    }`}
                  >
                    Buy
                  </button>
                  <button
                    onClick={() => { setTradeTab('sell'); setUsdcAmount(''); setPreviewCost(null); setEstimatedShares(null); setPreviewFilledSharesWad(0n); }}
                    className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all ${
                      tradeTab === 'sell' ? 'bg-red-500 text-white shadow-glow-no' : 'text-dark-400 hover:text-dark-200'
                    }`}
                  >
                    Sell
                  </button>
                </div>

                {/* Outcome selector */}
                <div className="mb-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-2xs font-semibold uppercase tracking-[0.14em] text-white/45">Choose outcome</span>
                    <span className="text-2xs text-dark-500">Tap one</span>
                  </div>
                  <div className="grid gap-2">
                  {detail.outcomeLabels.map((label, i) => {
                    const userShares = userInfo?.shares[i] || 0n;
                    const pct = probToPercent(detail.impliedProbabilitiesWad[i]);
                    const isSelected = selectedOutcome === i;
                    const color = getOutcomeColor(i);
                    const colorHexMap: Record<string, string> = {
                      'bg-[#00d46a]': '#00d46a',
                      'bg-red-500': '#ef4444',
                      'bg-blue-500': '#3b82f6',
                      'bg-purple-500': '#a855f7',
                      'bg-orange-500': '#f97316',
                      'bg-cyan-500': '#06b6d4',
                    };
                    const hexColor = colorHexMap[color.bg] || '#3b82f6';
                    return (
                      <button
                        key={i}
                        onClick={() => setSelectedOutcome(i)}
                        className={`w-full min-h-[4.25rem] p-3 rounded-2xl text-sm transition-all border relative flex items-center justify-between ${
                          isSelected
                            ? 'shadow-[0_14px_34px_rgba(0,0,0,0.24)]'
                            : 'border-white/[0.08] bg-dark-900/45 hover:border-white/[0.16]'
                        }`}
                        style={isSelected ? {
                          borderColor: `${hexColor}70`,
                          backgroundColor: `${hexColor}14`,
                        } : {}}
                      >
                        <div className="flex min-w-0 items-center gap-3 text-left">
                          <span
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border text-xs font-bold"
                            style={{
                              borderColor: isSelected ? `${hexColor}66` : 'rgba(255,255,255,0.1)',
                              color: isSelected ? hexColor : 'rgba(255,255,255,0.45)',
                              backgroundColor: isSelected ? `${hexColor}18` : 'rgba(255,255,255,0.03)',
                            }}
                          >
                            {i + 1}
                          </span>
                          <div className="min-w-0">
                            <span className={`block truncate font-bold ${isSelected ? '' : 'text-white/65'}`} style={isSelected ? { color: hexColor } : {}}>{label}</span>
                            {tradeTab === 'sell' && userShares > 0n && (
                              <span className="mt-0.5 block text-2xs text-dark-400">You hold {formatWad(userShares)} shares</span>
                            )}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <span className="block text-lg font-black tabular-nums leading-none" style={isSelected ? { color: hexColor } : { color: 'rgba(255,255,255,0.55)' }}>
                            {pct.toFixed(0)}%
                          </span>
                          <span className="mt-1 block text-2xs text-dark-500">
                            ${Number(pct / 100).toFixed(2)}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 mb-4">
                  <div className="rounded-2xl border border-white/[0.08] bg-dark-900/45 p-3">
                    <p className="text-2xs text-white/45 uppercase tracking-[0.12em]">Selected</p>
                    <p className="mt-1 truncate text-sm font-bold text-white">{selectedOutcomeLabel}</p>
                  </div>
                  <div className="rounded-2xl border border-white/[0.08] bg-dark-900/45 p-3">
                    <p className="text-2xs text-white/45 uppercase tracking-[0.12em]">You Hold</p>
                    <p className="mt-1 text-sm font-bold text-white tabular-nums">{formatWad(selectedOwnedShares)}</p>
                  </div>
                </div>

                {showAdvancedTrade && (
                  <div className="mb-4 rounded-2xl border border-white/[0.08] bg-[#060b11]/80 overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06]">
                      <div>
                        <p className="text-2xs uppercase tracking-[0.12em] text-white/45 font-semibold">CLOB Depth</p>
                        <p className="text-xs text-white/65">FIFO price levels for {selectedOutcomeLabel}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 px-3 py-2 text-2xs uppercase tracking-[0.12em] text-dark-500 border-b border-white/[0.06]">
                      <span>Price</span>
                      <span className="text-right">Shares</span>
                      <span className="text-right">Total</span>
                    </div>
                    <div className="max-h-56 overflow-hidden">
                      {orderBookLoading ? (
                        <p className="px-3 py-5 text-xs text-dark-500 text-center">Loading order book...</p>
                      ) : (
                        <>
                          <DepthRows
                            levels={[...orderBookAsks].reverse()}
                            side="ask"
                            selectedPrice={selectedLimitPriceValue}
                            onSelectLevel={(price, shares, priceWad) => {
                              setTradeTab('buy');
                              setLimitPrice(price.toFixed(2));
                              setUsdcAmount(formatInputWad(calculateUsdcFromShares(shares, priceWad)));
                              setExecutionMode('limit');
                            }}
                          />
                          <div className="px-3 py-2 border-y border-white/[0.06] bg-dark-900/60 flex items-center justify-between">
                            <span className="text-2xs uppercase tracking-[0.12em] text-dark-500">Spread</span>
                            {orderBookBids[0] && orderBookAsks[0] ? (
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setTradeTab('sell');
                                    setLimitPrice(Number(ethers.formatEther(orderBookBids[0].price)).toFixed(2));
                                    setUsdcAmount(formatInputWad(calculateUsdcFromShares(orderBookBids[0].shares, orderBookBids[0].price)));
                                    setExecutionMode('limit');
                                  }}
                                  className="rounded-md border border-emerald-500/25 bg-emerald-500/10 px-2 py-1 text-xs font-mono text-emerald-300 transition-colors hover:bg-emerald-500/15"
                                >
                                  Bid {Number(ethers.formatEther(orderBookBids[0].price)).toFixed(2)}
                                </button>
                                <span className="text-xs font-mono text-white/70">
                                  {(Number(ethers.formatEther(orderBookAsks[0].price - orderBookBids[0].price))).toFixed(4)} USDC
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setTradeTab('buy');
                                    setLimitPrice(Number(ethers.formatEther(orderBookAsks[0].price)).toFixed(2));
                                    setUsdcAmount(formatInputWad(calculateUsdcFromShares(orderBookAsks[0].shares, orderBookAsks[0].price)));
                                    setExecutionMode('limit');
                                  }}
                                  className="rounded-md border border-red-500/25 bg-red-500/10 px-2 py-1 text-xs font-mono text-red-300 transition-colors hover:bg-red-500/15"
                                >
                                  Ask {Number(ethers.formatEther(orderBookAsks[0].price)).toFixed(2)}
                                </button>
                              </div>
                            ) : (
                              <span className="text-xs font-mono text-white">No two-sided book</span>
                            )}
                          </div>
                          {mmQuote && mmQuote.initialSharesWad > 0n && (
                            <div className="px-3 py-2 border-b border-white/[0.06] bg-cyan-500/[0.04]">
                              <div className="flex items-center justify-between gap-2 mb-2">
                                <div>
                                  <p className="text-2xs uppercase tracking-[0.12em] text-cyan-300/80 font-semibold">LMSR Quote</p>
                                  <p className="text-2xs text-white/45">
                                    {formatUSDC(mmQuote.reserveWei)} USDC reserve, winning shares redeem at 1 USDC
                                  </p>
                                </div>
                                <span className="text-2xs rounded-md border border-cyan-400/20 bg-cyan-400/10 px-2 py-1 text-cyan-200">Normalized odds</span>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <button
                                  type="button"
                                  disabled={mmQuote.bidPriceWad === 0n}
                                  onClick={() => {
                                    setTradeTab('sell');
                                    setExecutionMode('instant');
                                  }}
                                  className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-2 text-left disabled:opacity-45"
                                >
                                  <p className="text-2xs text-emerald-300/70 uppercase tracking-[0.1em]">MM Bid</p>
                                  <p className="text-sm font-mono font-semibold text-emerald-300">{mmQuote.bidPriceWad > 0n ? Number(ethers.formatEther(mmQuote.bidPriceWad)).toFixed(4) : 'No buyback'}</p>
                                </button>
                                <button
                                  type="button"
                                  disabled={mmQuote.askPriceWad === 0n}
                                  onClick={() => {
                                    setTradeTab('buy');
                                    setExecutionMode('instant');
                                  }}
                                  className="rounded-lg border border-red-500/20 bg-red-500/10 px-2.5 py-2 text-left disabled:opacity-45"
                                >
                                  <p className="text-2xs text-red-300/70 uppercase tracking-[0.1em]">MM Ask</p>
                                  <p className="text-sm font-mono font-semibold text-red-300">{mmQuote.askPriceWad > 0n ? Number(ethers.formatEther(mmQuote.askPriceWad)).toFixed(4) : 'Sold out'}</p>
                                </button>
                              </div>
                            </div>
                          )}
                          <DepthRows
                            levels={orderBookBids}
                            side="bid"
                            selectedPrice={selectedLimitPriceValue}
                            onSelectLevel={(price, shares, priceWad) => {
                              setTradeTab('sell');
                              setLimitPrice(price.toFixed(2));
                              setUsdcAmount(formatInputWad(calculateUsdcFromShares(shares, priceWad)));
                              setExecutionMode('limit');
                            }}
                          />
                          {orderBookBids.length === 0 && orderBookAsks.length === 0 && (
                            <p className="px-3 py-5 text-xs text-dark-500 text-center">
                              No CLOB liquidity yet. Your order can become the first visible bid/ask.
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )}

                {showAdvancedTrade && <RecentTrades trades={recentTrades} outcomeLabels={detail.outcomeLabels} />}

                {showAdvancedTrade && (
                  <UserOpenOrders
                    orders={userOrders}
                    loading={userOrdersLoading}
                    outcomeLabels={detail.outcomeLabels}
                    cancellingOrderId={cancellingOrderId}
                    onCancel={handleCancelOrder}
                  />
                )}

                {/* Amount input */}
                <div className="flex items-center justify-between mb-2">
                  <label className="text-2xs font-semibold text-dark-400 uppercase tracking-wider flex items-center gap-1.5">
                    {executionMode === 'limit'
                      ? 'USDC amount'
                      : tradeTab === 'buy'
                        ? 'USDC to spend'
                        : 'USDC to receive'}
                  </label>
                  {tradeTab === 'buy' && executionMode === 'instant' && userBalance !== null && (
                    <span className="text-2xs text-dark-400 font-medium flex items-center gap-1">
                      <svg className="w-3 h-3 text-dark-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3" />
                      </svg>
                      <span className="tabular-nums">{formatCompactUSDC(userBalance)}</span>
                      <span className="text-dark-500">USDC</span>
                    </span>
                  )}
                  {tradeTab === 'sell' && userInfo && (
                    <span className="text-2xs text-dark-400 font-medium flex items-center gap-1">
                      <svg className="w-3 h-3 text-dark-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 14.25v2.25m3-4.5v4.5m3-6.75v6.75m3-9v9M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z" />
                      </svg>
                      <span className="tabular-nums">{formatWad(userInfo.shares[selectedOutcome] || 0n)}</span>
                      <span className="text-dark-500">shares</span>
                    </span>
                  )}
                </div>
                <div className="relative mb-3">
                  <input
                    type="number"
                    value={usdcAmount}
                    onChange={(e) => setUsdcAmount(e.target.value)}
                    placeholder="0.00"
                    min="0"
                    step="0.01"
                    className="input-field min-h-[3.75rem] rounded-2xl border-white/[0.1] bg-dark-950/70 pr-20 text-2xl font-black tabular-nums"
                  />
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                    {tradeTab === 'sell' && userInfo && (userInfo.shares[selectedOutcome] || 0n) > 0n && (
                      <button
                        onClick={() => {
                          const maxSharesWei = userInfo.shares[selectedOutcome] || 0n;
                          const approxWei = (maxSharesWei * (detail.impliedProbabilitiesWad[selectedOutcome] ?? 0n)) / WAD;
                          setUsdcAmount(formatInputWad(approxWei));
                        }}
                        className="rounded-lg bg-red-500/15 px-2 py-1 text-2xs font-bold text-red-300 transition-all hover:bg-red-500/25"
                      >
                        Max
                      </button>
                    )}
                    <span className="flex items-center gap-1 rounded-lg bg-white/[0.04] px-2 py-1 text-2xs font-bold text-dark-400">
                    USDC
                    </span>
                  </div>
                </div>

                {executionMode === 'limit' && (
                  <div className="grid grid-cols-2 gap-2 mb-4">
                    <label className="block">
                      <span className="text-2xs font-semibold text-dark-500 uppercase tracking-wider block mb-1.5">Limit price</span>
                      <input
                        type="number"
                        value={limitPrice}
                        onChange={(e) => setLimitPrice(e.target.value)}
                        placeholder="0.50"
                        min="0.01"
                        max="1"
                        step="0.01"
                        className="input-field text-sm"
                      />
                    </label>
                    <label className="block">
                      <span className="text-2xs font-semibold text-dark-500 uppercase tracking-wider block mb-1.5">Expiry min</span>
                      <input
                        type="number"
                        value={limitExpiryMinutes}
                        onChange={(e) => setLimitExpiryMinutes(e.target.value)}
                        placeholder="1440"
                        min="0"
                        step="15"
                        className="input-field text-sm"
                      />
                    </label>
                  </div>
                )}

                {showAdvancedTrade && executionMode === 'instant' && (
                  <div className="mb-4 space-y-3">
                    <label className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-dark-900/35 px-3 py-2 cursor-pointer">
                      <span className="text-xs text-white/65">Allow partial fill</span>
                      <input
                        type="checkbox"
                        checked={allowPartialFill}
                        onChange={(e) => setAllowPartialFill(e.target.checked)}
                        className="h-4 w-4 accent-primary-500"
                      />
                    </label>
                  </div>
                )}

                {executionMode === 'limit' && limitSharesWad > 0n && limitPriceWad > 0n && (
                  <div className="p-3 rounded-2xl bg-dark-900/50 border border-white/[0.06] mb-4 space-y-2">
                    <PreviewRow label="Side" value={tradeTab === 'buy' ? 'Buy limit' : 'Sell limit'} />
                    <PreviewRow label="Outcome" value={selectedOutcomeLabel} />
                    <PreviewRow label="Price" value={`${Number(limitPrice).toFixed(2)} USDC`} />
                    <PreviewRow label="USDC Amount" value={`${formatUSDC(limitNotionalWei)} USDC`} />
                    <PreviewRow label="Derived Shares" value={`${formatWad(limitSharesWad)} shares`} />
                    {tradeTab === 'buy' ? (
                      <>
                        <PreviewRow label="Estimated Cost" value={`${formatUSDC(applyBuySlippage(limitNotionalWei, 1))} USDC`} />
                        <PreviewRow label="Max Loss" value={`${formatUSDC(applyBuySlippage(limitNotionalWei, 1))} USDC`} muted />
                        <PreviewRow label="Payout if Wins" value={`${formatUSDC(limitPayoutWei)} USDC`} accent="green" />
                      </>
                    ) : (
                      <>
                        <PreviewRow label="Estimated Receive" value={`${formatUSDC(limitNotionalWei)} USDC`} />
                        <PreviewRow label="Shares Locked" value={`${formatWad(limitSharesWad)} ${selectedOutcomeLabel}`} muted />
                      </>
                    )}
                  </div>
                )}

                {/* Buy preview */}
                {executionMode === 'instant' && tradeTab === 'buy' && estimatedShares !== null && usdcAmount && (
                  <div className="mb-4 overflow-hidden rounded-2xl border border-emerald-400/15 bg-gradient-to-b from-emerald-400/[0.08] to-dark-900/55">
                    <div className="grid grid-cols-2 gap-0 border-b border-white/[0.06]">
                      <div className="p-3">
                        <p className="text-2xs uppercase tracking-[0.12em] text-emerald-200/60">You spend</p>
                        <p className="mt-1 text-lg font-black text-white tabular-nums">{previewLoading || previewCost === null ? '...' : `${formatUSDC(previewCost)} USDC`}</p>
                      </div>
                      <div className="border-l border-white/[0.06] p-3">
                        <p className="text-2xs uppercase tracking-[0.12em] text-emerald-200/60">You get</p>
                        <p className="mt-1 text-lg font-black text-emerald-300 tabular-nums">{previewLoading ? '...' : `${formatWad(previewFilledSharesWad)} shares`}</p>
                      </div>
                    </div>
                    <div className="space-y-2 p-3">
                      {showAdvancedTrade && <PreviewRow label="Side" value="Buy" />}
                      {showAdvancedTrade && <PreviewRow label="Outcome" value={selectedOutcomeLabel} />}
                      {showAdvancedTrade && <PreviewRow label="USDC Input" value={`${formatUSDC(tradeUsdcWei)} USDC`} />}
                      {showAdvancedTrade && <PreviewRow label="Shares Bought" value={`${formatWad(previewFilledSharesWad)} shares`} />}
                      {showAdvancedTrade && <PreviewRow label="Avg Price" value={previewLoading ? '...' : `${avgPrice.toFixed(4)} USDC`} />}
                      {showAdvancedTrade && <PreviewRow label="Price Impact" value={`${buyPriceImpactPct >= 0 ? '+' : ''}${buyPriceImpactPct.toFixed(2)}%`} accent={buyPriceImpactPct > 5 ? 'red' : 'green'} />}
                      {showAdvancedTrade && previewCost !== null && <PreviewRow label="Router Cost" value={`${formatUSDC(previewCost)} USDC`} />}
                      {showAdvancedTrade && executionSource && <PreviewRow label="Route" value={executionSource} muted />}
                      {isPreviewPartial && (
                        <PreviewRow label="Partial Fill" value={allowPartialFill ? 'Allowed' : 'Disabled'} accent={allowPartialFill ? 'green' : 'red'} />
                      )}
                      {estimatedPayout !== null && (
                        <>
                          <PreviewRow label="Payout if Wins" value={`${formatUSDC(estimatedPayout)} USDC`} accent={profit >= 0 ? 'green' : 'red'} />
                          {showAdvancedTrade && <PreviewRow label="Profit" value={`${profit >= 0 ? '+' : ''}${profit.toFixed(4)} USDC`} accent={profit >= 0 ? 'green' : 'red'} />}
                          {showAdvancedTrade && <PreviewRow label="Return" value={`${multiplier.toFixed(2)}x`} accent={multiplier >= 1 ? 'green' : 'red'} />}
                        </>
                      )}
                      {totalPositionPayout !== null && showAdvancedTrade && (
                        <>
                          <div className="divider" />
                          <PreviewRow label="Total Position Payout" value={`${formatUSDC(totalPositionPayout)} USDC`} />
                        </>
                      )}
                      {showAdvancedTrade && <div className="divider" />}
                      <PreviewRow
                        label="Max Spend"
                        value={`${formatUSDC(tradeUsdcWei)} USDC`}
                        muted
                      />
                    </div>
                  </div>
                )}

                {/* Sell preview */}
                {executionMode === 'instant' && tradeTab === 'sell' && previewCost !== null && usdcAmount && (
                  <div className="mb-4 overflow-hidden rounded-2xl border border-red-400/15 bg-gradient-to-b from-red-400/[0.08] to-dark-900/55">
                    <div className="grid grid-cols-2 gap-0 border-b border-white/[0.06]">
                      <div className="p-3">
                        <p className="text-2xs uppercase tracking-[0.12em] text-red-200/60">Shares sold</p>
                        <p className="mt-1 text-lg font-black text-white tabular-nums">{formatWad(previewFilledSharesWad)} shares</p>
                      </div>
                      <div className="border-l border-white/[0.06] p-3">
                        <p className="text-2xs uppercase tracking-[0.12em] text-red-200/60">You receive</p>
                        <p className="mt-1 text-lg font-black text-red-300 tabular-nums">{previewLoading ? '...' : `${formatUSDC(previewCost)} USDC`}</p>
                      </div>
                    </div>
                    <div className="space-y-2 p-3">
                      {showAdvancedTrade && <PreviewRow label="Side" value="Sell" />}
                      {showAdvancedTrade && <PreviewRow label="Outcome" value={selectedOutcomeLabel} />}
                      {showAdvancedTrade && <PreviewRow label="USDC Target" value={`${formatUSDC(tradeUsdcWei)} USDC`} />}
                      {showAdvancedTrade && <PreviewRow label="Shares Sold" value={`${formatWad(previewFilledSharesWad)} shares`} />}
                      {showAdvancedTrade && <PreviewRow label="Avg Price" value={`${sellAvgPrice.toFixed(4)} USDC`} />}
                      {showAdvancedTrade && <PreviewRow label="Price Impact" value={`${sellPriceImpactPct >= 0 ? '-' : '+'}${Math.abs(sellPriceImpactPct).toFixed(2)}%`} accent={sellPriceImpactPct > 5 ? 'red' : 'green'} />}
                      {showAdvancedTrade && <PreviewRow label="Est. Proceeds" value={previewLoading ? '...' : `${formatUSDC(previewCost)} USDC`} />}
                      {showAdvancedTrade && executionSource && <PreviewRow label="Route" value={executionSource} muted />}
                      {showAdvancedTrade && <div className="divider" />}
                      <PreviewRow
                        label="Min Receive"
                        value={`${formatUSDC(tradeUsdcWei)} USDC`}
                        muted
                      />
                    </div>
                  </div>
                )}

                {noSellLiquidity && (
                  <div className="mb-4 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-xs text-amber-200">
                    No executable buyers available. Place a limit sell order.
                  </div>
                )}

                {sellTargetUnavailable && previewCost !== null && (
                  <div className="mb-4 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-xs text-amber-200">
                    Only {formatUSDC(previewCost)} USDC can be received with your current shares and available liquidity.
                  </div>
                )}

                {buyLiquidityInsufficient && tradeTab === 'buy' && (
                  <div className="mb-4 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-xs text-amber-200">
                    <div className="flex items-start justify-between gap-3">
                      <span>
                        {previewCost !== null && previewCost > 0n
                          ? `Only ${formatUSDC(previewCost)} USDC can be filled right now.`
                          : 'Buy liquidity is insufficient for that USDC amount.'}
                      </span>
                      {!showAdvancedTrade && (
                        <button
                          type="button"
                          onClick={() => setAllowPartialFill(true)}
                          className="shrink-0 rounded-lg border border-amber-300/25 bg-amber-300/10 px-2 py-1 text-2xs font-bold text-amber-100"
                        >
                          Allow
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Submit */}
                {executionMode === 'instant' && (
                  <button
                    onClick={tradeTab === 'buy' ? handleBuy : handleSell}
                    disabled={txPending || !usdcAmount || parseFloat(usdcAmount) <= 0 || previewLoading || previewKey !== currentInputKey || (!allowPartialFill && isPreviewPartial) || sellTargetUnavailable || (tradeTab === 'buy' ? estimatedShares === null : previewCost === null)}
                    className={`w-full min-h-[3.75rem] rounded-2xl py-4 text-base font-black transition-all active:scale-[0.97] ${
                      tradeTab === 'buy'
                        ? 'bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white shadow-glow-yes disabled:from-emerald-600/20 disabled:to-emerald-500/20 disabled:text-emerald-400/40 disabled:shadow-none'
                        : 'bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-400 text-white shadow-glow-no disabled:from-red-600/20 disabled:to-red-500/20 disabled:text-red-400/40 disabled:shadow-none'
                    }`}
                  >
                    {txPending ? (
                      <span className="flex items-center justify-center gap-2">
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Processing...
                      </span>
                    ) : tradeTab === 'buy' ? (
                      `Review & Buy ${detail.outcomeLabels[selectedOutcome]}`
                    ) : (
                      `Review & Sell ${detail.outcomeLabels[selectedOutcome]}`
                    )}
                  </button>
                )}

                {executionMode === 'limit' && (
                  <button
                    onClick={handlePlaceLimitOrder}
                    disabled={txPending || !usdcAmount || !limitPrice || parseFloat(usdcAmount) <= 0 || parseFloat(limitPrice) <= 0 || parseFloat(limitPrice) > 1}
                    className="w-full min-h-[3.75rem] rounded-2xl py-4 text-base font-black transition-all active:scale-[0.97] bg-gradient-to-r from-cyan-600 to-blue-500 hover:from-cyan-500 hover:to-blue-400 text-white disabled:from-cyan-600/20 disabled:to-blue-500/20 disabled:text-cyan-400/40 mt-2"
                  >
                    {txPending ? 'Processing...' : `Place ${tradeTab === 'buy' ? 'Bid' : 'Ask'} Order`}
                  </button>
                )}

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
              <div className="card p-6 text-center border-primary-500/20 bg-primary-500/[0.04]">
                <div className="w-10 h-10 rounded-xl bg-primary-500/10 flex items-center justify-center mx-auto mb-3">
                  <svg className="w-5 h-5 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                  </svg>
                </div>
                <p className="text-sm text-dark-200 font-medium">Connect your wallet to trade</p>
                <p className="text-2xs text-dark-500 mt-1">You can still review odds and history without connecting.</p>
              </div>
            )}

            {/* Wrong network prompt */}
            {isActive && isConnected && !isCorrectNetwork && (
              <div className="card p-6 text-center border-amber-500/20 bg-amber-500/[0.04]">
                <p className="text-sm text-amber-400 font-medium">Switch to ARC Testnet to trade</p>
                <p className="text-2xs text-amber-300/70 mt-1">Current network does not support this market.</p>
              </div>
            )}

            {/* User Position */}
            {userInfo && isConnected && (
              <div className="card p-5">
                <h3 className="section-header mb-4">Your Position</h3>

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
                    <span className="text-dark-500 font-medium">Claim status</span>
                    <span className="font-bold text-white tabular-nums">{userInfo.redeemed ? 'Claimed' : 'Open'}</span>
                  </div>
                </div>

                {userInfo.canRedeem && (
                  <button onClick={handleRedeem} disabled={txPending} className="w-full btn-yes py-3 text-sm pulse-glow">
                    {txPending ? 'Processing...' : isResolved ? 'Claim Winnings' : 'Claim Invalid/Expired Payout'}
                  </button>
                )}

                {userInfo.redeemed && (
                  <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-center">
                    <p className="text-xs text-emerald-400 font-medium">Payout already claimed</p>
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

  // Compute change from first visible point
  const firstData = filteredHistory.length > 0 ? filteredHistory[0] : null;

  return (
    <div className="card overflow-hidden border border-white/[0.08] bg-gradient-to-b from-dark-900/95 via-dark-900/80 to-dark-950/95">
      {/* Header */}
      <div className="p-5 pb-0">
        <div className="flex items-center justify-between mb-3 gap-2">
          <h2 className="section-header">Price History</h2>
          {/* Time range selector */}
          <div className="flex items-center rounded-xl bg-dark-900/70 p-0.5 border border-white/[0.08] overflow-x-auto scrollbar-hide shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            {TIME_RANGES.map(range => (
              <button
                key={range.key}
                onClick={() => setTimeRange(range.key)}
                className={`px-2.5 py-1 rounded-lg text-2xs font-semibold transition-all border ${
                  timeRange === range.key
                    ? 'bg-primary-500/20 text-primary-300 border-primary-500/35 shadow-[0_0_0_1px_rgba(59,130,246,0.18)]'
                    : 'border-transparent text-dark-500 hover:text-dark-200 hover:border-white/[0.08]'
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
      <div className="h-64 sm:h-80 px-2 pb-4">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={filteredHistory}
            margin={{ top: 8, right: 12, bottom: 10, left: 0 }}
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
              strokeDasharray="4 4"
              stroke="rgba(148,163,184,0.14)"
              vertical
            />
            <XAxis
              dataKey="time"
              tickFormatter={(t) => {
                const d = new Date(t * 1000);
                if (timeRange === '1H') {
                  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                }
                if (timeRange === '6H') {
                  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString([], { hour: '2-digit' })}`;
                }
                return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
              }}
              stroke="transparent"
              tick={{ fontSize: 10, fill: '#94a3b8' }}
              axisLine={false}
              tickLine={false}
              minTickGap={40}
            />
            <YAxis
              domain={[0, 100]}
              tickFormatter={(v) => `${v}¢`}
              stroke="transparent"
              tick={{ fontSize: 10, fill: '#94a3b8' }}
              axisLine={false}
              tickLine={false}
              width={34}
              ticks={[0, 25, 50, 75, 100]}
            />
            <Tooltip
              cursor={{
                stroke: 'rgba(59,130,246,0.55)',
                strokeWidth: 1,
              }}
              contentStyle={{
                backgroundColor: 'rgba(8, 12, 20, 0.97)',
                border: '1px solid rgba(59,130,246,0.35)',
                borderRadius: '12px',
                backdropFilter: 'blur(16px)',
                padding: '10px 12px',
                fontSize: '12px',
                boxShadow: '0 20px 45px rgba(2, 6, 23, 0.7)',
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
                  type="monotone"
                  dataKey={label}
                  stroke={isVisible ? CHART_COLORS[i % CHART_COLORS.length] : 'transparent'}
                  strokeWidth={isVisible ? 2.4 : 0}
                  fill={isVisible ? `url(#prob-gradient-${i})` : 'transparent'}
                  fillOpacity={1}
                  dot={false}
                  activeDot={isVisible ? {
                    r: 4.5,
                    strokeWidth: 2,
                    stroke: CHART_COLORS[i % CHART_COLORS.length],
                    fill: '#0a0f19',
                  } : false}
                  animationDuration={300}
                />
              );
            })}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Trade count indicator */}
      <div className="px-5 pb-3 flex items-center justify-between">
        <span className="text-2xs text-dark-600">
          {history.length} trade{history.length !== 1 ? 's' : ''} recorded
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
    <div className="card p-3.5">
      <span className="text-2xs text-dark-400 font-semibold uppercase tracking-wider">{label}</span>
      <div className="flex items-center gap-1.5 mt-1">
        {icon}
        <span className={`font-bold text-white tabular-nums leading-none ${small ? 'text-xs' : 'text-sm'}`}>{value}</span>
        {suffix && <span className="text-2xs text-dark-400 font-medium">{suffix}</span>}
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

function DepthRows({
  levels,
  side,
  selectedPrice,
  onSelectLevel,
}: {
  levels: DepthLevel[];
  side: 'bid' | 'ask';
  selectedPrice: number | null;
  onSelectLevel: (price: number, shares: bigint, priceWad: bigint) => void;
}) {
  if (levels.length === 0) return null;
  const color = side === 'bid' ? 'text-emerald-300' : 'text-red-300';
  const bg = side === 'bid' ? 'bg-emerald-500/[0.04]' : 'bg-red-500/[0.04]';
  return (
    <div>
      {levels.map((level, index) => {
        const price = Number(ethers.formatEther(level.price));
        const shares = Number(ethers.formatEther(level.shares));
        const total = price * shares;
        const isSelected = selectedPrice !== null && Math.abs(selectedPrice - price) < 0.000001;
        return (
          <button
            key={`${side}-${level.price.toString()}-${index}`}
            type="button"
            onClick={() => onSelectLevel(price, level.shares, level.price)}
            className={`grid w-full grid-cols-3 px-3 py-1.5 text-xs font-mono transition-colors hover:bg-white/[0.04] ${bg} ${
              isSelected ? 'ring-1 ring-inset ring-cyan-400/45 bg-cyan-500/[0.08]' : ''
            }`}
          >
            <span className={color}>{price.toFixed(2)}</span>
            <span className="text-right text-white/75">{shares.toFixed(3)}</span>
            <span className="text-right text-white/45">{total.toFixed(3)}</span>
          </button>
        );
      })}
    </div>
  );
}

function RecentTrades({ trades, outcomeLabels }: { trades: TradeEvent[]; outcomeLabels: string[] }) {
  return (
    <div className="mb-4 rounded-2xl border border-white/[0.08] bg-dark-900/35 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06]">
        <p className="text-2xs uppercase tracking-[0.12em] text-white/45 font-semibold">Recent Trades</p>
        <span className="text-2xs text-dark-500">Executed only</span>
      </div>
      <div className="grid grid-cols-4 px-3 py-2 text-2xs uppercase tracking-[0.12em] text-dark-500 border-b border-white/[0.06]">
        <span>Side</span>
        <span>Outcome</span>
        <span className="text-right">Price</span>
        <span className="text-right">Size</span>
      </div>
      <div className="max-h-36 overflow-hidden">
        {trades.length === 0 ? (
          <p className="px-3 py-4 text-xs text-dark-500 text-center">No executed trades yet.</p>
        ) : (
          trades.map((trade) => {
            const sideClass = trade.type === 'buy' ? 'text-emerald-300' : 'text-red-300';
            return (
              <div key={`${trade.txHash}-${trade.logIndex}`} className="grid grid-cols-4 px-3 py-1.5 text-xs font-mono animate-fade-in">
                <span className={sideClass}>{trade.type.toUpperCase()} <span className="text-white/30">{trade.source}</span></span>
                <span className="truncate text-white/70">{outcomeLabels[trade.outcomeIndex] ?? trade.outcomeIndex}</span>
                <span className="text-right text-white">{Number(ethers.formatEther(trade.priceWad)).toFixed(2)}</span>
                <span className="text-right text-white/50">{Number(ethers.formatEther(trade.sharesWad)).toFixed(3)}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function UserOpenOrders({
  orders,
  loading,
  outcomeLabels,
  cancellingOrderId,
  onCancel,
}: {
  orders: UserLimitOrder[];
  loading: boolean;
  outcomeLabels: string[];
  cancellingOrderId: bigint | null;
  onCancel: (orderId: bigint) => void;
}) {
  return (
    <div className="mb-4 rounded-2xl border border-white/[0.08] bg-dark-900/35 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06]">
        <p className="text-2xs uppercase tracking-[0.12em] text-white/45 font-semibold">Open Limit Orders</p>
        <span className="text-2xs text-dark-500">{orders.length} open</span>
      </div>
      {loading ? (
        <p className="px-3 py-4 text-xs text-dark-500 text-center">Loading your orders...</p>
      ) : orders.length === 0 ? (
        <p className="px-3 py-4 text-xs text-dark-500 text-center">No open limit orders.</p>
      ) : (
        <div className="max-h-44 overflow-y-auto">
          {orders.map((order) => {
            const sideLabel = order.side === 0 ? 'Buy' : 'Sell';
            const sideClass = order.side === 0 ? 'text-emerald-300' : 'text-red-300';
            const status = order.status === 0 && order.remainingSharesWad < order.originalSharesWad
              ? 'Partially Filled'
              : (ORDER_STATUS_LABELS[order.status] ?? 'Open');
            const remainingCost = (order.remainingSharesWad * order.priceWad) / WAD;
            const isCancelling = cancellingOrderId === order.id;
            return (
              <div key={order.id.toString()} className="px-3 py-2 border-b border-white/[0.04] last:border-b-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs">
                      <span className={`font-semibold ${sideClass}`}>{sideLabel}</span>
                      <span className="text-white truncate">{outcomeLabels[order.outcome] ?? `Outcome ${order.outcome}`}</span>
                      <span className="text-dark-500">#{order.id.toString()}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-2xs text-dark-400 font-mono">
                      <span>{Number(ethers.formatEther(order.priceWad)).toFixed(2)} USDC</span>
                      <span>{formatWad(order.remainingSharesWad)} / {formatWad(order.originalSharesWad)} shares</span>
                      <span>{formatUSDC(remainingCost)} USDC open</span>
                      <span>{order.expiry > 0 ? `Exp ${formatDate(order.expiry)}` : 'GTC'}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="hidden sm:inline-flex text-2xs rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-white/60">
                      {status}
                    </span>
                    <button
                      type="button"
                      onClick={() => onCancel(order.id)}
                      disabled={isCancelling}
                      className="rounded-lg border border-red-500/25 bg-red-500/10 px-2.5 py-1.5 text-2xs font-semibold text-red-300 hover:bg-red-500/15 disabled:opacity-50 transition-colors"
                    >
                      {isCancelling ? 'Canceling...' : 'Cancel'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
