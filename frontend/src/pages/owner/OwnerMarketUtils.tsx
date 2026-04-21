import { useState, useEffect, useCallback, useRef, type ChangeEvent } from 'react';
import { ethers } from 'ethers';
import { useWallet } from '../../context/WalletContext';
import { FACTORY_ADDRESS, LENS_ADDRESS, STAGE, STAGE_LABELS, STAGE_COLORS, NETWORK } from '../../config/network';
import { FACTORY_ABI, LENS_ABI, MARKET_ABI } from '../../config/abis';
import ImageWithFallback from '../../components/ImageWithFallback';
import ProbabilityBar from '../../components/ProbabilityBar';
import Countdown from '../../components/Countdown';
import { PageLoader } from '../../components/LoadingSpinner';
import EmptyState from '../../components/EmptyState';
import { formatCompactUSDC, formatDate, parseContractError, resolveImageUri, parseDescription, titleCase } from '../../utils/format';
import { fetchAllMarketVolumes } from '../../services/blockscout';
import { compressMarketImage } from '../../utils/marketImage';
import { uploadMarketMedia, deleteMarketMedia } from '../../services/marketMedia';

export interface OwnerMarketData {
  market: string;
  marketId: number;
  title: string;
  description: string;
  category: string;
  imageUri: string;
  outcomeLabels: string[];
  impliedProbabilitiesWad: bigint[];
  stage: number;
  winningOutcome: number;
  marketDeadline: number;
  createdAt: number;
  totalVolumeWei: bigint;
  participants: number;
  proofUri: string;
  cancelReason: string;
  cancelProofUri: string;
}

const MARKET_INFO_ABI = [
  'function getMarketInfo() view returns (string _title, string _description, string _category, string _imageUri, string _proofUri, string[] _outcomeLabels, uint8 _stage, uint256 _winningOutcome, uint256 _createdAt, uint256 _marketDeadline, uint256 _totalVolumeWei, uint256 _participantCount, string _cancelReason, string _cancelProofUri)',
  'function admin() view returns (address)',
] as const;

interface LensSummary {
  market: string;
  marketId: bigint;
  title: string;
  category: string;
  imageUri: string;
  outcomeLabels: string[];
  impliedProbabilitiesWad: bigint[];
  stage: bigint;
  winningOutcome: bigint;
  marketDeadline: bigint;
  totalVolumeWei: bigint;
  participants: bigint;
  bWad: bigint;
}

interface MarketInfo {
  _title: string;
  _description: string;
  _category: string;
  _imageUri: string;
  _proofUri: string;
  _outcomeLabels: string[];
  _stage: number;
  _winningOutcome: bigint;
  _createdAt: bigint;
  _marketDeadline: bigint;
  _totalVolumeWei: bigint;
  _participantCount: bigint;
  _cancelReason: string;
  _cancelProofUri: string;
}

const OWNER_MARKETS_CACHE_TTL_MS = 15_000;
const ownerMarketsCache = new Map<string, OwnerMarketData[]>();
const ownerMarketsCacheAt = new Map<string, number>();

