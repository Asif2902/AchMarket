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

  const now = Math.floor(Date.now() / 1000);
  const pending = markets.filter(m =>
    (m.stage === STAGE.Active && m.marketDeadline < now) ||
    (m.stage === STAGE.Suspended && m.marketDeadline < now) ||
    m.stage === STAGE.Expired
  );

  if (loading) return <PageLoader />;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
            <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          Pending Resolution
        </h1>
        {pending.length > 0 && (
          <span className="badge bg-amber-500/15 text-amber-400 border-amber-500/25 animate-pulse">
            {pending.length} pending
          </span>
        )}
      </div>

      {pending.length > 0 && (
        <div className="card p-4 border-amber-500/15">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
              <svg className="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>
            </div>
            <div>
              <p className="text-sm text-amber-400 font-medium mb-1">
                These markets need your attention
              </p>
              <p className="text-xs text-dark-400 leading-relaxed">
                After the trading deadline, you have a 3-day grace period to resolve or cancel.
                If the grace period expires without action, the market auto-expires and all
                participants can claim refunds.
              </p>
            </div>
          </div>
        </div>
      )}

      {pending.length === 0 ? (
        <EmptyState
          title="All caught up"
          description="No markets are pending resolution. Great job!"
        />
      ) : (
        <div className="space-y-4">
          {pending.map((m, i) => {
            const resolutionDeadline = m.marketDeadline + GRACE_PERIOD_SECONDS;
            const graceExpired = now > resolutionDeadline;
            const isExpired = m.stage === STAGE.Expired;
            const overdue = now - m.marketDeadline;
            const overdueHours = Math.floor(overdue / 3600);
            const overdueDays = Math.floor(overdue / 86400);
            const urgentLabel = overdueDays > 0 ? `${overdueDays}d overdue` : `${overdueHours}h overdue`;

            return (
              <div key={m.market} className="animate-fade-in" style={{ animationDelay: `${i * 60}ms` }}>
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
                            <span className="flex items-center gap-1.5">
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                              Resolve Now
                            </span>
                          </button>
                          <button
                            onClick={() => setCancelTarget(m)}
                            className="btn-danger text-xs"
                          >
                            <span className="flex items-center gap-1.5">
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                              Cancel
                            </span>
                          </button>
                        </>
                      )}
                      {isExpired && (
                        <div className="flex items-center gap-2 text-xs text-red-400">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" /></svg>
                          <span className="font-medium">Expired — refunds available</span>
                        </div>
                      )}
                      {!isExpired && graceExpired && (
                        <div className="flex items-center gap-2 text-xs text-red-400">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                          <span className="font-medium">Grace period expired — cannot resolve</span>
                        </div>
                      )}
                    </div>
                  }
                />
                {/* Grace period countdown */}
                {!isExpired && !graceExpired && (
                  <div className="px-4 sm:px-5 sm:ml-48 -mt-1 pb-1">
                    <div className="p-3 rounded-xl bg-amber-500/5 border border-amber-500/10 flex items-center gap-3">
                      <svg className="w-4 h-4 text-amber-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <div className="flex-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                        <span className="text-dark-400">
                          Deadline: {formatDate(resolutionDeadline)}
                        </span>
                        <span className="text-amber-400 font-medium flex items-center gap-1">
                          <Countdown deadline={resolutionDeadline} compact />
                          remaining
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
