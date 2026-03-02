import { STAGE } from '../../config/network';
import { PageLoader } from '../../components/LoadingSpinner';
import EmptyState from '../../components/EmptyState';
import { useOwnerMarkets, OwnerMarketCard } from './OwnerMarketUtils';
import { formatUSDC } from '../../utils/format';
import { resolveImageUri } from '../../utils/format';

export default function CancelledMarkets() {
  const { markets, loading } = useOwnerMarkets();
  const cancelled = markets.filter(m => m.stage === STAGE.Cancelled || m.stage === STAGE.Expired);

  if (loading) return <PageLoader />;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-dark-700/80 border border-white/[0.08] flex items-center justify-center">
            <svg className="w-5 h-5 text-dark-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          </div>
          Cancelled / Expired
        </h1>
        <span className="badge bg-dark-750/80 text-dark-300 border-white/[0.08]">{cancelled.length}</span>
      </div>

      {cancelled.length === 0 ? (
        <EmptyState
          title="No cancelled or expired markets"
          description="No markets have been cancelled or expired."
        />
      ) : (
        <div className="space-y-4">
          {cancelled.map((m, i) => (
            <div key={m.market} className="animate-fade-in" style={{ animationDelay: `${i * 60}ms` }}>
              <OwnerMarketCard
                market={m}
                actions={
                  <div className="flex flex-col gap-2 w-full">
                    <div className="flex items-center gap-3 text-xs">
                      <span className="flex items-center gap-1.5 text-dark-400">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>
                        Refundable: <span className="text-white font-medium tabular-nums">{formatUSDC(m.totalVolumeWei)} USDC</span>
                      </span>
                    </div>
                    {(m.cancelReason || m.cancelProofUri) && (
                      <div className="p-3 rounded-lg bg-red-500/5 border border-red-500/10 space-y-2.5">
                        <div className="flex items-start gap-2">
                          <svg className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                          <div className="min-w-0 flex-1">
                            <p className="text-2xs font-medium text-red-400 uppercase tracking-wider mb-1">Cancellation Reason</p>
                            <p className="text-xs text-dark-300 whitespace-pre-wrap leading-relaxed">{m.cancelReason || 'No reason provided'}</p>
                          </div>
                        </div>
                        {m.cancelProofUri && (
                          <div className="mt-2">
                            <p className="text-2xs font-medium text-dark-500 uppercase tracking-wider mb-1.5">Proof / Evidence</p>
                            <a href={resolveImageUri(m.cancelProofUri)} target="_blank" rel="noopener noreferrer">
                              <img
                                src={resolveImageUri(m.cancelProofUri)}
                                alt="Cancellation proof"
                                className="rounded-lg border border-white/[0.06] max-h-48 w-auto object-contain bg-dark-800 hover:opacity-80 transition-opacity cursor-pointer"
                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                              />
                            </a>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                }
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
