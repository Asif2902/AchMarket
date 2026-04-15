import { useState, useEffect, useMemo } from 'react';
import { STAGE_LABELS, STAGE_COLORS } from '../../config/network';
import { useWallet } from '../../context/WalletContext';
import { PageLoader } from '../../components/LoadingSpinner';
import EmptyState from '../../components/EmptyState';
import { useOwnerMarkets } from './OwnerMarketUtils';
import {
  fetchLiveFeedConfigs,
  fetchLiveFeedSuggestions,
  saveLiveFeedConfig,
} from '../../services/live';
import type {
  LiveFeedConfig,
  LiveFeedConfigInput,
  LiveFeedSuggestionsResponse,
} from '../../types/live';
import { parseContractError } from '../../utils/format';

interface LiveFeedModalProps {
  isOpen: boolean;
  market: {
    address: string;
    title: string;
    category: string;
    description: string;
    outcomeLabels: string[];
  } | null;
  existing: LiveFeedConfig | null;
  onClose: () => void;
  onSaved: () => void;
}

function LiveFeedModal({ isOpen, market, existing, onClose, onSaved }: LiveFeedModalProps) {
  const { signer, address } = useWallet();
  const [kind, setKind] = useState<'crypto-price' | 'sports-score'>('crypto-price');
  const [enabled, setEnabled] = useState(true);
  const [coingeckoId, setCoingeckoId] = useState('bitcoin');
  const [baseSymbol, setBaseSymbol] = useState('BTC');
  const [quoteSymbol, setQuoteSymbol] = useState('USD');
  const [vsCurrency, setVsCurrency] = useState('usd');
  const [eventId, setEventId] = useState('');
  const [leagueName, setLeagueName] = useState('');
  const [suggestions, setSuggestions] = useState<LiveFeedSuggestionsResponse | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !market) return;
    if (existing) {
      setKind(existing.kind);
      setEnabled(existing.enabled);
      if (existing.kind === 'crypto-price' && existing.crypto) {
        setCoingeckoId(existing.crypto.coingeckoId || 'bitcoin');
        setBaseSymbol(existing.crypto.baseSymbol || 'BTC');
        setQuoteSymbol(existing.crypto.quoteSymbol || 'USD');
        setVsCurrency(existing.crypto.vsCurrency || 'usd');
      }
      if (existing.kind === 'sports-score' && existing.sports) {
        setEventId(existing.sports.eventId || '');
        setLeagueName(existing.sports.leagueName || '');
      }
      setError(null);
      return;
    }

    setKind('crypto-price');
    setEnabled(true);
    setCoingeckoId('bitcoin');
    setBaseSymbol('BTC');
    setQuoteSymbol('USD');
    setVsCurrency('usd');
    setEventId('');
    setLeagueName('');
    setError(null);
  }, [isOpen, market, existing]);

  const applyCryptoSuggestion = (suggestion: LiveFeedSuggestionsResponse['crypto']) => {
    if (!suggestion.detected || !suggestion.coingeckoId || !suggestion.baseSymbol) return;
    setKind('crypto-price');
    setCoingeckoId(suggestion.coingeckoId);
    setBaseSymbol(suggestion.baseSymbol);
    setQuoteSymbol(suggestion.quoteSymbol || 'USD');
    setVsCurrency(suggestion.vsCurrency || 'usd');
  };

  const applySportsSuggestion = (suggestion: LiveFeedSuggestionsResponse['sports']) => {
    if (!suggestion.detected) return;
    setKind('sports-score');
    setEventId(suggestion.selectedEventId || '');
    setLeagueName(suggestion.selectedLeagueName || '');
  };

  useEffect(() => {
    if (!isOpen || !market) return;

    let cancelled = false;
    setSuggesting(true);
    setSuggestions(null);
    setSuggestionsError(null);

    fetchLiveFeedSuggestions({
      title: market.title,
      category: market.category,
      description: market.description,
      outcomeLabels: market.outcomeLabels,
    })
      .then((result) => {
        if (cancelled) return;
        setSuggestions(result);

        if (existing) return;

        const cryptoScore = result.crypto.detected ? result.crypto.confidence : 0;
        const sportsScore = result.sports.detected ? result.sports.confidence : 0;

        if (sportsScore > cryptoScore && result.sports.detected) {
          applySportsSuggestion(result.sports);
        } else if (result.crypto.detected) {
          applyCryptoSuggestion(result.crypto);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Could not auto-detect feed suggestions.';
        setSuggestionsError(message);
      })
      .finally(() => {
        if (!cancelled) setSuggesting(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, market, existing]);

  const canSave = useMemo(() => {
    if (!signer || !address || !market) return false;
    if (kind === 'crypto-price') {
      return Boolean(coingeckoId.trim() && baseSymbol.trim() && quoteSymbol.trim() && vsCurrency.trim());
    }
    return Boolean(eventId.trim() && leagueName.trim());
  }, [signer, address, market, kind, coingeckoId, baseSymbol, quoteSymbol, vsCurrency, eventId, leagueName]);

  const handleSave = async () => {
    if (!signer || !address || !market || !canSave) return;
    setSaving(true);
    setError(null);

    let payload: LiveFeedConfigInput;
    if (kind === 'crypto-price') {
      payload = {
        marketAddress: market.address,
        enabled,
        kind: 'crypto-price',
        crypto: {
          coingeckoId: coingeckoId.trim().toLowerCase(),
          baseSymbol: baseSymbol.trim().toUpperCase(),
          quoteSymbol: quoteSymbol.trim().toUpperCase(),
          vsCurrency: vsCurrency.trim().toLowerCase(),
        },
      };
    } else {
      payload = {
        marketAddress: market.address,
        enabled,
        kind: 'sports-score',
        sports: {
          eventId: eventId.trim(),
          leagueName: leagueName.trim(),
        },
      };
    }

    try {
      await saveLiveFeedConfig(address, payload, signer);
      onSaved();
      onClose();
    } catch (err) {
      setError(parseContractError(err));
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen || !market) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-dark-950/80 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div className="relative card w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 animate-slide-up">
        <button onClick={onClose} className="absolute top-4 right-4 w-8 h-8 rounded-lg bg-dark-750 border border-white/[0.08] flex items-center justify-center text-dark-400 hover:text-white hover:border-white/[0.15] transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="mb-5">
          <h2 className="text-xl font-bold text-white">Live Feed Settings</h2>
          <p className="text-xs text-dark-400 mt-1">{market.title}</p>
        </div>

        <div className="space-y-4">
          <label className="label">Feed Type</label>

          <label className="flex items-center gap-2 text-sm text-dark-300">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="rounded border-white/[0.15] bg-dark-900"
            />
            Enable live feed for this market
          </label>

          <div className="flex rounded-xl bg-dark-900/60 p-0.5 border border-white/[0.06]">
            <button
              type="button"
              onClick={() => setKind('crypto-price')}
              className={`flex-1 py-2 rounded-[10px] text-sm font-semibold transition-all ${
                kind === 'crypto-price' ? 'bg-primary-500/15 text-primary-300' : 'text-dark-500 hover:text-dark-300'
              }`}
            >
              Crypto Price
            </button>
            <button
              type="button"
              onClick={() => setKind('sports-score')}
              className={`flex-1 py-2 rounded-[10px] text-sm font-semibold transition-all ${
                kind === 'sports-score' ? 'bg-primary-500/15 text-primary-300' : 'text-dark-500 hover:text-dark-300'
              }`}
            >
              Sports Score
            </button>
          </div>

          <div className="rounded-xl border border-white/[0.08] bg-dark-900/40 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-white/90">Auto-detect from market text</p>
              {suggesting && <span className="text-2xs text-dark-500">Detecting...</span>}
            </div>

            {!suggesting && suggestions && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-2xs">
                  <span className="text-dark-500">Crypto:</span>
                  <span className={`badge ${suggestions.crypto.detected ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25' : 'bg-dark-750/80 text-dark-400 border-white/[0.08]'}`}>
                    {suggestions.crypto.detected
                      ? `${suggestions.crypto.baseSymbol ?? ''}/${suggestions.crypto.quoteSymbol}`
                      : 'Not detected'}
                  </span>
                  {suggestions.crypto.detected && (
                    <button
                      type="button"
                      onClick={() => applyCryptoSuggestion(suggestions.crypto)}
                      className="btn-secondary text-2xs"
                    >
                      Use Crypto Suggestion
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 text-2xs">
                  <span className="text-dark-500">Sports:</span>
                  <span className={`badge ${suggestions.sports.detected ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25' : 'bg-dark-750/80 text-dark-400 border-white/[0.08]'}`}>
                    {suggestions.sports.detected
                      ? `${suggestions.sports.homeTeam ?? ''} vs ${suggestions.sports.awayTeam ?? ''}`
                      : 'Not detected'}
                  </span>
                  {suggestions.sports.detected && (
                    <button
                      type="button"
                      onClick={() => applySportsSuggestion(suggestions.sports)}
                      className="btn-secondary text-2xs"
                    >
                      Use Sports Suggestion
                    </button>
                  )}
                </div>

                <p className="text-2xs text-dark-500">
                  {kind === 'crypto-price'
                    ? suggestions.crypto.reason
                    : suggestions.sports.reason}
                </p>
              </div>
            )}

            {!suggesting && suggestionsError && (
              <p className="text-2xs text-amber-400">{suggestionsError}</p>
            )}
          </div>

          {kind === 'crypto-price' ? (
            <>
              <div>
                <label className="label">CoinGecko Asset ID</label>
                <input
                  type="text"
                  value={coingeckoId}
                  onChange={(e) => setCoingeckoId(e.target.value)}
                  placeholder="bitcoin"
                  className="input-field"
                />
                <p className="text-2xs text-dark-500 mt-1">Example: `bitcoin`, `ethereum`, `solana`</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Base Symbol</label>
                  <input
                    type="text"
                    value={baseSymbol}
                    onChange={(e) => setBaseSymbol(e.target.value)}
                    placeholder="BTC"
                    className="input-field"
                  />
                </div>
                <div>
                  <label className="label">Quote Symbol</label>
                  <input
                    type="text"
                    value={quoteSymbol}
                    onChange={(e) => setQuoteSymbol(e.target.value)}
                    placeholder="USD"
                    className="input-field"
                  />
                </div>
              </div>
              <div>
                <label className="label">Quote Currency Key</label>
                <input
                  type="text"
                  value={vsCurrency}
                  onChange={(e) => setVsCurrency(e.target.value)}
                  placeholder="usd"
                  className="input-field"
                />
              </div>
            </>
          ) : (
            <>
              {suggestions?.sports.candidates && suggestions.sports.candidates.length > 0 && (
                <div>
                  <label className="label">Detected Events</label>
                  <select
                    value={eventId}
                    onChange={(e) => {
                      const nextId = e.target.value;
                      setEventId(nextId);
                      const chosen = suggestions.sports.candidates.find((item) => item.eventId === nextId);
                      if (chosen) {
                        setLeagueName(chosen.leagueName);
                      }
                    }}
                    className="input-field"
                  >
                    <option value="">Select detected event</option>
                    {suggestions.sports.candidates.map((candidate) => (
                      <option key={candidate.eventId} value={candidate.eventId}>
                        {candidate.homeTeam} vs {candidate.awayTeam} · {candidate.leagueName} · {candidate.statusLabel}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="label">TheSportsDB Event ID</label>
                <input
                  type="text"
                  value={eventId}
                  onChange={(e) => setEventId(e.target.value)}
                  placeholder="1032862"
                  className="input-field"
                />
                <p className="text-2xs text-dark-500 mt-1">Use the event id from TheSportsDB to track current score.</p>
              </div>
              <div>
                <label className="label">League Name</label>
                <input
                  type="text"
                  value={leagueName}
                  onChange={(e) => setLeagueName(e.target.value)}
                  placeholder="English Premier League"
                  className="input-field"
                />
              </div>
            </>
          )}

          {error && (
            <div className="p-3 rounded-xl bg-red-500/10 text-red-400 border border-red-500/20 text-sm">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button
              onClick={handleSave}
              disabled={!canSave || saving}
              className="btn-primary flex-1 font-semibold"
            >
              {saving ? 'Saving...' : 'Save Feed'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LiveFeeds() {
  const { markets, loading } = useOwnerMarkets();
  const [configs, setConfigs] = useState<Record<string, LiveFeedConfig>>({});
  const [configLoading, setConfigLoading] = useState(false);
  const [selectedMarket, setSelectedMarket] = useState<{
    address: string;
    title: string;
    category: string;
    description: string;
    outcomeLabels: string[];
  } | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const sortedMarkets = useMemo(() => {
    return [...markets].sort((a, b) => b.marketId - a.marketId);
  }, [markets]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!sortedMarkets.length) {
        setConfigs({});
        return;
      }
      setConfigLoading(true);
      try {
        const fetched = await fetchLiveFeedConfigs(sortedMarkets.map((m) => m.market));
        if (cancelled) return;
        const next: Record<string, LiveFeedConfig> = {};
        for (const item of fetched) {
          next[item.marketAddress.toLowerCase()] = item;
        }
        setConfigs(next);
      } catch (err) {
        console.error('Failed to fetch live feed configs:', err);
      } finally {
        if (!cancelled) setConfigLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [sortedMarkets, refreshTick]);

  const selectedConfig = selectedMarket
    ? (configs[selectedMarket.address.toLowerCase()] ?? null)
    : null;

  if (loading) return <PageLoader />;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary-500/10 border border-primary-500/20 flex items-center justify-center">
            <svg className="w-5 h-5 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m-9 6h12" />
            </svg>
          </div>
          Live Feeds
        </h1>
        <span className="badge bg-dark-750/80 text-dark-300 border-white/[0.08]">
          {Object.values(configs).filter((c) => c.enabled).length} enabled
        </span>
      </div>

      <div className="card p-4 border-primary-500/20 bg-primary-500/5">
        <p className="text-sm text-dark-300 leading-relaxed">
          Configure live reference data for <span className="text-white font-semibold">existing markets and future markets</span>.
          These settings are keyed by market address, so you can add feeds retroactively without redeploying contracts.
        </p>
      </div>

      {sortedMarkets.length === 0 ? (
        <EmptyState title="No markets yet" description="Create a market first, then attach a live feed." />
      ) : (
        <div className="space-y-3">
          {sortedMarkets.map((market) => {
            const config = configs[market.market.toLowerCase()] || null;
            const isConfigured = Boolean(config);
            const isEnabled = Boolean(config?.enabled);
            return (
              <div key={market.market} className="card p-4 sm:p-5">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <span className={`badge ${STAGE_COLORS[market.stage]}`}>{STAGE_LABELS[market.stage]}</span>
                      <span className="badge bg-dark-750/80 text-dark-300 border-white/[0.08]">ID #{market.marketId}</span>
                      {isConfigured ? (
                        <span className={`badge ${isEnabled ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25' : 'bg-amber-500/15 text-amber-400 border-amber-500/25'}`}>
                          {isEnabled ? 'Feed Enabled' : 'Feed Disabled'}
                        </span>
                      ) : (
                        <span className="badge bg-dark-750/80 text-dark-400 border-white/[0.08]">No Feed</span>
                      )}
                      {config?.kind && (
                        <span className="badge bg-primary-500/15 text-primary-300 border-primary-500/25">
                          {config.kind === 'crypto-price' ? 'Crypto Price' : 'Sports Score'}
                        </span>
                      )}
                    </div>

                    <h3 className="text-sm sm:text-base font-semibold text-white leading-tight">{market.title}</h3>
                    <p className="text-2xs text-dark-500 mt-1 break-all">{market.market}</p>

                    {config?.kind === 'crypto-price' && config.crypto && (
                      <p className="text-xs text-dark-400 mt-2">
                        Source: CoinGecko `{config.crypto.coingeckoId}` ({config.crypto.baseSymbol}/{config.crypto.quoteSymbol})
                      </p>
                    )}
                    {config?.kind === 'sports-score' && config.sports && (
                      <p className="text-xs text-dark-400 mt-2">
                        Source: TheSportsDB event `{config.sports.eventId}` ({config.sports.leagueName})
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => setSelectedMarket({
                        address: market.market,
                        title: market.title,
                        category: market.category,
                        description: market.description,
                        outcomeLabels: market.outcomeLabels,
                      })}
                      className="btn-secondary text-xs"
                    >
                      {isConfigured ? 'Edit Feed' : 'Add Feed'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {configLoading && (
        <p className="text-xs text-dark-500">Refreshing live feed settings...</p>
      )}

      <LiveFeedModal
        isOpen={Boolean(selectedMarket)}
        market={selectedMarket}
        existing={selectedConfig}
        onClose={() => setSelectedMarket(null)}
        onSaved={() => setRefreshTick((x) => x + 1)}
      />
    </div>
  );
}
