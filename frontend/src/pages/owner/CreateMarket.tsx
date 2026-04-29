import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { ethers } from 'ethers';
import { useWallet } from '../../context/WalletContext';
import { FACTORY_ADDRESS } from '../../config/network';
import { FACTORY_ABI } from '../../config/abis';
import ImageWithFallback from '../../components/ImageWithFallback';
import ProbabilityBar from '../../components/ProbabilityBar';
import { parseContractError, makeMarketSlug } from '../../utils/format';
import { useDateTimePicker } from '../../hooks/useDateTimePicker';
import { compressMarketImage } from '../../utils/marketImage';
import { uploadMarketMedia, deleteMarketMedia } from '../../services/marketMedia';
import {
  fetchLiveFeedSuggestions,
  lookupSportsEventById,
  searchSportsEvents,
  saveLiveFeedConfig,
} from '../../services/live';
import type {
  LiveFeedConfigInput,
  LiveFeedSuggestionsResponse,
} from '../../types/live';

const CATEGORIES = ['Crypto', 'Sports', 'Politics', 'Entertainment', 'Science', 'Other'];
const DURATION_PRESETS = [
  { label: '1 Day', seconds: 86400 },
  { label: '3 Days', seconds: 259200 },
  { label: '7 Days', seconds: 604800 },
  { label: '14 Days', seconds: 1209600 },
  { label: '30 Days', seconds: 2592000 },
  { label: 'Custom', seconds: 0 },
];

const CATEGORY_ICONS: Record<string, string> = {
  Crypto: '\u20BF',
  Sports: '\u26BD',
  Politics: '\uD83C\uDFDB',
  Entertainment: '\uD83C\uDFAC',
  Science: '\uD83D\uDD2C',
  Other: '\u2022\u2022\u2022',
};

