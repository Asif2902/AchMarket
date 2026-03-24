import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { useWallet } from '../../context/WalletContext';
import { FACTORY_ADDRESS, LENS_ADDRESS } from '../../config/network';
import { LENS_ABI, FACTORY_ABI } from '../../config/abis';
import EmptyState from '../../components/EmptyState';
import UsdcIcon from '../../components/UsdcIcon';
import { formatUSDC, formatCompact, formatCompactUSDC } from '../../utils/format';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

interface GlobalStats {
  totalMarkets: number;
  totalVolumeWei: bigint;
  totalParticipants: number;
  activeMarkets: number;
  resolvedMarkets: number;
  cancelledOrExpiredMarkets: number;
}

interface DailyVolume {
  date: string;
  dayLabel: string;
  volume: number;
  trades: number;
}

export default function Analytics() {
  const { readProvider } = useWallet();
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dailyVolume, setDailyVolume] = useState<DailyVolume[]>([]);

  const fetchStats = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, readProvider);
      const totalMarkets = Number(await factory.totalMarkets());

      if (totalMarkets === 0) {
        setStats({
          totalMarkets: 0,
          totalVolumeWei: 0n,
          totalParticipants: 0,
          activeMarkets: 0,
          resolvedMarkets: 0,
          cancelledOrExpiredMarkets: 0,
        });
        setDailyVolume(generateEmptyDailyVolumes());
        setLoading(false);
        return;
      }

      const marketAddrs = await Promise.all(
        Array.from({ length: totalMarkets }, (_, i) => factory.markets(i))
      );

      const marketAbi = [
        "function totalVolumeWei() view returns (uint256)",
        "function participantCount() view returns (uint256)",
        "function stage() view returns (uint8)",
        "function createdAt() view returns (uint256)",
      ];

      const BATCH_SIZE = 5;
      let totalVolume = 0n;
      let totalParticipants = 0;
      let activeMarkets = 0;
      let resolvedMarkets = 0;
      let cancelledOrExpired = 0;

      const dailyMap = new Map<string, { volume: bigint; trades: number }>();
      for (let i = 6; i >= 0; i--) {
        const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
        const dateStr = date.toISOString().split('T')[0];
        dailyMap.set(dateStr, { volume: 0n, trades: 0 });
      }

      for (let i = 0; i < marketAddrs.length; i += BATCH_SIZE) {
        const batch = marketAddrs.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(
          batch.map(async (addr) => {
            try {
              const market = new ethers.Contract(addr, marketAbi, readProvider);
              const [volume, participants, stage, created] = await Promise.all([
                market.totalVolumeWei(),
                market.participantCount(),
                market.stage(),
                market.createdAt(),
              ]);
              return { volume, participants, stage, created, addr };
            } catch {
              return null;
            }
          })
        );

        for (const r of results) {
          if (!r) continue;
          totalVolume += r.volume;
          totalParticipants += Number(r.participants);

          if (r.stage === 0) activeMarkets++;
          else if (r.stage === 2) resolvedMarkets++;
          else cancelledOrExpired++;

          const createdDate = new Date(Number(r.created) * 1000);
          const dateStr = createdDate.toISOString().split('T')[0];
          const dayData = dailyMap.get(dateStr);
          if (dayData && r.volume > 0n) {
            dayData.volume += r.volume;
            dayData.trades += 1;
          }
        }
      }

      setStats({
        totalMarkets,
        totalVolumeWei: totalVolume,
        totalParticipants,
        activeMarkets,
        resolvedMarkets,
        cancelledOrExpiredMarkets: cancelledOrExpired,
      });

      const dailyData: DailyVolume[] = Array.from(dailyMap.entries()).map(([date, data]) => ({
        date,
        dayLabel: new Date(date).toLocaleDateString('en-US', { weekday: 'short' }),
        volume: Number(data.volume) / 1e18,
        trades: data.trades,
      }));
      setDailyVolume(dailyData);
    } catch (err) {
      console.error('Failed to fetch analytics:', err);
      setError(err instanceof Error ? err.message : 'Failed to load analytics data');
    } finally {
      setLoading(false);
    }
  }, [readProvider]);

  const generateEmptyDailyVolumes = (): DailyVolume[] => {
    const now = Date.now();
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(now - (6 - i) * 24 * 60 * 60 * 1000);
      return {
        date: date.toISOString().split('T')[0],
        dayLabel: date.toLocaleDateString('en-US', { weekday: 'short' }),
        volume: 0,
        trades: 0,
      };
    });
  };

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
          <h1 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2">
            <svg className="w-5 h-5 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
            </svg>
            Analytics
          </h1>
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
            {/* Daily Bar Volume Chart */}
            <div className="card p-4 md:p-6">
              <h2 className="section-header mb-4 md:mb-5">Daily Bar Volume (7 Days)</h2>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dailyVolume} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <XAxis 
                      dataKey="dayLabel" 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fill: '#9CA3AF', fontSize: 12 }}
                    />
                    <YAxis 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fill: '#9CA3AF', fontSize: 12 }}
                      tickFormatter={(value) => `$${formatCompact(value)}`}
                    />
                    <Tooltip
                      contentStyle={{ 
                        backgroundColor: '#1F2937', 
                        border: '1px solid #374151',
                        borderRadius: '8px',
                        color: '#F9FAFB'
                      }}
                      formatter={(value: number) => [`$${formatCompact(value)}`, 'Volume']}
                      labelStyle={{ color: '#9CA3AF' }}
                    />
                    <Bar dataKey="volume" radius={[4, 4, 0, 0]}>
                      {dailyVolume.map((entry, index) => (
                        <Cell 
                          key={`cell-${index}`} 
                          fill={entry.trades > 0 ? '#10B981' : '#374151'} 
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Main Stats Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
              <StatCard
                label="Total Markets"
                value={formatCompact(stats.totalMarkets)}
                icon={
                  <svg className="w-4 h-4 md:w-5 md:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
                  </svg>
                }
              />
              <StatCard
                label="Total Volume"
                value={formatCompactUSDC(stats.totalVolumeWei)}
                suffix="USDC"
                icon={<UsdcIcon size={18} />}
                accent
              />
              <StatCard
                label="Active Markets"
                value={formatCompact(stats.activeMarkets)}
                icon={
                  <svg className="w-4 h-4 md:w-5 md:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
                  </svg>
                }
                highlight
              />
              <StatCard
                label="Total Traders"
                value={formatCompact(stats.totalParticipants)}
                icon={
                  <svg className="w-4 h-4 md:w-5 md:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
                  </svg>
                }
              />
            </div>

            {/* Market Status Breakdown */}
            <div className="card p-4 md:p-6">
              <h2 className="section-header mb-4 md:mb-5">Market Status Breakdown</h2>
              <div className="grid grid-cols-3 gap-2 md:gap-4">
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
                <h2 className="section-header mb-3 sm:mb-4">Trading Activity</h2>
                <div className="space-y-4">
                  <MetricRow
                    label="Average Volume per Market"
                    value={stats.totalMarkets > 0 
                      ? formatCompactUSDC(stats.totalVolumeWei / BigInt(stats.totalMarkets))
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
                <h2 className="section-header mb-3 sm:mb-4">Platform Health</h2>
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
                    value={formatCompact(stats.resolvedMarkets)}
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
    <div className="card p-3 md:p-5 flex flex-col items-center justify-center text-center h-full">
      <div className="flex items-center justify-center gap-2 md:gap-3 mb-1">
        <div className={`w-6 h-6 md:w-7 md:h-7 rounded-lg flex items-center justify-center shrink-0 ${
          accent 
            ? 'bg-primary-500/15 text-primary-400' 
            : highlight
              ? 'bg-green-500/15 text-green-400'
              : 'bg-dark-750 text-dark-400'
        }`}>
          {icon}
        </div>
        <span className="text-2xs md:text-xs font-medium text-dark-500 uppercase tracking-wider">{label}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className={`text-xl md:text-2xl lg:text-3xl font-bold tabular-nums ${
          accent ? 'text-gradient' : highlight ? 'text-green-400' : 'text-white'
        }`}>
          {value}
        </span>
        {suffix && <span className="text-2xs md:text-xs text-dark-500 font-medium">{suffix}</span>}
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
  const size = 60;
  const strokeWidth = 4;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className="text-center">
      <div className="relative w-16 h-16 md:w-20 md:h-20 mx-auto mb-2">
        <svg className="w-16 h-16 md:w-20 md:h-20 transform -rotate-90" viewBox={`0 0 ${size} ${size}`}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="currentColor"
            strokeWidth={strokeWidth}
            fill="none"
            className="text-dark-750"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="currentColor"
            strokeWidth={strokeWidth}
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - percentage / 100)}
            className={`${color} transition-all duration-500`}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xs md:text-base font-bold text-white">{Math.round(percentage)}%</span>
        </div>
      </div>
      <div className="space-y-0.5">
        <p className="text-xs font-medium text-white">{label}</p>
        <p className="text-2xs text-dark-500">{value} market{value !== 1 ? 's' : ''}</p>
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
