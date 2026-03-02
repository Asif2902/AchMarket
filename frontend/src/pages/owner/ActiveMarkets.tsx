import { useState } from 'react';
import { STAGE } from '../../config/network';
import { PageLoader } from '../../components/LoadingSpinner';
import EmptyState from '../../components/EmptyState';
import { useOwnerMarkets, OwnerMarketCard, ResolveModal, CancelModal } from './OwnerMarketUtils';
import type { OwnerMarketData } from './OwnerMarketUtils';

export default function ActiveMarkets() {
  const { markets, loading, refetch } = useOwnerMarkets();
  const [resolveTarget, setResolveTarget] = useState<OwnerMarketData | null>(null);
  const [cancelTarget, setCancelTarget] = useState<OwnerMarketData | null>(null);

  const active = markets.filter(m => m.stage === STAGE.Active);

  if (loading) return <PageLoader />;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
            <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          </div>
          Active Markets
        </h1>
        <span className="badge bg-dark-750/80 text-dark-300 border-white/[0.06]">{active.length}</span>
      </div>

      {active.length === 0 ? (
        <EmptyState
          title="No active markets"
          description="There are no markets currently open for trading. Create one to get started."
        />
      ) : (
        <div className="space-y-4">
          {active.map((m, i) => (
            <div key={m.market} className="animate-fade-in" style={{ animationDelay: `${i * 60}ms` }}>
              <OwnerMarketCard
                market={m}
                actions={
                  <>
                    <button onClick={() => setResolveTarget(m)} className="btn-success text-xs">
                      <span className="flex items-center gap-1.5">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        Resolve
                      </span>
                    </button>
                    <button onClick={() => setCancelTarget(m)} className="btn-danger text-xs">
                      <span className="flex items-center gap-1.5">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        Cancel
                      </span>
                    </button>
                  </>
                }
              />
            </div>
          ))}
        </div>
      )}

      {resolveTarget && (
        <ResolveModal
          market={resolveTarget}
          onClose={() => setResolveTarget(null)}
          onResolved={() => { setResolveTarget(null); refetch(); }}
        />
      )}
      {cancelTarget && (
        <CancelModal
          market={cancelTarget}
          onClose={() => setCancelTarget(null)}
          onCancelled={() => { setCancelTarget(null); refetch(); }}
        />
      )}
    </div>
  );
}
