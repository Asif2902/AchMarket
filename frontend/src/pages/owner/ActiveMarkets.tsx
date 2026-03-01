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
    <div className="p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Active Markets</h1>
        <span className="text-sm text-dark-400">{active.length} market{active.length !== 1 ? 's' : ''}</span>
      </div>

      {active.length === 0 ? (
        <EmptyState title="No active markets" description="There are no markets currently open for trading." />
      ) : (
        <div className="space-y-4">
          {active.map(m => (
            <OwnerMarketCard
              key={m.market}
              market={m}
              actions={
                <>
                  <button onClick={() => setResolveTarget(m)} className="btn-success text-xs">Resolve</button>
                  <button onClick={() => setCancelTarget(m)} className="btn-danger text-xs">Cancel</button>
                </>
              }
            />
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
