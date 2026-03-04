import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { useWallet } from '../../context/WalletContext';
import { FACTORY_ADDRESS, LENS_ADDRESS, STAGE } from '../../config/network';
import { FACTORY_ABI, LENS_ABI } from '../../config/abis';
import { SkeletonCard } from '../../components/LoadingSpinner';
import EmptyState from '../../components/EmptyState';
import UsdcIcon from '../../components/UsdcIcon';
import { formatUSDC } from '../../utils/format';

interface GlobalStats {
  totalMarkets: number;
  totalVolumeWei: bigint;
  totalParticipants: number;
  activeMarkets: number;
  resolvedMarkets: number;
  cancelledOrExpiredMarkets: number;
}

export default function Analytics() {
  const { readProvider } = useWallet();
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      const lens = new ethers.Contract(LENS_ADDRESS, LENS_ABI, readProvider);
      const statsResult = await lens.getGlobalStats();

      setStats({
        totalMarkets: Number(statsResult.totalMarkets),
        totalVolumeWei: statsResult.totalVolumeWei,
        totalParticipants: Number(statsResult.totalParticipants),
        activeMarkets: Number(statsResult.activeMarkets),
        resolvedMarkets: Number(statsResult.resolvedMarkets),
        cancelledOrExpiredMarkets: Number(statsResult.cancelledOrExpiredMarkets),
      });
    } catch (err) {
      console.error('Failed to fetch analytics:', err);
      setError('Failed to load analytics data');
    } finally {
      setLoading(false);
    }
  }, [readProvider]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const refreshData = () => {
    fetchStats();
  };

  return (
    <div className="min-h-screen">
      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl sm:text-2xl font-bold text-white">Analytics</h1>
          <button
            onClick={refreshData}
            disabled={loading}
            className="btn-secondary flex items-center gap-2"
          >
            <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
        {loading && !stats ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="card p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-10 h-10 rounded-lg bg-dark-750 animate-pulse" />
                  <div className="h-3 w-20 bg-dark-750 rounded animate-pulse" />
                </div>
                <div className="h-8 w-24 bg-dark-750 rounded animate-pulse" />
              </div>
            ))}
          </div>
        ) : error ? (
          <EmptyState
            title="Error loading analytics"
            description={error}
          />
        ) : stats ? (
          <div className="space-y-8">
            {/* Main Stats Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              <StatCard
                label="Total Markets"
                value={stats.totalMarkets.toString()}
                icon={
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
                  </svg>
                }
              />
              <StatCard
                label="Total Volume"
                value={formatUSDC(stats.totalVolumeWei)}
                suffix="USDC"
                icon={<UsdcIcon size={20} />}
                accent
              />
              <StatCard
                label="Active Markets"
                value={stats.activeMarkets.toString()}
                icon={
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
                  </svg>
                }
                highlight
              />
              <StatCard
                label="Total Traders"
                value={stats.totalParticipants.toString()}
                icon={
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
                  </svg>
                }
              />
            </div>

            {/* Market Status Breakdown */}
            <div className="card p-4 sm:p-6">
              <h2 className="text-base sm:text-lg font-semibold text-white mb-4 sm:mb-5">Market Status Breakdown</h2>
              <div className="grid grid-cols-3 gap-4">
                <BreakdownCard
                  label="Active"
                  value={stats.activeMarkets}
                  total={stats.totalMarkets}
                  color="bg-green-500"
                />
                <BreakdownCard
                  label="Resolved"
                  value={stats.resolvedMarkets}
                  total={stats.totalMarkets}
                  color="bg-blue-500"
                />
                <BreakdownCard
                  label="Cancelled/Expired"
                  value={stats.cancelledOrExpiredMarkets}
                  total={stats.totalMarkets}
                  color="bg-red-500"
                />
              </div>
            </div>

            {/* Additional Metrics */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="card p-4 sm:p-6">
                <h2 className="text-base sm:text-lg font-semibold text-white mb-3 sm:mb-4">Trading Activity</h2>
                <div className="space-y-4">
                  <MetricRow
                    label="Average Volume per Market"
                    value={stats.totalMarkets > 0 
                      ? formatUSDC(stats.totalVolumeWei / BigInt(stats.totalMarkets))
                      : '0'}
                    suffix="USDC"
                  />
                  <MetricRow
                    label="Average Traders per Market"
                    value={stats.totalMarkets > 0 
                      ? (stats.totalParticipants / stats.totalMarkets).toFixed(1)
                      : '0'}
                  />
                  <MetricRow
                    label="Resolution Rate"
                    value={stats.totalMarkets > 0
                      ? ((stats.resolvedMarkets / stats.totalMarkets) * 100).toFixed(1)
                      : '0'}
                    suffix="%"
                  />
                </div>
              </div>

              <div className="card p-4 sm:p-6">
                <h2 className="text-base sm:text-lg font-semibold text-white mb-3 sm:mb-4">Platform Health</h2>
                <div className="space-y-4">
                  <MetricRow
                    label="Success Rate"
                    value={stats.totalMarkets > 0
                      ? (((stats.resolvedMarkets + stats.cancelledOrExpiredMarkets) / stats.totalMarkets) * 100).toFixed(1)
                      : '0'}
                    suffix="%"
                  />
                  <MetricRow
                    label="Active Market Ratio"
                    value={stats.totalMarkets > 0
                      ? ((stats.activeMarkets / stats.totalMarkets) * 100).toFixed(1)
                      : '0'}
                    suffix="%"
                  />
                  <MetricRow
                    label="Total Resolved"
                    value={stats.resolvedMarkets.toString()}
                  />
                </div>
              </div>
            </div>
          </div>
        ) : (
          <EmptyState
            title="No data available"
            description="No market data has been recorded yet."
          />
        )}
      </div>
    </div>
  );
}

