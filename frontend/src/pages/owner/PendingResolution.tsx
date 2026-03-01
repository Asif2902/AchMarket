import { useState } from 'react';
import { STAGE } from '../../config/network';
import { PageLoader } from '../../components/LoadingSpinner';
import EmptyState from '../../components/EmptyState';
import Countdown from '../../components/Countdown';
import { useOwnerMarkets, OwnerMarketCard, ResolveModal, CancelModal } from './OwnerMarketUtils';
import { formatDate } from '../../utils/format';
import type { OwnerMarketData } from './OwnerMarketUtils';

const GRACE_PERIOD_SECONDS = 3 * 24 * 60 * 60; // 3 days

export default function PendingResolution() {
  const { markets, loading, refetch } = useOwnerMarkets();
  const [resolveTarget, setResolveTarget] = useState<OwnerMarketData | null>(null);
  const [cancelTarget, setCancelTarget] = useState<OwnerMarketData | null>(null);

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
          <p className="text-sm text-yellow-400 font-medium mb-1">
            These markets need your attention.
          </p>
          <p className="text-xs text-dark-400">
            After the trading deadline, you have a 3-day grace period to resolve or cancel.
            If the grace period expires without action, the market auto-expires and all
            participants can claim refunds. You will not be able to resolve after expiry.
          </p>
        </div>
      )}

      {pending.length === 0 ? (
        <EmptyState title="All caught up" description="No markets are pending resolution. Great job!" />
      ) : (
        <div className="space-y-4">
          {pending.map(m => {
            const resolutionDeadline = m.marketDeadline + GRACE_PERIOD_SECONDS;
            const graceExpired = now > resolutionDeadline;
            const isExpired = m.stage === STAGE.Expired;
            const overdue = now - m.marketDeadline;
            const overdueHours = Math.floor(overdue / 3600);
            const overdueDays = Math.floor(overdue / 86400);
            const urgentLabel = overdueDays > 0 ? `${overdueDays}d overdue` : `${overdueHours}h overdue`;

            return (
              <div key={m.market}>
                <OwnerMarketCard
                  market={m}
                  urgentBadge={urgentLabel}
                  actions={
                    <div className="flex flex-wrap items-center gap-2">
                      {!isExpired && !graceExpired && (
                        <>
                          <button
                            onClick={() => setResolveTarget(m)}
                            className="btn-success text-xs pulse-glow"
                          >
                            Resolve Now
                          </button>
                          <button
                            onClick={() => setCancelTarget(m)}
                            className="btn-danger text-xs"
                          >
                            Cancel
                          </button>
                        </>
                      )}
                      {isExpired && (
                        <span className="text-xs text-red-400 font-medium">
                          Expired — refunds available
                        </span>
                      )}
                      {!isExpired && graceExpired && (
                        <span className="text-xs text-red-400 font-medium">
                          Grace period expired — cannot resolve
                        </span>
                      )}
                    </div>
                  }
                />
                {/* Grace period countdown */}
                {!isExpired && !graceExpired && (
                  <div className="ml-0 sm:ml-48 px-5 pb-4 -mt-2">
                    <div className="p-3 rounded-xl bg-yellow-500/5 border border-yellow-500/10 flex items-center gap-3">
                      <svg className="w-4 h-4 text-yellow-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <div className="flex-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                        <span className="text-dark-400">
                          Resolution deadline: {formatDate(resolutionDeadline)}
                        </span>
                        <span className="text-yellow-400 flex items-center gap-1">
                          Time left: <Countdown deadline={resolutionDeadline} compact />
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
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
