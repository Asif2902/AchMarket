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
    <div className="p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Resolved Markets</h1>
        <span className="text-sm text-dark-400">{resolved.length} market{resolved.length !== 1 ? 's' : ''}</span>
      </div>

      {resolved.length === 0 ? (
        <EmptyState title="No resolved markets" description="No markets have been resolved yet." />
      ) : (
        <div className="space-y-4">
          {resolved.map(m => (
            <OwnerMarketCard
              key={m.market}
              market={m}
              actions={
                m.proofUri ? (
                  <a
                    href={resolveImageUri(m.proofUri)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-400 hover:text-blue-300 underline"
                  >
                    View Proof
                  </a>
                ) : null
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
