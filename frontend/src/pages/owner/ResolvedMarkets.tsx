import { STAGE } from '../../config/network';
import { PageLoader } from '../../components/LoadingSpinner';
import EmptyState from '../../components/EmptyState';
import { useOwnerMarkets, OwnerMarketCard } from './OwnerMarketUtils';
import { resolveImageUri } from '../../utils/format';

export default function ResolvedMarkets() {
  const { markets, loading } = useOwnerMarkets();
  const resolved = markets.filter(m => m.stage === STAGE.Resolved);

  if (loading) return <PageLoader />;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary-500/10 border border-primary-500/20 flex items-center justify-center">
            <svg className="w-5 h-5 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          Resolved Markets
        </h1>
        <span className="badge bg-dark-750/80 text-dark-300 border-white/[0.08]">{resolved.length}</span>
      </div>

      {resolved.length === 0 ? (
        <EmptyState
          title="No resolved markets"
          description="No markets have been resolved yet."
        />
      ) : (
        <div className="space-y-4">
          {resolved.map((m, i) => (
            <div key={m.market} className="animate-fade-in" style={{ animationDelay: `${i * 60}ms` }}>
              <OwnerMarketCard
                market={m}
                actions={
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-dark-400 flex items-center gap-1.5">
                      <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                      Winner: <span className="text-emerald-400 font-medium">{m.outcomeLabels[m.winningOutcome]}</span>
                    </span>
                    {m.proofUri && (
                      <a
                        href={resolveImageUri(m.proofUri)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-xs text-primary-400 hover:text-primary-300 font-medium transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                        View Proof
                      </a>
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
