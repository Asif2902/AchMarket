import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { useWallet } from '../../context/WalletContext';
import { FACTORY_ADDRESS, STAGE, STAGE_LABELS, STAGE_COLORS } from '../../config/network';
import { FACTORY_ABI, MARKET_ABI } from '../../config/abis';
import ImageWithFallback from '../../components/ImageWithFallback';
import ProbabilityBar from '../../components/ProbabilityBar';
import Countdown from '../../components/Countdown';
import { PageLoader } from '../../components/LoadingSpinner';
import EmptyState from '../../components/EmptyState';
import { formatUSDC, formatDate, formatTimeAgo, parseContractError } from '../../utils/format';

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
}

export function useOwnerMarkets() {
  const { readProvider } = useWallet();
  const [markets, setMarkets] = useState<OwnerMarketData[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, readProvider);
      const total = Number(await factory.totalMarkets());
      if (total === 0) { setMarkets([]); return; }

      const summaries = await factory.getMarketSummaries(0, total);
      const result: OwnerMarketData[] = [];

      for (const s of summaries) {
        // Get additional data (description, proofUri, createdAt) from the market contract
        const marketContract = new ethers.Contract(s.market, MARKET_ABI, readProvider);
        const info = await marketContract.getMarketInfo();

        result.push({
          market: s.market,
          marketId: Number(s.marketId),
          title: s.title,
          description: info._description,
          category: s.category,
          imageUri: s.imageUri,
          outcomeLabels: [...s.outcomeLabels],
          impliedProbabilitiesWad: [...s.impliedProbabilitiesWad],
          stage: Number(s.stage),
          winningOutcome: Number(s.winningOutcome),
          marketDeadline: Number(s.marketDeadline),
          createdAt: Number(info._createdAt),
          totalVolumeWei: s.totalVolumeWei,
          participants: Number(s.participants),
          proofUri: info._proofUri,
        });
      }

      setMarkets(result);
    } catch (err) {
      console.error('Failed to fetch markets:', err);
    } finally {
      setLoading(false);
    }
  }, [readProvider]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  return { markets, loading, refetch: fetchAll };
}

// Reusable market card for owner views
interface OwnerCardProps {
  market: OwnerMarketData;
  actions?: React.ReactNode;
  urgentBadge?: string;
}

