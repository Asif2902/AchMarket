import EmptyState from '../../components/EmptyState';

export default function FeeManagement() {
  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-white">Fee Management</h1>

      <EmptyState
        title="No fee mechanism deployed"
        description="The current smart contracts do not include a platform fee system. Fee collection and withdrawal functionality can be added in a future contract upgrade."
        icon={
          <svg className="w-16 h-16 text-dark-600 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
              d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        }
      />

      <div className="card p-6 space-y-4">
        <h2 className="text-lg font-semibold text-dark-200">How fees could work</h2>
        <div className="space-y-3 text-sm text-dark-400">
          <div className="flex gap-3">
            <div className="w-6 h-6 rounded-full bg-primary-500/20 text-primary-400 flex items-center justify-center flex-shrink-0 text-xs font-bold">1</div>
            <p>A fee basis points (bps) setting on the factory or each market contract</p>
          </div>
          <div className="flex gap-3">
            <div className="w-6 h-6 rounded-full bg-primary-500/20 text-primary-400 flex items-center justify-center flex-shrink-0 text-xs font-bold">2</div>
            <p>Fee deducted on each trade (buy/sell) and accumulated in the contract</p>
          </div>
          <div className="flex gap-3">
            <div className="w-6 h-6 rounded-full bg-primary-500/20 text-primary-400 flex items-center justify-center flex-shrink-0 text-xs font-bold">3</div>
            <p>Owner can withdraw accumulated fees via a dedicated function</p>
          </div>
        </div>
      </div>
    </div>
  );
}
