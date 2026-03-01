import { useState } from 'react';
import { STAGE } from '../../config/network';
import { PageLoader } from '../../components/LoadingSpinner';
import EmptyState from '../../components/EmptyState';
import { useOwnerMarkets, OwnerMarketCard, ResolveModal } from './OwnerMarketUtils';
import { formatTimeAgo } from '../../utils/format';
import type { OwnerMarketData } from './OwnerMarketUtils';

export default function PendingResolution() {
  const { markets, loading, refetch } = useOwnerMarkets();
  const [resolveTarget, setResolveTarget] = useState<OwnerMarketData | null>(null);

  // Pending = Active but deadline has passed, OR Expired
  const now = Math.floor(Date.now() / 1000);
  const pending = markets.filter(m =>
    (m.stage === STAGE.Active && m.marketDeadline < now) ||
    m.stage === STAGE.Expired
  );

  if (loading) return <PageLoader />;

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">
          Pending Resolution
          {pending.length > 0 && (
            <span className="ml-2 px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400 text-sm font-medium">
              {pending.length}
            </span>
          )}
        </h1>
      </div>

      {pending.length > 0 && (
        <div className="p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/20">
          <p className="text-sm text-yellow-400 font-medium">
            These markets need your attention. Their deadline has passed and they are waiting for resolution.
          </p>
        </div>
      )}

      {pending.length === 0 ? (
        <EmptyState title="All caught up" description="No markets are pending resolution. Great job!" />
      ) : (
        <div className="space-y-4">
          {pending.map(m => {
            const overdue = now - m.marketDeadline;
            const overdueHours = Math.floor(overdue / 3600);
            const overdueDays = Math.floor(overdue / 86400);
            const urgentLabel = overdueDays > 0 ? `${overdueDays}d overdue` : `${overdueHours}h overdue`;

            return (
              <OwnerMarketCard
                key={m.market}
                market={m}
                urgentBadge={urgentLabel}
                actions={
                  <button onClick={() => setResolveTarget(m)} className="btn-success text-xs pulse-glow">
                    Resolve Now
                  </button>
                }
              />
            );
          })}
        </div>
      )}

      {resolveTarget && (
        <ResolveModal
          market={resolveTarget}
          onClose={() => setResolveTarget(null)}
          onResolved={() => { setResolveTarget(null); refetch(); }}
        />
      )}
    </div>
  );
}