export function OwnerMarketCard({ market, actions, urgentBadge }: OwnerCardProps) {
  const isActive = market.stage === STAGE.Active;

  return (
    <div className="card overflow-hidden animate-fade-in">
      <div className="flex flex-col sm:flex-row">
        <ImageWithFallback src={market.imageUri} alt={market.title} className="w-full sm:w-48 h-36 sm:h-auto flex-shrink-0" />
        <div className="flex-1 p-5">
          <div className="flex items-start justify-between mb-2">
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <span className={`badge ${STAGE_COLORS[market.stage]}`}>{STAGE_LABELS[market.stage]}</span>
                <span className="badge bg-dark-700/50 text-dark-300 border-dark-600/30">{market.category}</span>
                {urgentBadge && (
                  <span className="badge bg-yellow-500/20 text-yellow-400 border-yellow-500/30 animate-pulse">
                    {urgentBadge}
                  </span>
                )}
              </div>
              <h3 className="font-semibold text-white leading-tight">{market.title}</h3>
            </div>
          </div>

          <p className="text-sm text-dark-400 line-clamp-2 mb-3">{market.description}</p>

          <ProbabilityBar
            labels={market.outcomeLabels}
            probabilities={market.impliedProbabilitiesWad}
            winningOutcome={market.winningOutcome}
            isResolved={market.stage === STAGE.Resolved}
            compact
          />

          <div className="flex flex-wrap items-center gap-4 mt-3 text-xs text-dark-400">
            <span>Volume: {formatUSDC(market.totalVolumeWei)} USDC</span>
            <span>Participants: {market.participants}</span>
            {isActive && (
              <span className="flex items-center gap-1">
                Ends: <Countdown deadline={market.marketDeadline} compact className="text-dark-300" />
              </span>
            )}
            {!isActive && <span>Deadline: {formatDate(market.marketDeadline)}</span>}
          </div>

          {actions && <div className="mt-4 flex flex-wrap gap-2">{actions}</div>}
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

export function ResolveModal({ market, onClose, onResolved }: ResolveModalProps) {
  const { signer } = useWallet();
  const [selectedOutcome, setSelectedOutcome] = useState<number | null>(null);
  const [proofUri, setProofUri] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = selectedOutcome !== null && proofUri.trim().length > 0 && !submitting;

  const handleSubmit = async () => {
    if (!signer || selectedOutcome === null || !proofUri.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const marketContract = new ethers.Contract(market.market, MARKET_ABI, signer);
      const tx = await marketContract.resolve(selectedOutcome, proofUri.trim());
      await tx.wait();
      onResolved();
    } catch (err) {
      setError(parseContractError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-dark-950/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative card w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 animate-slide-up">
        <button onClick={onClose} className="absolute top-4 right-4 text-dark-400 hover:text-white">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <h2 className="text-xl font-bold text-white mb-2">Resolve Market</h2>

        {/* Context */}
        <div className="p-4 rounded-xl bg-dark-900/60 mb-6">
          <div className="flex gap-3">
            <ImageWithFallback src={market.imageUri} alt={market.title} className="w-16 h-16 rounded-xl flex-shrink-0" />
            <div>
              <h3 className="font-semibold text-white text-sm">{market.title}</h3>
              <p className="text-xs text-dark-400 line-clamp-2 mt-1">{market.description}</p>
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
              className={`w-full p-3 rounded-xl text-left text-sm transition-all border flex items-center gap-3 ${
                selectedOutcome === i
                  ? 'border-green-500/50 bg-green-500/10'
                  : 'border-dark-700/30 bg-dark-900/40 hover:border-dark-600'
              }`}
            >
              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                selectedOutcome === i ? 'border-green-500' : 'border-dark-600'
              }`}>
                {selectedOutcome === i && <div className="w-2.5 h-2.5 rounded-full bg-green-500" />}
              </div>
              <span className="font-medium text-white">{label}</span>
            </button>
          ))}
        </div>

        {/* Proof URI */}
        <label className="label">Resolution Proof URL *</label>
        <input
          type="text"
          value={proofUri}
          onChange={e => setProofUri(e.target.value)}
          placeholder="https://... (news article, tweet, IPFS link)"
          className="input-field mb-2"
        />
        <p className="text-xs text-dark-400 mb-4">
          This proof link will be displayed publicly to all users. Provide a link to verifiable evidence.
        </p>

        {proofUri.trim() && (
          <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 mb-6">
            <p className="text-xs text-dark-400 mb-1">Users will see:</p>
            <a href={proofUri} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-400 hover:text-blue-300 underline break-all">
              {proofUri}
            </a>
          </div>
        )}

        {error && (
          <div className="p-3 rounded-xl bg-red-500/10 text-red-400 border border-red-500/20 text-sm mb-4">
            {error}
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
            ) : 'Confirm Resolution'}
          </button>
        </div>
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
  const { signer } = useWallet();
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!signer) return;
    setSubmitting(true);
    setError(null);
    try {
      const marketContract = new ethers.Contract(market.market, MARKET_ABI, signer);
      const tx = await marketContract.cancel(reason.trim() || 'Cancelled by admin');
      await tx.wait();
      onCancelled();
    } catch (err) {
      setError(parseContractError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-dark-950/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative card w-full max-w-md p-6 animate-slide-up">
        <h2 className="text-xl font-bold text-white mb-2">Cancel Market</h2>
        <p className="text-sm text-dark-400 mb-4">
          Are you sure you want to cancel "{market.title}"? All participants will be eligible for a refund.
        </p>

        <label className="label">Reason (optional)</label>
        <input
          type="text"
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="Reason for cancellation..."
          className="input-field mb-4"
        />

        {error && (
          <div className="p-3 rounded-xl bg-red-500/10 text-red-400 border border-red-500/20 text-sm mb-4">{error}</div>
        )}

        <div className="flex gap-3">
          <button onClick={onClose} className="btn-secondary flex-1">Go Back</button>
          <button onClick={handleSubmit} disabled={submitting} className="btn-danger flex-1 font-semibold">
            {submitting ? 'Cancelling...' : 'Confirm Cancel'}
          </button>
        </div>
      </div>
    </div>
  );
}