function StatCard({ 
  label, 
  value, 
  suffix, 
  icon, 
  accent,
  highlight 
}: { 
  label: string; 
  value: string; 
  suffix?: string; 
  icon: React.ReactNode; 
  accent?: boolean;
  highlight?: boolean;
}) {
  return (
    <div className="card p-4 sm:p-5">
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
          accent 
            ? 'bg-primary-500/15 text-primary-400' 
            : highlight
              ? 'bg-green-500/15 text-green-400'
              : 'bg-dark-750 text-dark-400'
        }`}>
          {icon}
        </div>
        <span className="text-xs font-medium text-dark-500 uppercase tracking-wider">{label}</span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className={`text-2xl sm:text-3xl font-bold tabular-nums ${
          accent ? 'text-gradient' : highlight ? 'text-green-400' : 'text-white'
        }`}>
          {value}
        </span>
        {suffix && <span className="text-xs text-dark-500 font-medium">{suffix}</span>}
      </div>
    </div>
  );
}

function BreakdownCard({ 
  label, 
  value, 
  total, 
  color 
}: { 
  label: string; 
  value: number; 
  total: number; 
  color: string 
}) {
  const percentage = total > 0 ? (value / total) * 100 : 0;

  return (
    <div className="text-center">
      <div className="relative w-14 h-14 sm:w-20 sm:h-20 mx-auto mb-2 sm:mb-3">
        <svg className="w-14 h-14 sm:w-20 sm:h-20 transform -rotate-90">
          <circle
            cx="28"
            cy="28"
            r="24"
            stroke="currentColor"
            strokeWidth="4"
            fill="none"
            className="text-dark-750"
          />
          <circle
            cx="28"
            cy="28"
            r="24"
            stroke="currentColor"
            strokeWidth="4"
            fill="none"
            strokeDasharray={`${2 * Math.PI * 24}`}
            strokeDashoffset={`${2 * Math.PI * 24 * (1 - percentage / 100)}`}
            className={`${color} transition-all duration-500`}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xs sm:text-lg font-bold text-white">{Math.round(percentage)}%</span>
        </div>
      </div>
      <div className="space-y-0.5">
        <p className="text-xs sm:text-sm font-medium text-white">{label}</p>
        <p className="text-2xs sm:text-xs text-dark-500">{value} market{value !== 1 ? 's' : ''}</p>
      </div>
    </div>
  );
}

function MetricRow({ label, value, suffix }: { label: string; value: string; suffix?: string }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-4 py-2 border-b border-white/[0.06] last:border-0">
      <span className="text-xs sm:text-sm text-dark-400">{label}</span>
      <span className="text-sm font-semibold text-white whitespace-nowrap">
        {value}{suffix && <span className="text-dark-500 ml-1">{suffix}</span>}
      </span>
    </div>
  );
}