export function useOwnerMarkets() {
  const { readProvider, address } = useWallet();

  const getCacheKey = useCallback(async () => {
    const network = await readProvider.getNetwork();
    const chainId = network.chainId.toString();
    const rpcUrl = NETWORK.rpcUrl;
    const normalizedOwner = address ? ethers.getAddress(address) : 'no-owner';
    return `${chainId}:${rpcUrl}:${normalizedOwner}`;
  }, [readProvider, address]);

  const [markets, setMarkets] = useState<OwnerMarketData[]>([]);
  const [loading, setLoading] = useState(true);
  const latestFetchKeyRef = useRef('');

  const fetchAll = useCallback(async (force = false) => {
    try {
      const cacheKey = await getCacheKey();
      latestFetchKeyRef.current = cacheKey;
      const now = Date.now();
      const cached = ownerMarketsCache.get(cacheKey);
      const cachedAt = ownerMarketsCacheAt.get(cacheKey) ?? 0;

      if (!force && cached && now - cachedAt < OWNER_MARKETS_CACHE_TTL_MS) {
        if (latestFetchKeyRef.current !== cacheKey) return;
        setMarkets(cached);
        setLoading(false);
        return;
      }

      if (!cached) {
        setLoading(true);
      }

      const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, readProvider);
      const lens = new ethers.Contract(LENS_ADDRESS, LENS_ABI, readProvider);
      const total = Number(await factory.totalMarkets());
      if (total === 0) {
        if (latestFetchKeyRef.current !== cacheKey) return;
        ownerMarketsCache.set(cacheKey, []);
        ownerMarketsCacheAt.set(cacheKey, Date.now());
        setMarkets([]);
        return;
      }

      const allSummaries = (await lens.getMarketSummaries(0, total)) as LensSummary[];
      const normalizedOwner = address ? ethers.getAddress(address).toLowerCase() : '';

      const infoInterface = new ethers.Interface(MARKET_INFO_ABI);
      const adminCalls = allSummaries.map((s) => ({
        to: s.market,
        data: infoInterface.encodeFunctionData('admin', []),
      }));

      const adminResults = await Promise.all(
        adminCalls.map(async (call) => {
          try {
            const result = await readProvider.call({ to: call.to, data: call.data });
            const decoded = infoInterface.decodeFunctionResult('admin', result);
            const adminAddr = decoded[0] as string;
            return adminAddr.toLowerCase();
          } catch {
            return '';
          }
        })
      );

      const summaries = normalizedOwner
        ? allSummaries.filter((s, i) => adminResults[i] === normalizedOwner)
        : allSummaries;

      const result: OwnerMarketData[] = summaries.map((s) => ({
        market: s.market,
        marketId: Number(s.marketId),
        title: s.title,
        description: '',
        category: s.category,
        imageUri: s.imageUri,
        outcomeLabels: [...s.outcomeLabels],
        impliedProbabilitiesWad: [...s.impliedProbabilitiesWad],
        stage: Number(s.stage),
        winningOutcome: Number(s.winningOutcome),
        marketDeadline: Number(s.marketDeadline),
        createdAt: 0,
        totalVolumeWei: s.totalVolumeWei,
        participants: Number(s.participants),
        proofUri: '',
        cancelReason: '',
        cancelProofUri: '',
      }));

      const calls = summaries.map((s) => ({
        to: s.market,
        data: infoInterface.encodeFunctionData('getMarketInfo', []),
      }));

      const batchSize = 24;
      const slots: Array<MarketInfo | null> = new Array(calls.length).fill(null);

      await Promise.all(
        Array.from({ length: Math.ceil(calls.length / batchSize) }, (_, chunkIdx) => {
          const start = chunkIdx * batchSize;
          const end = Math.min(start + batchSize, calls.length);
          const chunk = calls.slice(start, end);
          return readProvider
            .send('eth_callMany', [
              {
                calls: chunk,
                blockNumber: 'latest',
              },
            ])
            .then(async (response: unknown) => {
              let decodedCount = 0;
              const rawResults = Array.isArray(response)
                ? response
                : Array.isArray((response as { results?: unknown[] })?.results)
                  ? (response as { results: unknown[] }).results
                  : [];

              for (let i = 0; i < chunk.length; i += 1) {
                const rawEntry = rawResults[i] as { success?: boolean; returnData?: string } | undefined;
                const returnData = typeof rawEntry?.returnData === 'string' ? rawEntry.returnData : '';
                if (!rawEntry?.success || !returnData || returnData === '0x') continue;
                try {
                  const decoded = infoInterface.decodeFunctionResult('getMarketInfo', returnData) as unknown as [
                    string,
                    string,
                    string,
                    string,
                    string,
                    string[],
                    number,
                    bigint,
                    bigint,
                    bigint,
                    bigint,
                    bigint,
                    string,
                    string,
                  ];

                  slots[start + i] = {
                    _title: decoded[0],
                    _description: decoded[1],
                    _category: decoded[2],
                    _imageUri: decoded[3],
                    _proofUri: decoded[4],
                    _outcomeLabels: decoded[5],
                    _stage: Number(decoded[6]),
                    _winningOutcome: decoded[7],
                    _createdAt: decoded[8],
                    _marketDeadline: decoded[9],
                    _totalVolumeWei: decoded[10],
                    _participantCount: decoded[11],
                    _cancelReason: decoded[12],
                    _cancelProofUri: decoded[13],
                  };
                  decodedCount += 1;
                } catch {
                  slots[start + i] = null;
                }
              }

              // Retry individual failed entries
              for (let i = 0; i < chunk.length; i += 1) {
                if (slots[start + i] !== null) continue;
                try {
                  const raw = await readProvider.call({ to: chunk[i].to, data: chunk[i].data });
                  const decoded = infoInterface.decodeFunctionResult('getMarketInfo', raw) as unknown as [
                    string,
                    string,
                    string,
                    string,
                    string,
                    string[],
                    number,
                    bigint,
                    bigint,
                    bigint,
                    bigint,
                    bigint,
                    string,
                    string,
                  ];

                  slots[start + i] = {
                    _title: decoded[0],
                    _description: decoded[1],
                    _category: decoded[2],
                    _imageUri: decoded[3],
                    _proofUri: decoded[4],
                    _outcomeLabels: decoded[5],
                    _stage: Number(decoded[6]),
                    _winningOutcome: decoded[7],
                    _createdAt: decoded[8],
                    _marketDeadline: decoded[9],
                    _totalVolumeWei: decoded[10],
                    _participantCount: decoded[11],
                    _cancelReason: decoded[12],
                    _cancelProofUri: decoded[13],
                  };
                  decodedCount += 1;
                } catch {
                  slots[start + i] = null;
                }
              }

              if (decodedCount === 0 && chunk.length > 0) {
                throw new Error('eth_callMany decode yielded zero results');
              }
            })
            .catch(async () => {
              await Promise.all(
                chunk.map(async (call, localIdx) => {
                  try {
                    const raw = await readProvider.call({ to: call.to, data: call.data });
                    const decoded = infoInterface.decodeFunctionResult('getMarketInfo', raw) as unknown as [
                      string,
                      string,
                      string,
                      string,
                      string,
                      string[],
                      number,
                      bigint,
                      bigint,
                      bigint,
                      bigint,
                      bigint,
                      string,
                      string,
                    ];

                    slots[start + localIdx] = {
                      _title: decoded[0],
                      _description: decoded[1],
                      _category: decoded[2],
                      _imageUri: decoded[3],
                      _proofUri: decoded[4],
                      _outcomeLabels: decoded[5],
                      _stage: Number(decoded[6]),
                      _winningOutcome: decoded[7],
                      _createdAt: decoded[8],
                      _marketDeadline: decoded[9],
                      _totalVolumeWei: decoded[10],
                      _participantCount: decoded[11],
                      _cancelReason: decoded[12],
                      _cancelProofUri: decoded[13],
                    };
                  } catch {
                    slots[start + localIdx] = null;
                  }
                }),
              );
            });
        }),
      );

      for (let i = 0; i < result.length; i += 1) {
        const info = slots[i];
        if (!info) continue;
        result[i] = {
          ...result[i],
          description: info._description,
          createdAt: Number(info._createdAt),
          proofUri: info._proofUri,
          cancelReason: info._cancelReason || '',
          cancelProofUri: info._cancelProofUri || '',
        };
      }

      if (latestFetchKeyRef.current !== cacheKey) return;

      ownerMarketsCache.set(cacheKey, result);
      ownerMarketsCacheAt.set(cacheKey, Date.now());
      setMarkets(result);

      // Fetch accurate volumes from BlockScout events (buys + sells)
      const addresses = result.map((m) => m.market);
      fetchAllMarketVolumes(addresses).then((volumes) => {
        if (latestFetchKeyRef.current !== cacheKey) return;
        if (volumes.size === 0) return;
        setMarkets((prev) => {
          if (latestFetchKeyRef.current !== cacheKey) return prev;
          const next = prev.map((m) => {
            const vol = volumes.get(m.market.toLowerCase());
            return vol !== undefined ? { ...m, totalVolumeWei: vol } : m;
          });

          ownerMarketsCache.set(cacheKey, next);
          ownerMarketsCacheAt.set(cacheKey, Date.now());
          return next;
        });
      }).catch((err) => {
        console.warn('BlockScout volume fetch failed, using on-chain values:', err);
      });
    } catch (err) {
      console.error('Failed to fetch markets:', err);
    } finally {
      setLoading(false);
    }
  }, [readProvider, getCacheKey]);

  const refetch = useCallback(() => {
    void fetchAll(true);
  }, [fetchAll]);

  useEffect(() => {
    void fetchAll(false);
  }, [fetchAll]);

  return { markets, loading, refetch };
}

// Reusable market card for owner views
interface OwnerCardProps {
  market: OwnerMarketData;
  actions?: React.ReactNode;
  urgentBadge?: string;
}

