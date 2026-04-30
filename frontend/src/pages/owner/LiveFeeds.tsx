import { useState, useEffect, useMemo, useRef } from 'react';
import { STAGE, STAGE_LABELS, STAGE_COLORS } from '../../config/network';
import { useWallet } from '../../context/WalletContext';
import { PageLoader } from '../../components/LoadingSpinner';
import EmptyState from '../../components/EmptyState';
import { useOwnerMarkets } from './OwnerMarketUtils';
import {
  fetchLiveFeedConfigs,
  fetchLiveFeedSuggestions,
  lookupSportsEventById,
  searchSportsEvents,
  saveLiveFeedConfig,
} from '../../services/live';
import type {
  LiveFeedConfig,
  LiveFeedConfigInput,
  LiveFeedSuggestionsResponse,
} from '../../types/live';
import { parseContractError } from '../../utils/format';

type StageFilter = 'all' | 'active' | 'resolved' | 'cancelled';

function matchesStageFilter(stage: number, filter: StageFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'active') {
    return stage === STAGE.Active || stage === STAGE.Suspended;
  }
  if (filter === 'resolved') {
    return stage === STAGE.Resolved;
  }
  if (filter === 'cancelled') {
    return stage === STAGE.Cancelled || stage === STAGE.Expired;
  }
  return true;
}

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
  const [cryptoMetric, setCryptoMetric] = useState<'price' | 'market-cap' | 'volume-24h'>('price');
  const [enabled, setEnabled] = useState(true);
  const [coingeckoId, setCoingeckoId] = useState('bitcoin');
  const [baseSymbol, setBaseSymbol] = useState('BTC');
  const [quoteSymbol, setQuoteSymbol] = useState('USD');
  const [vsCurrency, setVsCurrency] = useState('usd');
  const [eventId, setEventId] = useState('');
  const [leagueName, setLeagueName] = useState('');
  const [homeTeam, setHomeTeam] = useState('');
  const [awayTeam, setAwayTeam] = useState('');
  const [forceUpcoming, setForceUpcoming] = useState(false);
  const eventIdRef = useRef('');
  const suggestRequestIdRef = useRef(0);
  const [suggestions, setSuggestions] = useState<LiveFeedSuggestionsResponse | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);
  const [sportsSearchQuery, setSportsSearchQuery] = useState('');
  const [sportsSearchLoading, setSportsSearchLoading] = useState(false);
  const [sportsSearchError, setSportsSearchError] = useState<string | null>(null);
  const [eventLookupLoading, setEventLookupLoading] = useState(false);
  const [eventLookupError, setEventLookupError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    eventIdRef.current = eventId;
  }, [eventId]);

  useEffect(() => {
    if (!isOpen || !market) return;

    // Reset all state to defaults first
    setKind('crypto-price');
    setEnabled(true);
    setCoingeckoId('bitcoin');
    setBaseSymbol('BTC');
    setQuoteSymbol('USD');
    setVsCurrency('usd');
    setCryptoMetric('price');
    setEventId('');
    setLeagueName('');
    setHomeTeam('');
    setAwayTeam('');
    setForceUpcoming(false);
    setError(null);
    setEventLookupError(null);
    setSuggestions(null);
    setSuggestionsError(null);
    setSportsSearchError(null);
    setSportsSearchLoading(false);
    setEventLookupLoading(false);

    // Then apply existing config if present
    if (existing) {
      setKind(existing.kind);
      setEnabled(existing.enabled);
      if (existing.kind === 'crypto-price' && existing.crypto) {
        setCoingeckoId(existing.crypto.coingeckoId || 'bitcoin');
        setBaseSymbol(existing.crypto.baseSymbol || 'BTC');
        setQuoteSymbol(existing.crypto.quoteSymbol || 'USD');
        setVsCurrency(existing.crypto.vsCurrency || 'usd');
        setCryptoMetric(existing.crypto.metric || 'price');
      }
      if (existing.kind === 'sports-score' && existing.sports) {
        setEventId(existing.sports.eventId || '');
        setLeagueName(existing.sports.leagueName || '');
        setHomeTeam(existing.sports.homeTeam || '');
        setAwayTeam(existing.sports.awayTeam || '');
        setForceUpcoming(existing.sports.forceUpcoming || false);
      }
    }
  }, [isOpen, market, existing]);

  useEffect(() => {
    if (!isOpen || !market) return;
    setSportsSearchQuery(`${market.title}`.trim());
    setSportsSearchError(null);
  }, [isOpen, market]);

  useEffect(() => {
    if (!isOpen || kind !== 'sports-score') return;
    const query = sportsSearchQuery.trim();
    if (!query || query.length < 3) {
      setSportsSearchError(null);
      setSuggestions(prev => prev ? { ...prev, sports: { ...prev.sports, candidates: [] } } : null);
      setSportsSearchLoading(false);
      return;
    }

    let cancelled = false;
    setSportsSearchLoading(true);
    setSportsSearchError(null);

    searchSportsEvents(query)
      .then((result) => {
        if (cancelled) return;
        setSuggestions((prev) => {
          if (!prev) {
            return {
              crypto: {
                detected: false,
                confidence: 0,
                reason: 'No crypto suggestion yet.',
                coingeckoId: null,
                baseSymbol: null,
                quoteSymbol: 'USD',
                vsCurrency: 'usd',
                metric: 'price',
              },
              sports: {
                detected: result.candidates.length > 0,
                confidence: result.candidates.length > 0 ? 0.55 : 0,
                reason: result.candidates.length > 0
                  ? 'Found sports matches from search query. Pick the correct one.'
                  : 'No sports matches found from search query.',
                homeTeam: result.candidates[0]?.homeTeam || null,
                awayTeam: result.candidates[0]?.awayTeam || null,
                selectedEventId: result.candidates[0]?.eventId || null,
                selectedLeagueName: result.candidates[0]?.leagueName || null,
                candidates: result.candidates,
              },
            };
          }
          return {
            ...prev,
            sports: {
              ...prev.sports,
              candidates: result.candidates,
              selectedEventId: prev.sports.selectedEventId || result.candidates[0]?.eventId || null,
              selectedLeagueName: prev.sports.selectedLeagueName || result.candidates[0]?.leagueName || null,
            },
          };
        });

        if (!eventIdRef.current && result.candidates[0]) {
          setEventId(result.candidates[0].eventId);
          eventIdRef.current = result.candidates[0].eventId;
          setLeagueName(result.candidates[0].leagueName);
          setHomeTeam(result.candidates[0].homeTeam || '');
          setAwayTeam(result.candidates[0].awayTeam || '');
        }
      })
      .catch((err) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Failed to search sports matches.';
        setSportsSearchError(message);
      })
      .finally(() => {
        if (!cancelled) setSportsSearchLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [sportsSearchQuery, kind, isOpen, existing?.kind]);

  const applySportsCandidate = (candidate: LiveFeedSuggestionsResponse['sports']['candidates'][number]) => {
    setEventId(candidate.eventId);
    setLeagueName(candidate.leagueName);
    setHomeTeam(candidate.homeTeam || '');
    setAwayTeam(candidate.awayTeam || '');
  };

  const resolveSportsEventId = async (rawEventId: string) => {
    const nextEventId = rawEventId.trim();
    if (!nextEventId) return null;

    const existingCandidate = suggestions?.sports.candidates.find((candidate) => candidate.eventId === nextEventId) || null;
    if (existingCandidate) {
      applySportsCandidate(existingCandidate);
      setEventLookupError(null);
      return existingCandidate;
    }

    setEventLookupLoading(true);
    setEventLookupError(null);
    try {
      const candidate = await lookupSportsEventById(nextEventId);
      if (!candidate) {
        throw new Error('Sports event not found for this event id.');
      }

      applySportsCandidate(candidate);
      setSuggestions((prev) => {
        if (!prev) {
          return {
            crypto: {
              detected: false,
              confidence: 0,
              reason: 'No crypto suggestion yet.',
              coingeckoId: null,
              baseSymbol: null,
              quoteSymbol: 'USD',
              vsCurrency: 'usd',
              metric: 'price',
            },
            sports: {
              detected: true,
              confidence: 0.6,
              reason: 'Loaded sports event from TheSportsDB event id.',
              homeTeam: candidate.homeTeam || null,
              awayTeam: candidate.awayTeam || null,
              selectedEventId: candidate.eventId,
              selectedLeagueName: candidate.leagueName,
              candidates: [candidate],
            },
          };
        }

        const candidates = [
          candidate,
          ...prev.sports.candidates.filter((item) => item.eventId !== candidate.eventId),
        ];

        return {
          ...prev,
          sports: {
            ...prev.sports,
            detected: true,
            reason: 'Loaded sports event from TheSportsDB event id.',
            homeTeam: candidate.homeTeam || prev.sports.homeTeam,
            awayTeam: candidate.awayTeam || prev.sports.awayTeam,
            selectedEventId: candidate.eventId,
            selectedLeagueName: candidate.leagueName,
            candidates,
          },
        };
      });

      return candidate;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load SportsDB event id.';
      setEventLookupError(message);
      throw err;
    } finally {
      setEventLookupLoading(false);
    }
  };

  const applyCryptoSuggestion = (suggestion: LiveFeedSuggestionsResponse['crypto']) => {
    if (!suggestion.detected || !suggestion.coingeckoId || !suggestion.baseSymbol) return;
    setKind('crypto-price');
    setCoingeckoId(suggestion.coingeckoId);
    setBaseSymbol(suggestion.baseSymbol);
    setQuoteSymbol(suggestion.quoteSymbol || 'USD');
    setVsCurrency(suggestion.vsCurrency || 'usd');
    setCryptoMetric(suggestion.metric || 'price');
  };

  const applySportsSuggestion = (suggestion: LiveFeedSuggestionsResponse['sports']) => {
    if (!suggestion.detected) return;
    setKind('sports-score');
    setEventId(suggestion.selectedEventId || '');
    setLeagueName(suggestion.selectedLeagueName || '');
    setHomeTeam(suggestion.homeTeam || '');
    setAwayTeam(suggestion.awayTeam || '');
    setSportsSearchQuery(`${suggestion.homeTeam || ''} vs ${suggestion.awayTeam || ''}`.trim());
  };

  useEffect(() => {
    if (!isOpen || !market) return;

    const requestId = ++suggestRequestIdRef.current;
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
        if (cancelled || requestId !== suggestRequestIdRef.current) return;
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
        if (cancelled || requestId !== suggestRequestIdRef.current) return;
        const message = err instanceof Error ? err.message : 'Could not auto-detect feed suggestions.';
        setSuggestionsError(message);
      })
      .finally(() => {
        if (!cancelled && requestId === suggestRequestIdRef.current) setSuggesting(false);
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
    return Boolean(eventId.trim());
  }, [signer, address, market, kind, coingeckoId, baseSymbol, quoteSymbol, vsCurrency, eventId]);

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
            metric: cryptoMetric,
          },
        };
    } else {
      const resolvedCandidate = (!leagueName.trim() || !homeTeam.trim() || !awayTeam.trim())
        ? await resolveSportsEventId(eventId.trim()).catch(() => null)
        : null;

      if (resolvedCandidate === null && (!leagueName.trim() || !homeTeam.trim() || !awayTeam.trim())) {
        setError('Unable to resolve sports event. Please check the event ID and try again.');
        setSaving(false);
        return;
      }

      payload = {
        marketAddress: market.address,
        enabled,
        kind: 'sports-score',
        sports: {
          eventId: eventId.trim(),
          leagueName: (resolvedCandidate?.leagueName || leagueName).trim(),
          homeTeam: (resolvedCandidate?.homeTeam || homeTeam).trim() || undefined,
          awayTeam: (resolvedCandidate?.awayTeam || awayTeam).trim() || undefined,
          forceUpcoming,
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
    <div role="dialog" aria-modal="true" aria-labelledby="live-feed-settings-title" className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-dark-950/80 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div className="relative card w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 animate-slide-up">
        <button onClick={onClose} aria-label="Close live feed settings" className="absolute top-4 right-4 w-8 h-8 rounded-lg bg-dark-750 border border-white/[0.08] flex items-center justify-center text-dark-400 hover:text-white hover:border-white/[0.15] transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="mb-5">
          <h2 id="live-feed-settings-title" className="text-xl font-bold text-white">Live Feed Settings</h2>
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
                <label className="label">Metric</label>
                <select
                  value={cryptoMetric}
                  onChange={(e) => setCryptoMetric(e.target.value as 'price' | 'market-cap' | 'volume-24h')}
                  className="input-field"
                >
                  <option value="price">Price</option>
                  <option value="market-cap">Market Cap</option>
                  <option value="volume-24h">24h Volume</option>
                </select>
              </div>
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
              {suggestions?.sports.candidates && suggestions.sports.candidates.length === 0 && !sportsSearchLoading && sportsSearchQuery.trim().length >= 3 && (
                <p className="text-2xs text-dark-500">No matches found yet. Try team names only, like "Brazil vs France".</p>
              )}

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
                        setHomeTeam(chosen.homeTeam || '');
                        setAwayTeam(chosen.awayTeam || '');
                      }
                    }}
                    className="input-field"
                  >
                      <option value="">Select detected event</option>
                      {suggestions.sports.candidates.map((candidate) => (
                        <option key={candidate.eventId} value={candidate.eventId}>
                          {candidate.homeTeam} vs {candidate.awayTeam} · {candidate.leagueName} · {candidate.kickoffAt ? new Date(candidate.kickoffAt).toLocaleString() : 'Date N/A'} · {candidate.statusLabel}
                        </option>
                      ))}
                    </select>
                  </div>
              )}

              <div>
                <label className="label">Search Matches</label>
                <input
                  type="text"
                  value={sportsSearchQuery}
                  onChange={(e) => setSportsSearchQuery(e.target.value)}
                  placeholder="Brazil vs France"
                  className="input-field"
                />
                <p className="text-2xs text-dark-500 mt-1">Search similar matches; pick the right date/status from detected events.</p>
                {sportsSearchLoading && (
                  <p className="text-2xs text-dark-500 mt-1">Searching matches...</p>
              )}
                {sportsSearchError && (
                  <p className="text-2xs text-amber-400 mt-1">{sportsSearchError}</p>
                )}
              </div>

              <div>
                <label className="label">TheSportsDB Event ID</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={eventId}
                    onChange={(e) => {
                      setEventId(e.target.value);
                      setEventLookupError(null);
                    }}
                    onBlur={() => {
                      if (eventId.trim()) {
                        void resolveSportsEventId(eventId.trim()).catch(() => {});
                      }
                    }}
                    placeholder="2466173"
                    className="input-field"
                  />
                  <button
                    type="button"
                    onClick={() => void resolveSportsEventId(eventId.trim()).catch(() => {})}
                    disabled={!eventId.trim() || eventLookupLoading}
                    className="btn-secondary shrink-0"
                  >
                    {eventLookupLoading ? 'Loading...' : 'Load ID'}
                  </button>
                </div>
                <p className="text-2xs text-dark-500 mt-1">Paste only the TheSportsDB event id and we will auto-fill league and teams.</p>
                {eventLookupError && (
                  <p className="text-2xs text-amber-400 mt-1">{eventLookupError}</p>
                )}
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
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Home Team (for validation)</label>
                  <input
                    type="text"
                    value={homeTeam}
                    onChange={(e) => setHomeTeam(e.target.value)}
                    placeholder="Arsenal"
                    className="input-field"
                  />
                </div>
                <div>
                  <label className="label">Away Team (for validation)</label>
                  <input
                    type="text"
                    value={awayTeam}
                    onChange={(e) => setAwayTeam(e.target.value)}
                     placeholder="Atletico Madrid"
                     className="input-field"
                   />
                 </div>
               </div>
               <label className="flex items-center gap-2 text-sm text-dark-300">
                 <input
                   type="checkbox"
                   checked={forceUpcoming}
                   onChange={(e) => setForceUpcoming(e.target.checked)}
                   className="rounded border-white/[0.15] bg-dark-900"
                 />
                 Force Upcoming (always show as upcoming until manually disabled)
               </label>
               {forceUpcoming && (
                 <p className="text-2xs text-purple-400">This feed will always show as "Upcoming" regardless of match status. Disable this after the match starts.</p>
               )}
 
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
  const [stageFilter, setStageFilter] = useState<StageFilter>('active');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
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

  const categoryOptions = useMemo(() => {
    const unique = Array.from(new Set(sortedMarkets.map((m) => m.category?.trim()).filter(Boolean)));
    unique.sort((a, b) => a.localeCompare(b));
    return unique;
  }, [sortedMarkets]);

  const filteredMarkets = useMemo(() => {
    return sortedMarkets.filter((market) => {
      if (!matchesStageFilter(market.stage, stageFilter)) return false;
      if (categoryFilter !== 'all' && market.category !== categoryFilter) return false;
      return true;
    });
  }, [sortedMarkets, stageFilter, categoryFilter]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!filteredMarkets.length) {
        setConfigLoading(false);
        return;
      }
      setConfigLoading(true);
      try {
        const fetched = await fetchLiveFeedConfigs(filteredMarkets.map((m) => m.market));
        if (cancelled) return;
        const next: Record<string, LiveFeedConfig> = {};
        for (const item of fetched) {
          next[item.marketAddress.toLowerCase()] = item;
        }
        setConfigs((prev) => ({ ...prev, ...next }));
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
  }, [filteredMarkets, refreshTick]);

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
          {filteredMarkets.filter((m) => configs[m.market.toLowerCase()]?.enabled).length} enabled
        </span>
      </div>

      <div className="card p-4 space-y-4">
        <div>
          <p className="text-2xs uppercase tracking-[0.14em] text-white/45 font-semibold mb-2">Stage Filter</p>
          <div className="flex flex-wrap gap-2">
            {[
              { key: 'all', label: 'All' },
              { key: 'active', label: 'Active / Suspended' },
              { key: 'resolved', label: 'Resolved' },
              { key: 'cancelled', label: 'Cancelled / Expired' },
            ].map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setStageFilter(item.key as StageFilter)}
                className={`chip ${stageFilter === item.key ? 'chip-active' : ''}`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-2xs uppercase tracking-[0.14em] text-white/45 font-semibold mb-2">Category Filter</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setCategoryFilter('all')}
              className={`chip ${categoryFilter === 'all' ? 'chip-active' : ''}`}
            >
              All
            </button>
            {categoryOptions.map((category) => (
              <button
                key={category}
                type="button"
                onClick={() => setCategoryFilter(category)}
                className={`chip ${categoryFilter === category ? 'chip-active' : ''}`}
              >
                {category}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="card p-4 border-primary-500/20 bg-primary-500/5">
        <p className="text-sm text-dark-300 leading-relaxed">
          Configure live reference data for <span className="text-white font-semibold">existing markets and future markets</span>.
          These settings are keyed by market address, so you can add feeds retroactively without redeploying contracts.
        </p>
      </div>

      {sortedMarkets.length === 0 ? (
        <EmptyState title="No markets yet" description="Create a market first, then attach a live feed." />
      ) : filteredMarkets.length === 0 ? (
        <EmptyState title="No markets in this filter" description="Try another stage/category combination." />
      ) : (
        <div className="space-y-3">
          {filteredMarkets.map((market) => {
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
                        Source: CoinGecko `{config.crypto.coingeckoId}` ({config.crypto.baseSymbol}/{config.crypto.quoteSymbol}) · metric: {config.crypto.metric || 'price'}
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
