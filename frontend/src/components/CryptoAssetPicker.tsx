import { useEffect, useId, useRef, useState } from 'react';
import { searchCryptoAssets } from '../services/live';
import type { LiveCryptoSearchCandidate } from '../types/live';

interface CryptoAssetPickerProps {
  selectedId: string;
  selectedSymbol: string;
  selectedQuoteSymbol: string;
  onSelect: (candidate: LiveCryptoSearchCandidate) => void;
  onChange?: () => void;
}

export default function CryptoAssetPicker({
  selectedId,
  selectedSymbol,
  selectedQuoteSymbol,
  onSelect,
  onChange,
}: CryptoAssetPickerProps) {
  const inputId = useId();
  const requestIdRef = useRef(0);
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<LiveCryptoSearchCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      requestIdRef.current += 1;
      setCandidates([]);
      setLoading(false);
      setError('');
      return;
    }

    const requestId = ++requestIdRef.current;
    const timer = setTimeout(() => {
      setLoading(true);
      setError('');

      searchCryptoAssets(trimmed)
        .then((result) => {
          if (requestId !== requestIdRef.current) return;
          setCandidates(result.candidates);
          if (result.candidates.length === 0) {
            setError('No CoinGecko matches found for this search.');
          }
        })
        .catch((err) => {
          if (requestId !== requestIdRef.current) return;
          setCandidates([]);
          setError(err instanceof Error ? err.message : 'Failed to search CoinGecko tokens.');
        })
        .finally(() => {
          if (requestId === requestIdRef.current) {
            setLoading(false);
          }
        });
    }, 250);

    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div className="sm:col-span-2">
      <label htmlFor={inputId} className="label">Search CoinGecko Token</label>
      <input
        id={inputId}
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          onChange?.();
        }}
        placeholder="Search by token name or symbol"
        className="input-field"
      />
      <div className="mt-2 rounded-xl border border-white/[0.08] bg-dark-900/50">
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-white/[0.08] text-2xs">
          <span className="text-dark-400">
            Selected: {selectedSymbol || 'Token'} / {selectedQuoteSymbol || 'USD'}
          </span>
          <span className="text-dark-500">{selectedId || 'No token selected'}</span>
        </div>
        {loading ? (
          <p className="px-3 py-3 text-xs text-dark-500">Searching CoinGecko...</p>
        ) : error ? (
          <p className="px-3 py-3 text-xs text-amber-400">{error}</p>
        ) : candidates.length > 0 ? (
          <div className="max-h-56 overflow-y-auto">
            {candidates.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                onClick={() => {
                  onSelect(candidate);
                  setQuery('');
                  setCandidates([]);
                  setError('');
                }}
                className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-white/[0.04] transition-colors"
              >
                {candidate.thumb ? (
                  <img src={candidate.thumb} alt="" className="h-7 w-7 rounded-full bg-white/5 object-cover" />
                ) : (
                  <div className="h-7 w-7 rounded-full bg-white/[0.06] border border-white/[0.08]" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-white truncate">
                    {candidate.symbol} <span className="text-dark-400 font-normal">{candidate.name}</span>
                  </p>
                  <p className="text-2xs text-dark-500 truncate">{candidate.id}</p>
                </div>
                <span className="text-2xs text-dark-500">
                  {candidate.marketCapRank !== null ? `#${candidate.marketCapRank}` : 'Unranked'}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="px-3 py-3 text-xs text-dark-500">
            Type at least 2 characters to search any CoinGecko-supported token.
          </p>
        )}
      </div>
    </div>
  );
}
