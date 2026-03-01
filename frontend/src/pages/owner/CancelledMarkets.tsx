import { STAGE } from '../../config/network';
import { PageLoader } from '../../components/LoadingSpinner';
import EmptyState from '../../components/EmptyState';
import { useOwnerMarkets, OwnerMarketCard } from './OwnerMarketUtils';
import { formatUSDC } from '../../utils/format';

export default function CancelledMarkets() {
  const { markets, loading } = useOwnerMarkets();
  const cancelled = markets.filter(m => m.stage === STAGE.Cancelled || m.stage === STAGE.Expired);

  if (loading) return <PageLoader />;

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Cancelled / Expired Markets</h1>
        <span className="text-sm text-dark-400">{cancelled.length} market{cancelled.length !== 1 ? 's' : ''}</span>
      </div>

      {cancelled.length === 0 ? (
        <EmptyState title="No cancelled or expired markets" description="No markets have been cancelled or expired." />
      ) : (
        <div className="space-y-4">
          {cancelled.map(m => (
            <OwnerMarketCard
              key={m.market}
              market={m}
              actions={
                <span className="text-xs text-dark-400">
                  Refundable volume: {formatUSDC(m.totalVolumeWei)} USDC
                </span>
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