function SectionHeader({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle?: string }) {
  return (
    <div className="flex items-start gap-3 mb-4">
      <div className="w-8 h-8 rounded-lg bg-primary-500/10 border border-primary-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
        {icon}
      </div>
      <div>
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        {subtitle && <p className="text-xs text-dark-400 mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}

export default function CreateMarket() {
  const { signer, address } = useWallet();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [subcategory, setSubcategory] = useState('');
  const [category, setCategory] = useState('Crypto');
  const [customCategory, setCustomCategory] = useState('');
  const [imageUri, setImageUri] = useState('');
  const [imageUploading, setImageUploading] = useState(false);
  const [imageUploadMeta, setImageUploadMeta] = useState<{ bytes: number; type: string } | null>(null);
  const [imageUploadKey, setImageUploadKey] = useState('');
  const [localImagePreviewUrl, setLocalImagePreviewUrl] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState(['Yes', 'No']);
  const [durationPreset, setDurationPreset] = useState(604800);
  const [customDays, setCustomDays] = useState('');
  const [customHours, setCustomHours] = useState('');
  const [useCalendar, setUseCalendar] = useState(false);
  const deadlinePicker = useDateTimePicker();
  const [bValue, setBValue] = useState('1000');
  const [showBTooltip, setShowBTooltip] = useState(false);
  const [feedEnabled, setFeedEnabled] = useState(true);
  const [feedKind, setFeedKind] = useState<'crypto-price' | 'sports-score'>('crypto-price');
  const [feedCryptoMetric, setFeedCryptoMetric] = useState<'price' | 'market-cap' | 'volume-24h'>('price');
  const [feedCoingeckoId, setFeedCoingeckoId] = useState('bitcoin');
  const [feedBaseSymbol, setFeedBaseSymbol] = useState('BTC');
  const [feedQuoteSymbol, setFeedQuoteSymbol] = useState('USD');
  const [feedVsCurrency, setFeedVsCurrency] = useState('usd');
  const [feedEventId, setFeedEventId] = useState('');
  const [feedLeagueName, setFeedLeagueName] = useState('');
  const [feedHomeTeam, setFeedHomeTeam] = useState('');
  const [feedAwayTeam, setFeedAwayTeam] = useState('');
  const [feedForceUpcoming, setFeedForceUpcoming] = useState(false);
  const [feedCandidates, setFeedCandidates] = useState<LiveFeedSuggestionsResponse['sports']['candidates']>([]);
  const [feedSportsSearchQuery, setFeedSportsSearchQuery] = useState('');
  const [feedSportsSearchLoading, setFeedSportsSearchLoading] = useState(false);
  const [feedSportsSearchError, setFeedSportsSearchError] = useState('');
  const [feedEventLookupLoading, setFeedEventLookupLoading] = useState(false);
  const [feedEventLookupError, setFeedEventLookupError] = useState('');
  const [feedDetecting, setFeedDetecting] = useState(false);
  const [feedDetectionHint, setFeedDetectionHint] = useState('');
  const [feedDetectionError, setFeedDetectionError] = useState('');
  const [feedUserEdited, setFeedUserEdited] = useState(false);
  const [feedSaving, setFeedSaving] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [txResult, setTxResult] = useState<{ type: 'success' | 'error'; text: string; market?: string; marketId?: string } | null>(null);
  const imageFileInputRef = useRef<HTMLInputElement | null>(null);
  const latestImagePreviewRef = useRef<string | null>(null);
  const latestImageUploadKeyRef = useRef('');
  const addressRef = useRef(address);
  const signerRef = useRef(signer);
  const keepUploadedImageOnCloseRef = useRef(false);
  const feedDetectRequestIdRef = useRef(0);

  latestImageUploadKeyRef.current = imageUploadKey;
  addressRef.current = address;
  signerRef.current = signer;

  useEffect(() => {
    latestImagePreviewRef.current = localImagePreviewUrl;
  }, [localImagePreviewUrl]);

  useEffect(() => {
    return () => {
      if (latestImagePreviewRef.current) {
        URL.revokeObjectURL(latestImagePreviewRef.current);
      }
      if (!keepUploadedImageOnCloseRef.current) {
        const key = latestImageUploadKeyRef.current;
        if (key && addressRef.current && signerRef.current) {
          deleteMarketMedia(addressRef.current, key, signerRef.current).catch(() => {});
        }
      }
    };
  }, []);

  const actualCategory = category === 'Other' ? customCategory : category;
  const durationFromPreset = durationPreset > 0
    ? durationPreset
    : (parseInt(customDays || '0') * 86400) + (parseInt(customHours || '0') * 3600);
  const calendarDuration = useCalendar && deadlinePicker.value
    ? Math.max(0, Math.floor((new Date(deadlinePicker.value).getTime() - Date.now()) / 1000))
    : 0;
  const durationSeconds = useCalendar ? calendarDuration : durationFromPreset;
  const expiryDate = useCalendar && deadlinePicker.value
    ? new Date(deadlinePicker.value)
    : new Date(Date.now() + durationSeconds * 1000);

  const addOutcome = () => setOutcomes([...outcomes, '']);
  const removeOutcome = (index: number) => {
    if (outcomes.length <= 2) return;
    setOutcomes(outcomes.filter((_, i) => i !== index));
  };
  const updateOutcome = (index: number, value: string) => {
    const updated = [...outcomes];
    updated[index] = value;
    setOutcomes(updated);
  };

  const handleImageFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    if (!selected) return;
    if (!address || !signer) {
      setTxResult({ type: 'error', text: 'Connect owner wallet to upload market images.' });
      event.target.value = '';
      return;
    }

    let previewToRevokeOnFailure: string | null = null;
    let uploadedKeyToCleanup: string | null = null;
    try {
      keepUploadedImageOnCloseRef.current = false;
      setImageUploading(true);
      setTxResult(null);
      const compressed = await compressMarketImage(selected);
      previewToRevokeOnFailure = compressed.previewUrl;

      const previousKey = imageUploadKey;
      const uploaded = await uploadMarketMedia(compressed.file, address, signer, 'market-image');
      uploadedKeyToCleanup = uploaded.key;

      if (previousKey && previousKey !== uploaded.key) {
        try {
          await deleteMarketMedia(address, previousKey, signer);
        } catch (cleanupErr) {
          console.warn('Failed to cleanup previous market image:', cleanupErr);
        }
      }

      setImageUri(uploaded.url);
      setImageUploadKey(uploaded.key);
      setImageUploadMeta({ bytes: uploaded.byteLength, type: uploaded.contentType });
      setLocalImagePreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return compressed.previewUrl;
      });
      previewToRevokeOnFailure = null;
      uploadedKeyToCleanup = null;
      setTxResult({ type: 'success', text: 'Header image uploaded to R2.' });
    } catch (err) {
      if (uploadedKeyToCleanup) {
        try {
          await deleteMarketMedia(address, uploadedKeyToCleanup, signer);
        } catch (cleanupErr) {
          console.error('Failed to cleanup failed market image upload:', cleanupErr);
        }
      }
      if (previewToRevokeOnFailure) {
        URL.revokeObjectURL(previewToRevokeOnFailure);
      }
      const message = err instanceof Error ? err.message : 'Failed to upload image.';
      setTxResult({ type: 'error', text: message });
    } finally {
      setImageUploading(false);
      event.target.value = '';
    }
  };

  const handleClearImage = async () => {
    const currentKey = imageUploadKey;
    setImageUri('');
    setImageUploadKey('');
    setImageUploadMeta(null);
    setLocalImagePreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });

    if (currentKey && address && signer) {
      try {
        await deleteMarketMedia(address, currentKey, signer);
      } catch (cleanupErr) {
        console.warn('Failed to cleanup removed market image:', cleanupErr);
      }
    }
  };

  const uniformProb = BigInt(Math.floor(1e18 / outcomes.length));
  const previewProbs = outcomes.map(() => uniformProb);
  const previewImageSrc = localImagePreviewUrl || imageUri;

  const isValid =
    title.trim().length > 0 &&
    description.trim().length > 0 &&
    actualCategory.trim().length > 0 &&
    outcomes.length >= 2 &&
    outcomes.every(o => o.trim().length > 0) &&
    durationSeconds >= 3600 &&
    parseFloat(bValue) >= 1000 &&
    !imageUploading;

  // Count completed fields for progress
  const completedSteps = [
    title.trim().length > 0,
    description.trim().length > 0,
    actualCategory.trim().length > 0,
    outcomes.length >= 2 && outcomes.every(o => o.trim().length > 0),
    durationSeconds >= 3600,
    parseFloat(bValue) >= 1000,
  ].filter(Boolean).length;

  const feedCanSave = feedUserEdited && (feedKind === 'crypto-price'
    ? Boolean(feedCoingeckoId.trim() && feedBaseSymbol.trim() && feedQuoteSymbol.trim() && feedVsCurrency.trim())
    : Boolean(feedEventId.trim()));

  const detectFeedFromDraft = async () => {
    if (!title.trim() || !actualCategory.trim()) return;

    feedDetectRequestIdRef.current += 1;
    const requestId = feedDetectRequestIdRef.current;

    setFeedDetecting(true);
    setFeedDetectionError('');
    setFeedDetectionHint('Detecting feed suggestions from your draft...');

    try {
      const suggestions = await fetchLiveFeedSuggestions({
        title: title.trim(),
        category: actualCategory.trim(),
        description: description.trim(),
        outcomeLabels: outcomes.map((o) => o.trim()).filter(Boolean),
      });

      if (requestId !== feedDetectRequestIdRef.current) return;

      const cryptoScore = suggestions.crypto.detected ? suggestions.crypto.confidence : 0;
      const sportsScore = suggestions.sports.detected ? suggestions.sports.confidence : 0;

      setFeedCandidates(suggestions.sports.candidates ?? []);

      if (sportsScore > cryptoScore && suggestions.sports.detected) {
        setFeedKind('sports-score');
        setFeedEventId(suggestions.sports.selectedEventId || '');
        setFeedLeagueName(suggestions.sports.selectedLeagueName || '');
        setFeedHomeTeam(suggestions.sports.homeTeam || '');
        setFeedAwayTeam(suggestions.sports.awayTeam || '');
        setFeedSportsSearchQuery(`${suggestions.sports.homeTeam || ''} vs ${suggestions.sports.awayTeam || ''}`.trim());
        setFeedDetectionHint(suggestions.sports.reason || 'Detected sports feed suggestion.');
        setFeedUserEdited(true);
      } else if (suggestions.crypto.detected) {
        setFeedKind('crypto-price');
        setFeedCoingeckoId(suggestions.crypto.coingeckoId || 'bitcoin');
        setFeedBaseSymbol(suggestions.crypto.baseSymbol || 'BTC');
        setFeedQuoteSymbol(suggestions.crypto.quoteSymbol || 'USD');
        setFeedVsCurrency(suggestions.crypto.vsCurrency || 'usd');
        setFeedCryptoMetric(suggestions.crypto.metric || 'price');
        setFeedDetectionHint(suggestions.crypto.reason || 'Detected crypto feed suggestion.');
        setFeedUserEdited(true);
      } else if (suggestions.sports.detected) {
        setFeedKind('sports-score');
        setFeedEventId(suggestions.sports.selectedEventId || '');
        setFeedLeagueName(suggestions.sports.selectedLeagueName || '');
        setFeedHomeTeam(suggestions.sports.homeTeam || '');
        setFeedAwayTeam(suggestions.sports.awayTeam || '');
        setFeedSportsSearchQuery(`${suggestions.sports.homeTeam || ''} vs ${suggestions.sports.awayTeam || ''}`.trim());
        setFeedDetectionHint(suggestions.sports.reason || 'Detected sports feed suggestion.');
        setFeedUserEdited(true);
      } else {
        setFeedDetectionHint('No strong feed suggestion found. Fill manually or continue without feed.');
      }
    } catch (err) {
      if (requestId !== feedDetectRequestIdRef.current) return;
      const msg = err instanceof Error ? err.message : 'Could not detect feed suggestion.';
      setFeedDetectionError(msg);
      setFeedDetectionHint('');
    } finally {
      if (requestId === feedDetectRequestIdRef.current) {
        setFeedDetecting(false);
      }
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!title.trim() || !actualCategory.trim()) return;
      void detectFeedFromDraft();
    }, 500);
    return () => {
      clearTimeout(timer);
      feedDetectRequestIdRef.current += 1;
    };
  }, [title, actualCategory, description, outcomes]);

  useEffect(() => {
    if (feedKind !== 'sports-score') {
      setFeedSportsSearchLoading(false);
      setFeedSportsSearchError('');
      setFeedEventLookupLoading(false);
      setFeedEventLookupError('');
      setFeedCandidates([]);
      setFeedEventId('');
      setFeedLeagueName('');
      setFeedHomeTeam('');
      setFeedAwayTeam('');
      setFeedForceUpcoming(false);
      return;
    }
    const query = feedSportsSearchQuery.trim();
    if (!query || query.length < 3) {
      setFeedSportsSearchLoading(false);
      setFeedSportsSearchError('');
      setFeedCandidates([]);
      return;
    }

    let cancelled = false;
    setFeedSportsSearchLoading(true);
    setFeedSportsSearchError('');

    searchSportsEvents(query)
      .then((result) => {
        if (cancelled) return;
        setFeedCandidates(result.candidates);
        if (!feedEventId && result.candidates[0]) {
          setFeedEventId(result.candidates[0].eventId);
          setFeedLeagueName(result.candidates[0].leagueName);
          setFeedHomeTeam(result.candidates[0].homeTeam || '');
          setFeedAwayTeam(result.candidates[0].awayTeam || '');
        }
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : 'Failed to search sports events.';
        setFeedSportsSearchError(msg);
      })
      .finally(() => {
        if (!cancelled) setFeedSportsSearchLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [feedSportsSearchQuery, feedKind, feedEventId]);

  const applyFeedSportsCandidate = (candidate: LiveFeedSuggestionsResponse['sports']['candidates'][number]) => {
    setFeedEventId(candidate.eventId);
    setFeedLeagueName(candidate.leagueName);
    setFeedHomeTeam(candidate.homeTeam || '');
    setFeedAwayTeam(candidate.awayTeam || '');
  };

  const resolveFeedSportsEventId = async (rawEventId: string) => {
    const nextEventId = rawEventId.trim();
    if (!nextEventId) return null;

    const existingCandidate = feedCandidates.find((candidate) => candidate.eventId === nextEventId) || null;
    if (existingCandidate) {
      applyFeedSportsCandidate(existingCandidate);
      setFeedEventLookupError('');
      return existingCandidate;
    }

    setFeedEventLookupLoading(true);
    setFeedEventLookupError('');
    try {
      const candidate = await lookupSportsEventById(nextEventId);
      if (!candidate) {
        throw new Error('Sports event not found for this event id.');
      }

      applyFeedSportsCandidate(candidate);
      setFeedCandidates((prev) => [candidate, ...prev.filter((item) => item.eventId !== candidate.eventId)]);
      setFeedEventLookupError('');
      return candidate;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load SportsDB event id.';
      setFeedEventLookupError(message);
      throw err;
    } finally {
      setFeedEventLookupLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!signer || !isValid || imageUploading || feedSaving) return;

    if (!address || !ethers.isAddress(address)) {
      setTxResult({ type: 'error', text: 'Invalid wallet address. Please reconnect your wallet.' });
      return;
    }

    setSubmitting(true);
    setTxResult(null);
    setFeedSaving(false);
    try {
      const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, signer);
      const bWad = ethers.parseEther(bValue);
      const encodedDescription = subcategory.trim().length > 0
        ? `${description.trim()}:::${subcategory.trim()}`
        : description.trim();

      const tx = await factory.createMarket(
        title.trim(),
        encodedDescription,
        actualCategory.trim(),
        imageUri.trim(),
        outcomes.map(o => o.trim()),
        bWad,
        durationSeconds,
      );
      keepUploadedImageOnCloseRef.current = true;

      setTxResult({ type: 'success', text: 'Transaction submitted. Waiting for confirmation...' });
      const receipt = await tx.wait();

      let marketAddr = '';
      let marketId = '';
      for (const log of receipt.logs) {
        try {
          const parsed = factory.interface.parseLog({ topics: [...log.topics], data: log.data });
          if (parsed && parsed.name === 'MarketCreated') {
            marketAddr = parsed.args.market;
            marketId = parsed.args.marketId.toString();
            break;
          }
        } catch { /* skip */ }
      }

      setTxResult({
        type: 'success',
        text: 'Market created successfully!',
        market: marketAddr,
        marketId,
      });

      if (marketAddr && feedEnabled && feedCanSave) {
        setFeedSaving(true);
        try {
          let payload: LiveFeedConfigInput;
          if (feedKind === 'crypto-price') {
            payload = {
              marketAddress: marketAddr,
              enabled: true,
              kind: 'crypto-price',
              crypto: {
                coingeckoId: feedCoingeckoId.trim().toLowerCase(),
                baseSymbol: feedBaseSymbol.trim().toUpperCase(),
                quoteSymbol: feedQuoteSymbol.trim().toUpperCase(),
                vsCurrency: feedVsCurrency.trim().toLowerCase(),
                metric: feedCryptoMetric,
              },
            };
          } else {
            const resolvedCandidate = (!feedLeagueName.trim() || !feedHomeTeam.trim() || !feedAwayTeam.trim())
              ? await resolveFeedSportsEventId(feedEventId.trim()).catch(() => null)
              : null;

            payload = {
              marketAddress: marketAddr,
              enabled: true,
              kind: 'sports-score',
              sports: {
                eventId: feedEventId.trim(),
                leagueName: (resolvedCandidate?.leagueName || feedLeagueName).trim(),
                homeTeam: (resolvedCandidate?.homeTeam || feedHomeTeam).trim() || undefined,
                awayTeam: (resolvedCandidate?.awayTeam || feedAwayTeam).trim() || undefined,
                forceUpcoming: feedForceUpcoming,
              },
            };
          }

          await saveLiveFeedConfig(address || '', payload, signer);
          setTxResult({
            type: 'success',
            text: 'Market created and live feed attached successfully!',
            market: marketAddr,
            marketId,
          });
        } catch (feedErr) {
          const feedMsg = parseContractError(feedErr);
          setTxResult({
            type: 'error',
            text: `Market created, but feed setup failed: ${feedMsg}`,
            market: marketAddr,
            marketId,
          });
        } finally {
          setFeedSaving(false);
          setSubmitting(false);
        }
      } else {
        setSubmitting(false);
      }

      setTitle('');
      setDescription('');
      setSubcategory('');
      setImageUri('');
      setImageUploadKey('');
      setImageUploadMeta(null);
      setLocalImagePreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setOutcomes(['Yes', 'No']);
      setFeedEnabled(true);
      setFeedKind('crypto-price');
      setFeedUserEdited(false);
      setFeedCandidates([]);
      setFeedSportsSearchQuery('');
      setFeedSportsSearchError('');
      setFeedDetectionHint('');
      setFeedDetectionError('');
      setFeedEventLookupError('');
      setFeedEventId('');
      setFeedLeagueName('');
      setFeedHomeTeam('');
      setFeedAwayTeam('');
      setFeedForceUpcoming(false);
    } catch (err) {
      keepUploadedImageOnCloseRef.current = false;
      setTxResult({ type: 'error', text: parseContractError(err) });
      setSubmitting(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto">
      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary-500/10 border border-primary-500/20 flex items-center justify-center">
            <svg className="w-5 h-5 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </div>
          Create New Market
        </h1>
        <p className="text-dark-400 text-sm mt-2 ml-[52px]">Set up a new prediction market for users to trade on.</p>
      </div>

      {/* Progress bar */}
      <div className="mb-8 card p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-dark-400">Form completion</span>
          <span className="text-xs font-semibold text-primary-400">{completedSteps}/6 fields</span>
        </div>
        <div className="h-1.5 bg-dark-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-primary-600 to-primary-400 rounded-full transition-all duration-500 ease-out"
            style={{ width: `${(completedSteps / 6) * 100}%` }}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6 lg:gap-8">
        {/* Form */}
        <div className="xl:col-span-3 space-y-6">
          {/* Title section */}
          <div className="card p-5">
            <SectionHeader
              icon={<svg className="w-4 h-4 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>}
              title="Market Title"
              subtitle="Ask a clear, unambiguous question"
            />
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Will BTC hit $200k by end of 2025?"
              className="input-field text-lg font-medium"
              maxLength={200}
            />
            <div className="flex items-center justify-between mt-2">
              <p className="text-xs text-dark-500">{title.length}/200 characters</p>
              {title.trim().length > 0 && (
                <span className="text-xs text-emerald-400 flex items-center gap-1">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                </span>
              )}
            </div>
          </div>

          {/* Description section */}
          <div className="card p-5">
            <SectionHeader
              icon={<svg className="w-4 h-4 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h12" /></svg>}
              title="Full Description"
              subtitle="Describe resolution criteria and relevant context"
            />
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Describe the market, resolution criteria, and any relevant context..."
              className="input-field min-h-[120px] resize-y"
              rows={5}
              maxLength={2000}
            />
            <p className="text-xs text-dark-500 mt-2">{description.length}/2000 characters</p>

            <div className="mt-4">
              <label className="label">
                Subcategory <span className="text-dark-500 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={subcategory}
                onChange={e => setSubcategory(e.target.value)}
                placeholder="e.g. DeFi, NBA, Elections"
                className="input-field"
                maxLength={80}
              />
              <p className="text-2xs text-dark-500 mt-2">
                If provided, it will be stored separately and shown as a tag.
              </p>
            </div>
          </div>

          {/* Category & Image */}
          <div className="card p-5">
            <SectionHeader
              icon={<svg className="w-4 h-4 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" /></svg>}
              title="Category & Image"
              subtitle="Help users discover your market"
            />

            {/* Category chips */}
            <label className="label">Category *</label>
            <div className="flex flex-wrap gap-2 mb-4">
              {CATEGORIES.map(cat => (
                <button
                  key={cat}
                  onClick={() => setCategory(cat)}
                  className={`chip ${category === cat ? 'chip-active' : ''}`}
                >
                  <span>{CATEGORY_ICONS[cat]}</span>
                  {cat}
                </button>
              ))}
            </div>
            {category === 'Other' && (
              <input
                type="text"
                value={customCategory}
                onChange={e => setCustomCategory(e.target.value)}
                placeholder="Enter custom category..."
                className="input-field mb-4"
              />
            )}

            {/* Image upload */}
            <label className="label">Header Image <span className="text-dark-500 font-normal">(optional)</span></label>
            <input
              ref={imageFileInputRef}
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={handleImageFileChange}
              disabled={imageUploading || submitting || feedSaving}
            />
            <button
              type="button"
              onClick={() => imageFileInputRef.current?.click()}
              disabled={imageUploading || submitting || feedSaving}
              aria-label="Upload market header image"
              className={`w-full text-left rounded-2xl border border-dashed border-white/[0.2] bg-dark-900/60 p-4 transition-colors ${
                imageUploading || submitting || feedSaving
                  ? 'opacity-60 cursor-not-allowed'
                  : 'hover:border-primary-400/40 hover:bg-dark-850/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/40'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary-500/15 border border-primary-400/30 flex items-center justify-center">
                  <svg className="w-5 h-5 text-primary-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white">
                    {imageUploading ? 'Uploading market image...' : 'Upload market header image'}
                  </p>
                  <p className="text-2xs text-dark-500">Stored on R2 · auto-compressed · max 2MB</p>
                </div>
              </div>
            </button>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              {imageUploadMeta && (
                <span className="text-2xs text-dark-500">{Math.max(1, Math.round(imageUploadMeta.bytes / 1024))}KB · {imageUploadMeta.type}</span>
              )}
              {imageUploadKey && (
                <span className="text-2xs text-dark-500">key:{imageUploadKey.slice(-20)}</span>
              )}
            </div>

            <p className="text-2xs text-dark-500 mt-2">
              Tip: upload gives the most reliable rendering. You can still paste a URL below if needed.
            </p>
            <input
              type="text"
              value={imageUri}
              onChange={(e) => {
                const next = e.target.value;
                if (next !== imageUri && imageUploadKey && address && signer) {
                  deleteMarketMedia(address, imageUploadKey, signer).catch(() => {});
                  setImageUploadKey('');
                  setImageUploadMeta(null);
                }
                setImageUri(next);
                if (next !== imageUri) {
                  setLocalImagePreviewUrl((prev) => {
                    if (prev) URL.revokeObjectURL(prev);
                    return null;
                  });
                }
              }}
              placeholder="Optional fallback: https://..."
              className="input-field mt-2"
            />

            {imageUri && (
              <div className="mt-3 rounded-xl overflow-hidden border border-white/[0.08] bg-dark-900/40">
                <div className="px-3 py-2 border-b border-white/[0.08] flex items-center justify-between gap-2">
                  <span className="text-2xs text-emerald-400 font-medium">R2 image ready</span>
                  <button
                    type="button"
                    onClick={handleClearImage}
                    disabled={imageUploading || submitting || feedSaving}
                    className="text-2xs text-red-300 hover:text-red-200"
                  >
                    Remove image
                  </button>
                </div>
                <ImageWithFallback src={previewImageSrc} alt="Preview" className="h-48 w-full" />
                <div className="px-3 py-2 text-2xs text-dark-500 border-t border-white/[0.08]">
                  {imageUri}
                </div>
              </div>
            )}
          </div>

          {/* Outcomes */}
          <div className="card p-5">
            <SectionHeader
              icon={<svg className="w-4 h-4 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>}
              title="Outcome Labels"
              subtitle="Define the possible outcomes (minimum 2)"
            />
            <div className="space-y-2">
              {outcomes.map((outcome, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <div className="w-6 h-6 rounded-full bg-dark-750 border border-white/[0.08] flex items-center justify-center flex-shrink-0">
                    <span className="text-2xs font-bold text-dark-400">{i + 1}</span>
                  </div>
                  <input
                    type="text"
                    value={outcome}
                    onChange={e => updateOutcome(i, e.target.value)}
                    placeholder={`Outcome ${i + 1}`}
                    className="input-field"
                  />
                  {outcomes.length > 2 && (
                    <button
                      onClick={() => removeOutcome(i)}
                      className="w-10 h-10 rounded-xl bg-dark-800/80 hover:bg-red-500/15 text-dark-400 hover:text-red-400 transition-all border border-white/[0.08] hover:border-red-500/20 flex items-center justify-center flex-shrink-0"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button onClick={addOutcome} className="mt-3 chip hover:border-primary-500/30 hover:text-primary-400">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Outcome
            </button>
          </div>

          {/* Duration */}
          <div className="card p-5">
            <SectionHeader
              icon={<svg className="w-4 h-4 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
              title="Market Duration"
              subtitle="How long should trading be open?"
            />
            
            <div className="flex items-center gap-2 mb-3">
              <button
                type="button"
                onClick={() => setUseCalendar(false)}
                className={`chip ${!useCalendar ? 'chip-active' : ''}`}
              >
                Duration
              </button>
              <button
                type="button"
                onClick={() => {
                  setUseCalendar(true);
                  if (!deadlinePicker.value) {
                    const defaultDate = new Date();
                    defaultDate.setDate(defaultDate.getDate() + 7);
                    deadlinePicker.setUtcValue(defaultDate.toISOString());
                  }
                }}
                className={`chip ${useCalendar ? 'chip-active' : ''}`}
              >
                Calendar
              </button>
            </div>

            {!useCalendar ? (
              <>
                <div className="flex flex-wrap gap-2 mb-3">
                  {DURATION_PRESETS.map(d => (
                    <button
                      key={d.label}
                      type="button"
                      onClick={() => setDurationPreset(d.seconds)}
                      className={`chip ${durationPreset === d.seconds ? 'chip-active' : ''}`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
                {durationPreset === 0 && (
                  <div className="flex gap-3 mt-2">
                    <div className="flex-1">
                      <label className="text-xs text-dark-400 mb-1 block">Days</label>
                      <input
                        type="number"
                        value={customDays}
                        onChange={e => setCustomDays(e.target.value)}
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
                        onChange={e => setCustomHours(e.target.value)}
                        min="0"
                        max="23"
                        placeholder="0"
                        className="input-field"
                      />
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="mt-2">
                <label className="text-xs text-dark-400 mb-1.5 block">Select deadline date and time (your local time)</label>
                <input
                  type="datetime-local"
                  value={deadlinePicker.value}
                  onChange={deadlinePicker.onChange}
                  min={(() => {
                    const now = new Date();
                    const year = now.getFullYear();
                    const month = String(now.getMonth() + 1).padStart(2, '0');
                    const day = String(now.getDate()).padStart(2, '0');
                    const hours = String(now.getHours()).padStart(2, '0');
                    const minutes = String(now.getMinutes()).padStart(2, '0');
                    return `${year}-${month}-${day}T${hours}:${minutes}`;
                  })()}
                  className="input-field"
                />
              </div>
            )}
            {durationSeconds >= 3600 && (
              <div className="mt-3 p-3 rounded-xl bg-dark-900/40 border border-white/[0.06] flex items-center gap-2">
                <svg className="w-4 h-4 text-dark-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <p className="text-xs text-dark-400">
                  Expires <span className="text-white font-medium">{expiryDate.toLocaleString()}</span>
                </p>
              </div>
            )}
          </div>

          {/* Liquidity parameter */}
          <div className="card p-5">
            <SectionHeader
              icon={<svg className="w-4 h-4 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>}
              title="Liquidity Depth (b)"
              subtitle="Controls price sensitivity and market stability"
            />
            <div className="flex items-center gap-3">
              <input
                type="number"
                value={bValue}
                onChange={e => setBValue(e.target.value)}
                min="1000"
                step="100"
                className="input-field flex-1"
                placeholder="1000"
              />
              <div className="relative">
                <button
                  onMouseEnter={() => setShowBTooltip(true)}
                  onMouseLeave={() => setShowBTooltip(false)}
                  onClick={() => setShowBTooltip(!showBTooltip)}
                  className="w-8 h-8 rounded-full bg-dark-750 border border-white/[0.08] text-dark-400 text-xs flex items-center justify-center hover:text-white hover:border-white/[0.15] transition-colors"
                >
                  ?
                </button>
                {showBTooltip && (
                  <div className="absolute bottom-full right-0 mb-2 w-72 p-4 rounded-xl bg-dark-800 border border-white/[0.08] text-xs text-dark-200 shadow-elevated z-10 animate-fade-in">
                    <p className="font-semibold text-white mb-2">LMSR Liquidity Parameter</p>
                    <p className="text-dark-300 leading-relaxed">Higher values = more stable prices, smaller multipliers. Lower values = more volatile prices, bigger potential returns.</p>
                    <div className="divider my-3" />
                    <p className="text-dark-400">Rule of thumb: expected total volume / 10. Minimum: 1000, Maximum: 1,000,000.</p>
                  </div>
                )}
              </div>
            </div>
            {/* Quick preset buttons */}
            <div className="flex gap-2 mt-3">
              {[1000, 2500, 5000, 10000, 50000].map(v => (
                <button
                  key={v}
                  onClick={() => setBValue(v.toString())}
                  className={`chip text-2xs ${bValue === v.toString() ? 'chip-active' : ''}`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          {/* Live feed setup */}
          <div className="card p-5">
            <SectionHeader
              icon={<svg className="w-4 h-4 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m-9 6h12" /></svg>}
              title="Live Feed (Optional, Recommended)"
              subtitle="Attach price/score feed immediately after market creation"
            />

            <label className="flex items-center gap-2 text-sm text-dark-300 mb-3">
              <input
                type="checkbox"
                checked={feedEnabled}
                onChange={(e) => setFeedEnabled(e.target.checked)}
                className="rounded border-white/[0.15] bg-dark-900"
              />
              Auto-attach live feed right after create
            </label>

            <div className="flex gap-2 mb-3">
              <button
                type="button"
                onClick={() => setFeedKind('crypto-price')}
                className={`chip ${feedKind === 'crypto-price' ? 'chip-active' : ''}`}
              >
                Crypto Price
              </button>
              <button
                type="button"
                onClick={() => setFeedKind('sports-score')}
                className={`chip ${feedKind === 'sports-score' ? 'chip-active' : ''}`}
              >
                Sports Score
              </button>
              <button
                type="button"
                onClick={() => void detectFeedFromDraft()}
                className="btn-secondary text-xs"
                disabled={feedDetecting}
              >
                {feedDetecting ? 'Detecting...' : 'Detect From Draft'}
              </button>
            </div>

            {feedDetectionHint && (
              <p className="text-xs text-emerald-400 mb-2">{feedDetectionHint}</p>
            )}
            {feedDetectionError && (
              <p className="text-xs text-amber-400 mb-2">{feedDetectionError}</p>
            )}

            {feedKind === 'crypto-price' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <select
                  value={feedCryptoMetric}
                  onChange={(e) => { setFeedCryptoMetric(e.target.value as 'price' | 'market-cap' | 'volume-24h'); setFeedUserEdited(true); }}
                  className="input-field"
                >
                  <option value="price">Metric: Price</option>
                  <option value="market-cap">Metric: Market Cap</option>
                  <option value="volume-24h">Metric: 24h Volume</option>
                </select>
                <input
                  type="text"
                  value={feedCoingeckoId}
                  onChange={(e) => { setFeedCoingeckoId(e.target.value); setFeedUserEdited(true); }}
                  placeholder="CoinGecko id (bitcoin)"
                  className="input-field"
                />
                <input
                  type="text"
                  value={feedBaseSymbol}
                  onChange={(e) => { setFeedBaseSymbol(e.target.value); setFeedUserEdited(true); }}
                  placeholder="Base symbol (BTC)"
                  className="input-field"
                />
                <input
                  type="text"
                  value={feedQuoteSymbol}
                  onChange={(e) => { setFeedQuoteSymbol(e.target.value); setFeedUserEdited(true); }}
                  placeholder="Quote symbol (USD)"
                  className="input-field"
                />
                <input
                  type="text"
                  value={feedVsCurrency}
                  onChange={(e) => { setFeedVsCurrency(e.target.value); setFeedUserEdited(true); }}
                  placeholder="Quote key (usd)"
                  className="input-field"
                />
                <p className="text-xs text-dark-500 sm:col-span-2">
                  For cap/volume markets, choose metric above and keep pair as base/quote for display.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <input
                  type="text"
                  value={feedSportsSearchQuery}
                  onChange={(e) => {
                    setFeedSportsSearchQuery(e.target.value);
                    // Clear selected event when search query is edited
                    setFeedEventId('');
                    setFeedLeagueName('');
                    setFeedHomeTeam('');
                    setFeedAwayTeam('');
                  }}
                  placeholder="Search matches, e.g. Brazil vs France"
                  className="input-field"
                />
                {feedSportsSearchLoading && (
                  <p className="text-xs text-dark-500">Searching matches...</p>
                )}
                {feedSportsSearchError && (
                  <p className="text-xs text-amber-400">{feedSportsSearchError}</p>
                )}
                {feedCandidates.length === 0 && !feedSportsSearchLoading && feedSportsSearchQuery.trim().length >= 3 && (
                  <p className="text-xs text-dark-500">No matches found yet. Try only teams like "Brazil vs France".</p>
                )}
                {feedCandidates.length > 0 && (
                  <select
                    value={feedEventId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setFeedEventId(id);
                      const found = feedCandidates.find((c) => c.eventId === id);
                      if (found) {
                        setFeedLeagueName(found.leagueName);
                        setFeedHomeTeam(found.homeTeam || '');
                        setFeedAwayTeam(found.awayTeam || '');
                      }
                      setFeedUserEdited(true);
                    }}
                    className="input-field"
                  >
                    <option value="">Select detected event</option>
                    {feedCandidates.map((c) => (
                      <option key={c.eventId} value={c.eventId}>
                        {c.homeTeam} vs {c.awayTeam} · {c.leagueName} · {c.kickoffAt ? new Date(c.kickoffAt).toLocaleString() : 'Date N/A'} · {c.statusLabel}
                      </option>
                    ))}
                  </select>
                )}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={feedEventId}
                    onChange={(e) => {
                      setFeedEventId(e.target.value);
                      setFeedEventLookupError('');
                      setFeedUserEdited(true);
                    }}
                    onBlur={() => {
                      if (feedEventId.trim()) {
                        void resolveFeedSportsEventId(feedEventId.trim()).catch(() => {});
                      }
                    }}
                    placeholder="TheSportsDB event id"
                    className="input-field"
                  />
                  <button
                    type="button"
                    onClick={() => void resolveFeedSportsEventId(feedEventId.trim()).catch(() => {})}
                    disabled={!feedEventId.trim() || feedEventLookupLoading}
                    className="btn-secondary shrink-0 text-xs"
                  >
                    {feedEventLookupLoading ? 'Loading...' : 'Load ID'}
                  </button>
                </div>
                {feedEventLookupError && (
                  <p className="text-xs text-amber-400">{feedEventLookupError}</p>
                )}
                <input
                  type="text"
                  value={feedLeagueName}
                  onChange={(e) => { setFeedLeagueName(e.target.value); setFeedUserEdited(true); }}
                  placeholder="League name"
                  className="input-field"
                />
                <p className="text-xs text-dark-500">Paste only the SportsDB event id to auto-fill league and teams, or keep using search from the title above.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input
                    type="text"
                    value={feedHomeTeam}
                    onChange={(e) => { setFeedHomeTeam(e.target.value); setFeedUserEdited(true); }}
                    placeholder="Home team (validation)"
                    className="input-field"
                  />
                  <input
                    type="text"
                    value={feedAwayTeam}
                    onChange={(e) => { setFeedAwayTeam(e.target.value); setFeedUserEdited(true); }}
                    placeholder="Away team (validation)"
                    className="input-field"
                  />
                </div>
                <label className="flex items-center gap-2 text-sm text-dark-300">
                  <input
                    type="checkbox"
                    checked={feedForceUpcoming}
                    onChange={(e) => { setFeedForceUpcoming(e.target.checked); setFeedUserEdited(true); }}
                    className="rounded border-white/[0.15] bg-dark-900"
                  />
                  Force Upcoming until you disable it
                </label>
              </div>
            )}
          </div>

          {/* Submit */}
          <div className="card p-5">
            <button
              onClick={handleSubmit}
              disabled={!isValid || submitting || imageUploading || feedSaving}
              className="btn-primary w-full py-3.5 text-base font-semibold"
            >
              {submitting ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Creating Market...
                </span>
              ) : imageUploading ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Waiting for image upload...
                </span>
              ) : feedSaving ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Saving Live Feed...
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Create Market
                </span>
              )}
            </button>
            {!isValid && (
              <p className="text-xs text-dark-500 text-center mt-2">Complete all required fields and finish image upload to enable submission</p>
            )}
          </div>

          {/* Result */}
          {txResult && (
            <div className={`card p-5 animate-fade-in-up ${
              txResult.type === 'success'
                ? 'border-emerald-500/20'
                : 'border-red-500/20'
            }`}>
              <div className="flex items-start gap-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                  txResult.type === 'success' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
                }`}>
                  {txResult.type === 'success' ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  )}
                </div>
                <div>
                  <p className={`text-sm font-medium ${txResult.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>
                    {txResult.text}
                  </p>
                  {txResult.marketId && (
                    <a
                      href={`/market/${makeMarketSlug(Number(txResult.marketId), title)}`}
                      className="mt-2 inline-flex items-center gap-1 text-sm text-primary-400 hover:text-primary-300 font-medium"
                    >
                      View Market
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                    </a>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Live Preview */}
        <div className="xl:col-span-2">
          <div className="sticky top-20">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse-soft" />
              <h3 className="text-xs font-semibold text-dark-400 uppercase tracking-wider">Live Preview</h3>
            </div>

            <div className="card overflow-hidden">
              <div className="relative">
                <ImageWithFallback
                  src={previewImageSrc}
                  alt={title || 'Market Preview'}
                  className="h-36 w-full"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-dark-900/80 via-transparent to-transparent" />
              </div>
              <div className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="badge bg-emerald-500/15 text-emerald-400 border-emerald-500/25">Active</span>
                  {actualCategory && (
                    <span className="badge bg-dark-750/80 text-dark-300 border-white/[0.08]">{actualCategory}</span>
                  )}
                </div>
                <h4 className="font-semibold text-white text-sm leading-tight">
                  {title || <span className="text-dark-500 italic">Market title will appear here</span>}
                </h4>
                {outcomes.filter(o => o.trim()).length >= 2 && (
                  <ProbabilityBar
                    labels={outcomes.filter(o => o.trim())}
                    probabilities={previewProbs.slice(0, outcomes.filter(o => o.trim()).length)}
                    compact
                  />
                )}
                <div className="flex items-center justify-between pt-3 border-t border-white/[0.08] text-xs text-dark-400">
                  <span className="flex items-center gap-1">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    0 USDC volume
                  </span>
                  {durationSeconds >= 3600 && (
                    <span className="flex items-center gap-1">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      {Math.floor(durationSeconds / 86400)}d {Math.floor((durationSeconds % 86400) / 3600)}h
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Form summary */}
            <div className="card p-4 mt-4">
              <h4 className="text-xs font-semibold text-dark-400 uppercase tracking-wider mb-3">Summary</h4>
              <div className="space-y-2.5 text-xs">
                {[
                  { label: 'Outcomes', value: outcomes.filter(o => o.trim()).length.toString(), ok: outcomes.length >= 2 && outcomes.every(o => o.trim().length > 0) },
                  { label: 'Duration', value: durationSeconds >= 86400 ? `${Math.floor(durationSeconds / 86400)} days` : `${Math.floor(durationSeconds / 3600)} hours`, ok: durationSeconds >= 3600 },
                  { label: 'Liquidity (b)', value: bValue, ok: parseFloat(bValue) >= 1000 },
                  { label: 'Expiry', value: durationSeconds >= 3600 ? expiryDate.toLocaleDateString() : '-', ok: durationSeconds >= 3600 },
                ].map(row => (
                  <div key={row.label} className="flex items-center justify-between">
                    <span className="text-dark-400 flex items-center gap-1.5">
                      {row.ok ? (
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      ) : (
                        <span className="w-1.5 h-1.5 rounded-full bg-dark-600" />
                      )}
                      {row.label}
                    </span>
                    <span className="text-white font-medium tabular-nums">{row.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