export function OwnerMarketCard({ market, actions, urgentBadge }: OwnerCardProps) {
  const isActive = market.stage === STAGE.Active;
  const isSuspended = market.stage === STAGE.Suspended;
  const isResolved = market.stage === STAGE.Resolved;
  const isCancelled = market.stage === STAGE.Cancelled || market.stage === STAGE.Expired;
  const parsed = parseDescription(market.description ?? '');

  return (
    <div className={`card overflow-hidden animate-fade-in transition-all duration-300 ${
      isResolved ? 'ring-2 ring-emerald-500/30' : isCancelled ? 'ring-2 ring-red-500/20' : ''
    }`}>
      <div className="flex flex-col sm:flex-row">
        {/* Image */}
        <div className="relative w-full sm:w-48 h-36 sm:h-auto flex-shrink-0 overflow-hidden">
          <ImageWithFallback 
            src={market.imageUri} 
            alt={market.title} 
            className={`w-full h-full transition-all duration-300 ${
              isCancelled ? 'grayscale-[0.5] opacity-70' : ''
            }`} 
          />
          <div className="absolute inset-0 bg-gradient-to-r from-transparent to-dark-800/20 hidden sm:block" />
          <div className="absolute inset-0 bg-gradient-to-t from-dark-900/60 to-transparent sm:hidden" />
          {/* Mobile badges overlay */}
          <div className="absolute top-3 left-3 flex gap-1.5 sm:hidden">
            <span className={`badge-sm ${STAGE_COLORS[market.stage]}`}>{STAGE_LABELS[market.stage]}</span>
            {urgentBadge && (
              <span className="badge-sm bg-yellow-500/20 text-yellow-400 border-yellow-500/30 animate-pulse">
                {urgentBadge}
              </span>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 p-4 sm:p-5">
          {/* Desktop badges */}
          <div className="hidden sm:flex items-center gap-2 mb-2">
            <span className={`badge ${STAGE_COLORS[market.stage]}`}>{STAGE_LABELS[market.stage]}</span>
            <span className="badge bg-dark-750/80 text-dark-300 border-white/[0.08]">{market.category}</span>
            {parsed.subcategory && (
              <span className="badge bg-primary-500/15 text-primary-300 border-primary-500/25">
                {titleCase(parsed.subcategory)}
              </span>
            )}
            {urgentBadge && (
              <span className="badge bg-yellow-500/20 text-yellow-400 border-yellow-500/30 animate-pulse">
                {urgentBadge}
              </span>
            )}
          </div>

          <h3 className={`font-semibold leading-tight text-sm sm:text-base ${
            isResolved ? 'text-emerald-400' : isCancelled ? 'text-red-400/80' : 'text-white'
          }`}>{market.title}</h3>
          
          <p className="text-xs sm:text-sm text-dark-400 line-clamp-2 mt-1.5 mb-3">{parsed.description}</p>

          <ProbabilityBar
            labels={market.outcomeLabels}
            probabilities={market.impliedProbabilitiesWad}
            winningOutcome={market.winningOutcome}
            isResolved={market.stage === STAGE.Resolved}
            compact
          />

          {/* Stats row */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3 text-xs text-dark-400">
            <span className="flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              {formatCompactUSDC(market.totalVolumeWei)} USDC
            </span>
            <span className="flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
              {market.participants}
            </span>
            {isActive || isSuspended ? (
              <span className="flex items-center gap-1">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <Countdown deadline={market.marketDeadline} compact className="text-dark-300" />
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                {formatDate(market.marketDeadline)}
              </span>
            )}
          </div>

          {/* Actions */}
          {actions && (
            <div className="mt-4 pt-3 border-t border-white/[0.08] flex flex-wrap gap-2">
              {actions}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Resolve Modal
interface ResolveModalProps {
  market: OwnerMarketData;
  onClose: () => void;
  onResolved: () => void;
}

interface ExtraLink {
  type: 'image' | 'link';
  url: string;
}

interface UploadedMediaMeta {
  key: string;
  url: string;
}

function parseUploadedMarketMedia(value: string): UploadedMediaMeta | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith('uploaded:')) return null;
  const payload = trimmed.slice('uploaded:'.length);
  const separatorIndex = payload.indexOf('::');
  if (separatorIndex <= 0) return null;
  const key = payload.slice(0, separatorIndex).trim();
  const url = payload.slice(separatorIndex + 2).trim();
  if (!key || !url) return null;
  return { key, url };
}

function toStoredMarketMediaString(key: string, url: string): string {
  return `uploaded:${key}::${url}`;
}

function toReadableMarketMediaValue(value: string): string {
  const parsed = parseUploadedMarketMedia(value);
  return parsed?.url ?? value;
}

export function ResolveModal({ market, onClose, onResolved }: ResolveModalProps) {
  const { signer, address } = useWallet();
  const [selectedOutcome, setSelectedOutcome] = useState<number | null>(null);
  const [imageProof, setImageProof] = useState('');
  const [imageProofKey, setImageProofKey] = useState('');
  const [imageProofMeta, setImageProofMeta] = useState<{ bytes: number; type: string } | null>(null);
  const [imageProofUploading, setImageProofUploading] = useState(false);
  const [mainLink, setMainLink] = useState('');
  const [mainLinkUploadKey, setMainLinkUploadKey] = useState('');
  const [mainLinkUploadMeta, setMainLinkUploadMeta] = useState<{ bytes: number; type: string } | null>(null);
  const [mainLinkUploading, setMainLinkUploading] = useState(false);
  const [extraLinks, setExtraLinks] = useState<ExtraLink[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const imageProofFileInputRef = useRef<HTMLInputElement | null>(null);
  const mainLinkImageInputRef = useRef<HTMLInputElement | null>(null);
  const latestMainLinkRef = useRef(mainLink);
  const keepUploadedProofOnCloseRef = useRef(false);
  const latestImageProofRef = useRef(imageProof);
  const addressRef = useRef(address);
  const signerRef = useRef(signer);

  latestImageProofRef.current = imageProof;
  latestMainLinkRef.current = mainLink;
  addressRef.current = address;
  signerRef.current = signer;

  useEffect(() => {
    return () => {
      if (keepUploadedProofOnCloseRef.current) return;
      const uploaded = parseUploadedMarketMedia(latestImageProofRef.current);
      if (uploaded?.key && signerRef.current && addressRef.current) {
        deleteMarketMedia(addressRef.current, uploaded.key, signerRef.current).catch(() => {});
      }
      const uploadedMain = parseUploadedMarketMedia(latestMainLinkRef.current);
      if (uploadedMain?.key && signerRef.current && addressRef.current) {
        deleteMarketMedia(addressRef.current, uploadedMain.key, signerRef.current).catch(() => {});
      }
    };
  }, []);

  const proofUri = [
    toReadableMarketMediaValue(imageProof.trim()),
    toReadableMarketMediaValue(mainLink.trim()),
    ...extraLinks.filter(l => l.url.trim()).map(l => `${l.type}:${toReadableMarketMediaValue(l.url.trim())}`)
  ].filter(Boolean).join(' || ');

  const canSubmit = selectedOutcome !== null && imageProof.trim().length > 0 && !submitting && !imageProofUploading && !mainLinkUploading;

  const addExtraLink = () => {
    setExtraLinks([...extraLinks, { type: 'link', url: '' }]);
  };

  const removeExtraLink = (index: number) => {
    setExtraLinks(extraLinks.filter((_, i) => i !== index));
  };

  const updateExtraLink = (index: number, field: 'type' | 'url', value: string) => {
    const updated = [...extraLinks];
    updated[index] = { ...updated[index], [field]: value };
    setExtraLinks(updated);
  };

  const handleImageProofUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    if (!selected) return;
    if (!address || !signer) {
      setError('Connect owner wallet to upload proof images.');
      event.target.value = '';
      return;
    }

    let uploadedKeyToCleanup: string | null = null;
    try {
      setImageProofUploading(true);
      setError(null);
      const compressed = await compressMarketImage(selected);
      const uploaded = await uploadMarketMedia(compressed.file, address, signer, 'resolution-proof');
      uploadedKeyToCleanup = uploaded.key;

      const previous = parseUploadedMarketMedia(imageProof);
      if (previous?.key) {
        try {
          await deleteMarketMedia(address, previous.key, signer);
        } catch (cleanupErr) {
          console.warn('Failed to cleanup previous proof image:', cleanupErr);
        }
      }

      setImageProof(toStoredMarketMediaString(uploaded.key, uploaded.url));
      setImageProofKey(uploaded.key);
      setImageProofMeta({ bytes: uploaded.byteLength, type: uploaded.contentType });
      uploadedKeyToCleanup = null;
    } catch (err) {
      if (uploadedKeyToCleanup) {
        try {
          await deleteMarketMedia(address, uploadedKeyToCleanup, signer);
        } catch (cleanupErr) {
          console.warn('Failed to cleanup uploaded proof image:', cleanupErr);
        }
      }
      const message = err instanceof Error ? err.message : 'Failed to upload proof image.';
      setError(message);
    } finally {
      setImageProofUploading(false);
      event.target.value = '';
    }
  };

  const handleMainLinkImageUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    if (!selected) return;
    if (!address || !signer) {
      setError('Connect owner wallet to upload proof images.');
      event.target.value = '';
      return;
    }

    let uploadedKeyToCleanup: string | null = null;
    try {
      setMainLinkUploading(true);
      setError(null);
      const compressed = await compressMarketImage(selected);
      const uploaded = await uploadMarketMedia(compressed.file, address, signer, 'resolution-proof');
      uploadedKeyToCleanup = uploaded.key;

      const previous = parseUploadedMarketMedia(mainLink);
      if (previous?.key) {
        try {
          await deleteMarketMedia(address, previous.key, signer);
        } catch (cleanupErr) {
          console.warn('Failed to cleanup previous main proof image:', cleanupErr);
        }
      }

      setMainLink(toStoredMarketMediaString(uploaded.key, uploaded.url));
      setMainLinkUploadKey(uploaded.key);
      setMainLinkUploadMeta({ bytes: uploaded.byteLength, type: uploaded.contentType });
      uploadedKeyToCleanup = null;
    } catch (err) {
      if (uploadedKeyToCleanup) {
        try {
          await deleteMarketMedia(address, uploadedKeyToCleanup, signer);
        } catch (cleanupErr) {
          console.warn('Failed to cleanup uploaded main proof image:', cleanupErr);
        }
      }
      const message = err instanceof Error ? err.message : 'Failed to upload main proof image.';
      setError(message);
    } finally {
      setMainLinkUploading(false);
      event.target.value = '';
    }
  };

  const handleSubmit = async () => {
    if (!signer || selectedOutcome === null || !proofUri) return;
    setSubmitting(true);
    setError(null);
    try {
      const marketContract = new ethers.Contract(market.market, MARKET_ABI, signer);
      const tx = await marketContract.resolve(selectedOutcome, proofUri);
      await tx.wait();
      keepUploadedProofOnCloseRef.current = true;
      onResolved();
    } catch (err) {
      setError(parseContractError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const imageProofUrl = toReadableMarketMediaValue(imageProof);

  const removeUploadedImageProof = async () => {
    const uploaded = parseUploadedMarketMedia(imageProof);
    if (uploaded?.key && address && signer) {
      try {
        await deleteMarketMedia(address, uploaded.key, signer);
      } catch (cleanupErr) {
        console.warn('Failed to cleanup resolution proof image:', cleanupErr);
      }
    }
    setImageProof('');
    setImageProofKey('');
    setImageProofMeta(null);
  };

  const removeUploadedMainLinkImage = async () => {
    const uploaded = parseUploadedMarketMedia(mainLink);
    if (uploaded?.key && address && signer) {
      try {
        await deleteMarketMedia(address, uploaded.key, signer);
      } catch (cleanupErr) {
        console.warn('Failed to cleanup main proof image:', cleanupErr);
      }
    }
    setMainLink('');
    setMainLinkUploadKey('');
    setMainLinkUploadMeta(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-dark-950/80 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div className="relative card w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 animate-slide-up">
        <button onClick={onClose} className="absolute top-4 right-4 w-8 h-8 rounded-lg bg-dark-750 border border-white/[0.08] flex items-center justify-center text-dark-400 hover:text-white hover:border-white/[0.15] transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
            <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </div>
          <h2 className="text-xl font-bold text-white">Resolve Market</h2>
        </div>

        {/* Context */}
        <div className="p-4 rounded-xl bg-dark-900/60 border border-white/[0.06] mb-6">
          <div className="flex gap-3">
            <ImageWithFallback src={market.imageUri} alt={market.title} className="w-14 h-14 rounded-xl flex-shrink-0" />
            <div className="min-w-0">
              <h3 className="font-semibold text-white text-sm leading-tight">{market.title}</h3>
              <p className="text-xs text-dark-400 line-clamp-2 mt-1">{parseDescription(market.description ?? '').description}</p>
            </div>
          </div>
        </div>

        {/* Select winning outcome */}
        <label className="label">Select Winning Outcome *</label>
        <div className="space-y-2 mb-6">
          {market.outcomeLabels.map((label, i) => (
            <button
              key={i}
              onClick={() => setSelectedOutcome(i)}
              className={`w-full p-3.5 rounded-xl text-left text-sm transition-all border flex items-center gap-3 ${
                selectedOutcome === i
                  ? 'border-emerald-500/40 bg-emerald-500/10'
                  : 'border-white/[0.08] bg-dark-900/40 hover:border-white/[0.12] hover:bg-dark-800/40'
              }`}
            >
              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                selectedOutcome === i ? 'border-emerald-500' : 'border-dark-600'
              }`}>
                {selectedOutcome === i && <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />}
              </div>
              <span className={`font-medium ${selectedOutcome === i ? 'text-white' : 'text-dark-300'}`}>{label}</span>
              {selectedOutcome === i && (
                <span className="ml-auto badge-sm bg-emerald-500/15 text-emerald-400 border-emerald-500/25">Winner</span>
              )}
            </button>
          ))}
        </div>

        {/* Proof URI */}
        <label className="label">Resolution Proof *</label>
        <div className="space-y-3 mb-4">
          {/* Image Proof - Required */}
          <input
            ref={imageProofFileInputRef}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={handleImageProofUpload}
            disabled={imageProofUploading || submitting}
          />
          <button
            type="button"
            onClick={() => imageProofFileInputRef.current?.click()}
            disabled={imageProofUploading || submitting}
            className={`w-full text-left rounded-xl border border-dashed border-white/[0.2] bg-dark-900/50 p-3 transition-colors ${
              imageProofUploading || submitting
                ? 'opacity-60 cursor-not-allowed'
                : 'hover:border-emerald-400/40 hover:bg-dark-850/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/40'
            }`}
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-emerald-500/15 border border-emerald-400/30 flex items-center justify-center">
                <svg className="w-4 h-4 text-emerald-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
              </div>
              <div>
                <p className="text-xs font-semibold text-white">
                  {imageProofUploading ? 'Uploading proof image...' : 'Upload proof image to R2'}
                </p>
                <p className="text-2xs text-dark-500">Auto-compressed · max 2MB · secure signed upload</p>
              </div>
            </div>
          </button>

          {imageProofMeta && (
            <div className="text-2xs text-dark-500 flex flex-wrap gap-2">
              <span>{Math.max(1, Math.round(imageProofMeta.bytes / 1024))}KB · {imageProofMeta.type}</span>
              {imageProofKey && <span>key:{imageProofKey.slice(-20)}</span>}
              <button
                type="button"
                onClick={removeUploadedImageProof}
                disabled={imageProofUploading || submitting}
                className="text-red-300 hover:text-red-200"
              >
                Remove uploaded proof
              </button>
            </div>
          )}

          <div>
            <span className="text-xs text-dark-400 mb-1.5 block">Image Proof <span className="text-red-400">*</span></span>
            <input
              type="text"
              value={imageProofUrl}
              onChange={e => {
                const previous = parseUploadedMarketMedia(imageProof);
                if (previous?.key && address && signer) {
                  deleteMarketMedia(address, previous.key, signer).catch(() => {});
                }
                setImageProof(e.target.value);
                setImageProofKey('');
                setImageProofMeta(null);
              }}
              placeholder="https://... (screenshot, image URL)"
              className="input-field"
            />
          </div>

          {/* Main Link - Optional */}
          <div>
            <span className="text-xs text-dark-400 mb-1.5 block">Main Proof Link (optional)</span>
            <input
              ref={mainLinkImageInputRef}
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={handleMainLinkImageUpload}
              disabled={mainLinkUploading || imageProofUploading || submitting}
            />
            <button
              type="button"
              onClick={() => mainLinkImageInputRef.current?.click()}
              disabled={mainLinkUploading || imageProofUploading || submitting}
              className={`w-full text-left rounded-xl border border-dashed border-white/[0.2] bg-dark-900/50 p-3 transition-colors mb-2 ${
                mainLinkUploading || imageProofUploading || submitting
                  ? 'opacity-60 cursor-not-allowed'
                  : 'hover:border-primary-400/40 hover:bg-dark-850/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/40'
              }`}
            >
              <p className="text-xs font-semibold text-white">
                {mainLinkUploading ? 'Uploading main proof image...' : 'Upload image as main proof link'}
              </p>
              <p className="text-2xs text-dark-500">Optional visual source stored on R2</p>
            </button>

            {mainLinkUploadMeta && (
              <div className="text-2xs text-dark-500 flex flex-wrap gap-2 mb-2">
                <span>{Math.max(1, Math.round(mainLinkUploadMeta.bytes / 1024))}KB · {mainLinkUploadMeta.type}</span>
                {mainLinkUploadKey && <span>key:{mainLinkUploadKey.slice(-20)}</span>}
                <button
                  type="button"
                  onClick={removeUploadedMainLinkImage}
                  disabled={mainLinkUploading || submitting}
                  className="text-red-300 hover:text-red-200"
                >
                  Remove uploaded main proof
                </button>
              </div>
            )}

            <input
              type="text"
              value={toReadableMarketMediaValue(mainLink)}
              onChange={e => {
                const previous = parseUploadedMarketMedia(mainLink);
                if (previous?.key && address && signer) {
                  deleteMarketMedia(address, previous.key, signer).catch(() => {});
                }
                setMainLink(e.target.value);
                setMainLinkUploadKey('');
                setMainLinkUploadMeta(null);
              }}
              placeholder="https://... (tweet, news article, website)"
              className="input-field"
            />
          </div>

          {/* Extra Links */}
          {extraLinks.map((link, index) => (
            <div key={index} className="flex items-center gap-2">
              <select
                value={link.type}
                onChange={e => updateExtraLink(index, 'type', e.target.value)}
                className="select-field w-24 flex-shrink-0"
              >
                <option value="link">Link</option>
                <option value="image">Image</option>
              </select>
              <input
                type="text"
                value={link.url}
                onChange={e => updateExtraLink(index, 'url', e.target.value)}
                placeholder="https://..."
                className="input-field flex-1"
              />
              <button
                type="button"
                onClick={() => removeExtraLink(index)}
                className="w-8 h-8 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400 hover:bg-red-500/20 transition-colors flex-shrink-0"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}

          <button
            type="button"
            onClick={addExtraLink}
            className="text-xs text-primary-400 hover:text-primary-300 font-medium flex items-center gap-1"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add Extra Link
          </button>
        </div>

        {/* Preview */}
        {proofUri && (
          <div className="p-3 rounded-xl bg-primary-500/5 border border-primary-500/15 mb-4">
            <p className="text-xs font-medium text-primary-400 mb-2">Preview ({proofUri.split('||').length} items):</p>
            <div className="space-y-1">
              {proofUri.split('||').map((link, i) => {
                const trimmed = link.trim();
                const colonIndex = trimmed.indexOf(':');
                let displayText = trimmed;
                let href = trimmed;
                if (colonIndex > 0) {
                  const prefix = trimmed.slice(0, colonIndex).toLowerCase();
                  if (prefix === 'image' || prefix === 'link') {
                    displayText = trimmed.slice(colonIndex + 1).trim();
                    href = displayText;
                  }
                }
                const readableHref = toReadableMarketMediaValue(href);
                const readableDisplay = toReadableMarketMediaValue(displayText);
                return (
                  <a 
                    key={i} 
                    href={readableHref} 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className="text-xs text-primary-300 hover:text-primary-200 underline break-all block"
                  >
                    {i + 1}. {readableDisplay}
                  </a>
                );
              })}
            </div>
          </div>
        )}

        {error && (
          <div className="p-3 rounded-xl bg-red-500/10 text-red-400 border border-red-500/20 text-sm mb-4 flex items-start gap-2">
            <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <span>{error}</span>
          </div>
        )}

        <div className="flex gap-3">
          <button onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="btn-success flex-1 font-semibold"
          >
            {submitting ? (
              <span className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-green-300/30 border-t-green-300 rounded-full animate-spin" />
                Resolving...
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                Confirm Resolution
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// Edit Modal
interface EditModalProps {
  market: OwnerMarketData;
  onClose: () => void;
  onEdited: () => void;
}

export function EditModal({ market, onClose, onEdited }: EditModalProps) {
  const { signer } = useWallet();
  const [title, setTitle] = useState(market.title);
  const [description, setDescription] = useState(market.description);
  const [category, setCategory] = useState(market.category);
  const [customDays, setCustomDays] = useState('');
  const [customHours, setCustomHours] = useState('');
  const [removeTime, setRemoveTime] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submittingDeadline, setSubmittingDeadline] = useState(false);
  const [submittingSuspend, setSubmittingSuspend] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deadlineError, setDeadlineError] = useState<string | null>(null);

  const isSuspended = market.stage === STAGE.Suspended;
  const isActiveOrSuspended = market.stage === STAGE.Active || market.stage === STAGE.Suspended;

  const hasChanges = title.trim() !== market.title || description.trim() !== market.description || category.trim() !== market.category;
  const canSubmit = title.trim().length > 0 && category.trim().length > 0 && hasChanges && !submitting;

  const currentTimestamp = Math.floor(Date.now() / 1000);
  const customSeconds = ((parseInt(customDays) || 0) * 86400 + (parseInt(customHours) || 0) * 3600);
  const adjustment = removeTime ? -customSeconds : customSeconds;
  const newDeadlineTimestamp = customSeconds > 0 ? market.marketDeadline + adjustment : 0;
  const canSubmitDeadline = newDeadlineTimestamp > currentTimestamp && !submittingDeadline && customSeconds > 0;

  useEffect(() => {
    if (customSeconds <= 0 && (customDays || customHours)) {
      setDeadlineError('Please enter a time adjustment');
    } else {
      setDeadlineError(null);
    }
  }, [customDays, customHours, customSeconds]);

  const handleSubmit = async () => {
    if (!signer || !canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const marketContract = new ethers.Contract(market.market, MARKET_ABI, signer);
      const tx = await marketContract.editMarket(title.trim(), description.trim(), category.trim());
      await tx.wait();
      onEdited();
    } catch (err) {
      setError(parseContractError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeadlineSubmit = async () => {
    if (!signer || !canSubmitDeadline) return;
    setSubmittingDeadline(true);
    setError(null);
    try {
      const marketContract = new ethers.Contract(market.market, MARKET_ABI, signer);
      const tx = await marketContract.editDeadline(newDeadlineTimestamp);
      await tx.wait();
      onEdited();
    } catch (err) {
      setError(parseContractError(err));
    } finally {
      setSubmittingDeadline(false);
    }
  };

  const handleSuspendResume = async () => {
    if (!signer) return;
    setSubmittingSuspend(true);
    setError(null);
    try {
      const marketContract = new ethers.Contract(market.market, MARKET_ABI, signer);
      const tx = isSuspended 
        ? await marketContract.resume()
        : await marketContract.suspend();
      await tx.wait();
      onEdited();
    } catch (err) {
      setError(parseContractError(err));
    } finally {
      setSubmittingSuspend(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-dark-950/80 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div className="relative card w-full max-w-lg p-6 animate-slide-up max-h-[90vh] overflow-y-auto">
        <button onClick={onClose} className="absolute top-4 right-4 w-8 h-8 rounded-lg bg-dark-750 border border-white/[0.08] flex items-center justify-center text-dark-400 hover:text-white hover:border-white/[0.15] transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-primary-500/10 border border-primary-500/20 flex items-center justify-center">
            <svg className="w-5 h-5 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Edit Market</h2>
            <p className="text-xs text-dark-400">Update title, description, category, deadline, or suspend</p>
          </div>
        </div>

        {/* Title */}
        <label className="label">Title <span className="text-red-400">*</span></label>
        <input
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Market title..."
          className="input-field mb-3"
        />

        {/* Category */}
        <label className="label">Category <span className="text-red-400">*</span></label>
        <input
          type="text"
          value={category}
          onChange={e => setCategory(e.target.value)}
          placeholder="e.g., Crypto, Sports, Politics..."
          className="input-field mb-3"
        />

        {/* Description */}
        <label className="label">Description</label>
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Market description..."
          rows={3}
          className="input-field mb-1 resize-none"
        />
        <p className="text-2xs text-dark-500 mb-4">Changes are permanent and visible to all users.</p>

        {/* Save Button for Title/Description/Category */}
        <button 
          onClick={handleSubmit} 
          disabled={!canSubmit} 
          className="btn-primary w-full font-semibold mb-5"
        >
          {submitting ? (
            <span className="flex items-center justify-center gap-2">
              <div className="w-4 h-4 border-2 border-primary-300/30 border-t-primary-300 rounded-full animate-spin" />
              Saving...
            </span>
          ) : (
            <span className="flex items-center justify-center gap-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              Save Changes
            </span>
          )}
        </button>

        {/* Divider */}
        <div className="border-t border-white/[0.08] my-5" />

        {/* Deadline Section */}
        <div className="mb-5">
          <div className="flex items-center justify-between mb-2">
            <label className="label mb-0">Deadline</label>
            <span className="text-2xs text-dark-500">
              Current: {new Date(market.marketDeadline * 1000).toLocaleString()}
            </span>
          </div>
          <div className="flex gap-2 mt-2 mb-3">
            <button
              onClick={() => setRemoveTime(false)}
              className={`flex-1 py-2 px-3 rounded-lg text-xs font-medium transition-colors ${
                !removeTime 
                  ? 'bg-green-500/20 text-green-400 border border-green-500/30' 
                  : 'bg-dark-800 text-dark-400 border border-white/[0.08]'
              }`}
            >
              + Add Time
            </button>
            <button
              onClick={() => setRemoveTime(true)}
              className={`flex-1 py-2 px-3 rounded-lg text-xs font-medium transition-colors ${
                removeTime 
                  ? 'bg-red-500/20 text-red-400 border border-red-500/30' 
                  : 'bg-dark-800 text-dark-400 border border-white/[0.08]'
              }`}
            >
              - Remove Time
            </button>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs text-dark-400 mb-1 block">Days</label>
              <input
                type="number"
                value={customDays}
                onChange={e => setCustomDays(String(Math.max(0, parseInt(e.target.value) || 0)))}
                min="0"
                placeholder="0"
                className="input-field"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs text-dark-400 mb-1 block">Hours</label>
              <input
                type="number"
                value={customHours}
                onChange={e => setCustomHours(String(Math.min(23, Math.max(0, parseInt(e.target.value) || 0))))}
                min="0"
                max="23"
                placeholder="0"
                className="input-field"
              />
            </div>
          </div>
          {deadlineError && (
            <div className="mt-2 text-xs text-red-400">
              {deadlineError}
            </div>
          )}
          {newDeadlineTimestamp > 0 && (
            <div className="mt-3 p-3 rounded-xl bg-dark-900/40 border border-white/[0.06] flex items-center gap-2">
              <svg className="w-4 h-4 text-dark-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <p className="text-xs text-dark-400">
                New deadline: <span className="text-white font-medium">{new Date(newDeadlineTimestamp * 1000).toLocaleString()}</span>
              </p>
            </div>
          )}
          <button 
            onClick={handleDeadlineSubmit} 
            disabled={!canSubmitDeadline}
            className="btn-secondary w-full mt-3"
          >
            {submittingDeadline ? (
              <span className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Updating...
              </span>
            ) : (
              'Update Deadline'
            )}
          </button>
        </div>

        {/* Divider */}
        <div className="border-t border-white/[0.08] my-5" />

        {/* Suspend/Resume Section */}
        <div className="mb-4">
          <label className="label">Market Status</label>
          <div className="flex items-center justify-between p-3 rounded-xl bg-dark-900/60 border border-white/[0.06]">
            <div className="flex items-center gap-2">
              {isSuspended ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
                  <span className="text-sm text-yellow-400">Suspended</span>
                </>
              ) : (
                <>
                  <span className="w-2 h-2 rounded-full bg-green-500" />
                  <span className="text-sm text-green-400">Active</span>
                </>
              )}
            </div>
            {isActiveOrSuspended && (
              <button 
                onClick={handleSuspendResume} 
                disabled={submittingSuspend}
                className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                  isSuspended 
                    ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30' 
                    : 'bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30'
                }`}
              >
                {submittingSuspend ? (
                  <div className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                ) : isSuspended ? (
                  'Resume Trading'
                ) : (
                  'Suspend Trading'
                )}
              </button>
            )}
          </div>
          <p className="text-2xs text-dark-500 mt-2">
            {isSuspended 
              ? 'Trading is currently paused. Users cannot buy or sell. Click Resume to re-enable trading.'
              : 'Suspend to pause all trading. Users will not be able to buy or sell until you resume.'
            }
          </p>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-red-500/10 text-red-400 border border-red-500/20 text-sm mt-4 flex items-start gap-2">
            <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <span>{error}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// Cancel Modal
interface CancelModalProps {
  market: OwnerMarketData;
  onClose: () => void;
  onCancelled: () => void;
}

export function CancelModal({ market, onClose, onCancelled }: CancelModalProps) {
  const { signer, address } = useWallet();
  const [reason, setReason] = useState('');
  const [proofUri, setProofUri] = useState('');
  const [proofImageKey, setProofImageKey] = useState('');
  const [proofImageMeta, setProofImageMeta] = useState<{ bytes: number; type: string } | null>(null);
  const [proofImageUploading, setProofImageUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const proofImageFileInputRef = useRef<HTMLInputElement | null>(null);
  const keepUploadedProofOnCloseRef = useRef(false);
  const latestProofUriRef = useRef(proofUri);
  const addressRef = useRef(address);
  const signerRef = useRef(signer);

  latestProofUriRef.current = proofUri;
  addressRef.current = address;
  signerRef.current = signer;

  const canSubmit = reason.trim().length > 0 && proofUri.trim().length > 0 && !submitting && !proofImageUploading;
  const proofPreviewUrl = toReadableMarketMediaValue(proofUri.trim());

  useEffect(() => {
    return () => {
      if (keepUploadedProofOnCloseRef.current) return;
      const uploaded = parseUploadedMarketMedia(latestProofUriRef.current);
      if (uploaded?.key && signerRef.current && addressRef.current) {
        deleteMarketMedia(addressRef.current, uploaded.key, signerRef.current).catch(() => {});
      }
    };
  }, []);

  const handleProofImageUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    if (!selected) return;
    if (!address || !signer) {
      setError('Connect owner wallet to upload cancellation proof image.');
      event.target.value = '';
      return;
    }

    let uploadedKeyToCleanup: string | null = null;
    try {
      setProofImageUploading(true);
      setError(null);
      const compressed = await compressMarketImage(selected);
      const uploaded = await uploadMarketMedia(compressed.file, address, signer, 'cancellation-proof');
      uploadedKeyToCleanup = uploaded.key;

      const previous = parseUploadedMarketMedia(proofUri);
      if (previous?.key) {
        try {
          await deleteMarketMedia(address, previous.key, signer);
        } catch (cleanupErr) {
          console.warn('Failed to cleanup previous cancellation proof image:', cleanupErr);
        }
      }

      setProofUri(toStoredMarketMediaString(uploaded.key, uploaded.url));
      setProofImageKey(uploaded.key);
      setProofImageMeta({ bytes: uploaded.byteLength, type: uploaded.contentType });
      uploadedKeyToCleanup = null;
    } catch (err) {
      if (uploadedKeyToCleanup) {
        try {
          await deleteMarketMedia(address, uploadedKeyToCleanup, signer);
        } catch (cleanupErr) {
          console.warn('Failed to cleanup uploaded cancellation proof image:', cleanupErr);
        }
      }
      const message = err instanceof Error ? err.message : 'Failed to upload cancellation proof image.';
      setError(message);
    } finally {
      setProofImageUploading(false);
      event.target.value = '';
    }
  };

  const handleSubmit = async () => {
    if (!signer || !canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const marketContract = new ethers.Contract(market.market, MARKET_ABI, signer);
      const tx = await marketContract.cancel(reason.trim(), proofPreviewUrl);
      await tx.wait();
      keepUploadedProofOnCloseRef.current = true;
      onCancelled();
    } catch (err) {
      setError(parseContractError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const removeUploadedCancellationProof = async () => {
    const uploaded = parseUploadedMarketMedia(proofUri);
    if (uploaded?.key && address && signer) {
      try {
        await deleteMarketMedia(address, uploaded.key, signer);
      } catch (cleanupErr) {
        console.warn('Failed to cleanup cancellation proof image:', cleanupErr);
      }
    }
    setProofUri('');
    setProofImageKey('');
    setProofImageMeta(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-dark-950/80 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div className="relative card w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 animate-slide-up">
        <button onClick={onClose} className="absolute top-4 right-4 w-8 h-8 rounded-lg bg-dark-750 border border-white/[0.08] flex items-center justify-center text-dark-400 hover:text-white hover:border-white/[0.15] transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
            <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" /></svg>
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Cancel Market</h2>
            <p className="text-xs text-dark-400">This action cannot be undone</p>
          </div>
        </div>

        {/* Market context */}
        <div className="p-4 rounded-xl bg-dark-900/60 border border-white/[0.06] mb-5">
          <div className="flex gap-3">
            <ImageWithFallback src={market.imageUri} alt={market.title} className="w-14 h-14 rounded-xl flex-shrink-0" />
            <div className="min-w-0">
              <h3 className="font-semibold text-white text-sm leading-tight">{market.title}</h3>
              <p className="text-xs text-dark-400 line-clamp-2 mt-1">{parseDescription(market.description ?? '').description}</p>
            </div>
          </div>
        </div>

        <div className="p-3 rounded-xl bg-red-500/5 border border-red-500/10 mb-5">
          <p className="text-sm text-dark-300">
            Are you sure you want to cancel this market? All participants will be eligible for a <span className="text-white font-medium">full refund</span>.
          </p>
        </div>

        <label className="label">Cancellation Reason <span className="text-red-400">*</span></label>
        <textarea
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="Provide a detailed explanation for why this market is being cancelled. This will be publicly visible to all users..."
          rows={5}
          className="input-field mb-1 resize-none"
        />
        <p className="text-2xs text-dark-500 mb-4">Explain in detail why this market is being cancelled. Be transparent.</p>

        <label className="label">Proof / Evidence Image <span className="text-red-400">*</span></label>
        <input
          ref={proofImageFileInputRef}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={handleProofImageUpload}
          disabled={proofImageUploading || submitting}
        />
        <button
          type="button"
          onClick={() => proofImageFileInputRef.current?.click()}
          disabled={proofImageUploading || submitting}
          className={`w-full text-left rounded-xl border border-dashed border-white/[0.2] bg-dark-900/50 p-3 transition-colors mb-3 ${
            proofImageUploading || submitting
              ? 'opacity-60 cursor-not-allowed'
              : 'hover:border-red-400/40 hover:bg-dark-850/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/40'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-red-500/15 border border-red-400/30 flex items-center justify-center">
              <svg className="w-4 h-4 text-red-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>
            <div>
              <p className="text-xs font-semibold text-white">
                {proofImageUploading ? 'Uploading cancellation proof...' : 'Upload cancellation proof image to R2'}
              </p>
              <p className="text-2xs text-dark-500">Secure signed upload · auto-compressed · max 2MB</p>
            </div>
          </div>
        </button>

        {proofImageMeta && (
          <div className="text-2xs text-dark-500 flex flex-wrap gap-2 mb-2">
            <span>{Math.max(1, Math.round(proofImageMeta.bytes / 1024))}KB · {proofImageMeta.type}</span>
            {proofImageKey && <span>key:{proofImageKey.slice(-20)}</span>}
            <button
              type="button"
              onClick={removeUploadedCancellationProof}
              disabled={proofImageUploading || submitting}
              className="text-red-300 hover:text-red-200"
            >
              Remove uploaded proof
            </button>
          </div>
        )}

        <input
          type="text"
          value={proofPreviewUrl}
          onChange={e => {
            const previous = parseUploadedMarketMedia(proofUri);
            if (previous?.key && address && signer) {
              deleteMarketMedia(address, previous.key, signer).catch(() => {});
            }
            setProofUri(e.target.value);
            setProofImageKey('');
            setProofImageMeta(null);
          }}
          placeholder="https://... or ipfs://... (screenshot, evidence image)"
          className="input-field mb-1"
        />
        <p className="text-2xs text-dark-500 mb-4">Link to a screenshot or image that supports the cancellation reason</p>

        {/* Image preview */}
        {proofPreviewUrl && (
          <div className="mb-5 rounded-xl overflow-hidden border border-white/[0.08]">
            <img
              src={resolveImageUri(proofPreviewUrl)}
              alt="Cancel proof"
              className="w-full max-h-48 object-cover"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
            <div className="p-2.5 bg-dark-900/60 flex items-center gap-2">
              <svg className="w-3.5 h-3.5 text-primary-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
              <a href={resolveImageUri(proofPreviewUrl)} target="_blank" rel="noopener noreferrer" className="text-xs text-primary-400 hover:text-primary-300 underline break-all truncate">
                {proofPreviewUrl}
              </a>
            </div>
          </div>
        )}

        {error && (
          <div className="p-3 rounded-xl bg-red-500/10 text-red-400 border border-red-500/20 text-sm mb-4 flex items-start gap-2">
            <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <span>{error}</span>
          </div>
        )}

        <div className="flex gap-3">
          <button onClick={onClose} className="btn-secondary flex-1">Go Back</button>
          <button onClick={handleSubmit} disabled={!canSubmit} className="btn-danger flex-1 font-semibold">
            {submitting ? (
              <span className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-red-300/30 border-t-red-300 rounded-full animate-spin" />
                Cancelling...
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                Confirm Cancel
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}