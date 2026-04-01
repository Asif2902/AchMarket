import { useState, useEffect, useCallback, useMemo } from 'react';
import { ethers } from 'ethers';
import { useWallet } from '../../context/WalletContext';
import { FACTORY_ADDRESS } from '../../config/network';
import { FACTORY_ABI } from '../../config/abis';
import EmptyState from '../../components/EmptyState';
import UsdcIcon from '../../components/UsdcIcon';
import { formatCompact, formatCompactUSDC } from '../../utils/format';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Bar,
  ReferenceLine,
} from 'recharts';
import { fetchTradeEvents } from '../../services/blockscout';

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
        Array.from({ length: totalMarkets }, (_, i) => factory.markets(i)),
      );

      const marketAbi = [
        'function totalVolumeWei() view returns (uint256)',
        'function stage() view returns (uint8)',
      ];

      const marketPromises = marketAddrs.map(async (addr) => {
        try {
          const market = new ethers.Contract(addr, marketAbi, readProvider);
          const [volume, stage] = await Promise.all([
            market.totalVolumeWei(),
            market.stage(),
          ]);
          return { volume, stage, addr };
        } catch {
          return null;
        }
      });

      const results = await Promise.all(marketPromises);

      let totalVolume = 0n;
      let activeMarkets = 0;
      let resolvedMarkets = 0;
      let cancelledOrExpired = 0;

      const dailyMap = new Map<string, { volume: bigint; trades: number; dayLabel: string }>();
      for (let i = 6; i >= 0; i -= 1) {
        const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
        const dateStr = date.toISOString().split('T')[0];
        const dayLabel = date.toLocaleDateString('en-US', { weekday: 'short' });
        dailyMap.set(dateStr, { volume: 0n, trades: 0, dayLabel });
      }

      for (const r of results) {
        if (!r) continue;
        totalVolume += r.volume;

        const stageNum = Number(r.stage);
        if (stageNum === 0) activeMarkets += 1;
        else if (stageNum === 2) resolvedMarkets += 1;
        else if (stageNum === 3 || stageNum === 4) cancelledOrExpired += 1;
      }

      const blockNumber = await readProvider.getBlockNumber();
      const avgBlockTime = 0.5;
      const blocksPerDay = Math.floor(86400 / avgBlockTime);
      const startBlock = blockNumber - (blocksPerDay * 7);

      const eventPromises = marketAddrs.map(async (addr) => {
        try {
          return { addr, events: await fetchTradeEvents(addr, { startBlock }) };
        } catch {
          return { addr, events: [] };
        }
      });

      const eventResults = await Promise.all(eventPromises);

      for (const { events } of eventResults) {
        for (const event of events) {
          const date = new Date(event.timestamp * 1000);
          const dateStr = date.toISOString().split('T')[0];
          const dayData = dailyMap.get(dateStr);
          if (dayData) {
            dayData.volume += event.costOrProceedsWei;
            dayData.trades += 1;
          }
        }
      }

      const participantPromises = marketAddrs.map(async (addr) => {
        try {
          const market = new ethers.Contract(addr, ['function participantCount() view returns (uint256)'], readProvider);
          return market.participantCount();
        } catch {
          return null;
        }
      });

      const participantCounts = await Promise.all(participantPromises);
      let totalParticipants = 0;
      for (const count of participantCounts) {
        if (count) totalParticipants += Number(count);
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
        dayLabel: data.dayLabel,
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

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const refreshData = () => {
    fetchStats();
  };

  const aggregate = useMemo(() => {
    const totalTrades = dailyVolume.reduce((acc, d) => acc + d.trades, 0);
    const weeklyVolume = dailyVolume.reduce((acc, d) => acc + d.volume, 0);
    const avgDailyVolume = dailyVolume.length > 0 ? weeklyVolume / dailyVolume.length : 0;
    const maxDailyVolume = dailyVolume.reduce((acc, d) => Math.max(acc, d.volume), 0);
    const maxTrades = dailyVolume.reduce((acc, d) => Math.max(acc, d.trades), 0);

    const chartData = dailyVolume.map((d, index, arr) => {
      const prev = index > 0 ? arr[index - 1].volume : d.volume;
      const delta = d.volume - prev;
      const running7 = arr
        .slice(Math.max(0, index - 6), index + 1)
        .reduce((acc, day) => acc + day.volume, 0);
      return {
        ...d,
        volumeDelta: delta,
        running7,
      };
    });

    return {
      totalTrades,
      weeklyVolume,
      avgDailyVolume,
      maxDailyVolume,
      maxTrades,
      chartData,
    };
  }, [dailyVolume]);

  const statusData = useMemo(() => {
    if (!stats || stats.totalMarkets === 0) return [];
    return [
      {
        label: 'Active',
        value: stats.activeMarkets,
        pct: (stats.activeMarkets / stats.totalMarkets) * 100,
        color: '#34d399',
        bg: 'bg-emerald-500/12 border-emerald-500/30 text-emerald-300',
      },
      {
        label: 'Resolved',
        value: stats.resolvedMarkets,
        pct: (stats.resolvedMarkets / stats.totalMarkets) * 100,
        color: '#60a5fa',
        bg: 'bg-blue-500/12 border-blue-500/30 text-blue-300',
      },
      {
        label: 'Cancelled/Expired',
        value: stats.cancelledOrExpiredMarkets,
        pct: (stats.cancelledOrExpiredMarkets / stats.totalMarkets) * 100,
        color: '#f87171',
        bg: 'bg-red-500/12 border-red-500/30 text-red-300',
      },
    ];
  }, [stats]);

  return (
    <div className="min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
        <div className="card p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-gradient-to-br from-primary-500/[0.08] via-transparent to-emerald-500/[0.06]">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2">
              <svg className="w-5 h-5 text-primary-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
              </svg>
              Analytics
            </h1>
            <p className="text-xs text-white/55 mt-1">7-day trendline, volume momentum, and protocol health metrics</p>
          </div>
          <button
            onClick={refreshData}
            disabled={loading}
            className="btn-secondary flex items-center gap-2"
          >
            <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>{loading ? 'Refreshing' : 'Refresh'}</span>
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
          <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
              <StatCard label="Total Markets" value={formatCompact(stats.totalMarkets)} icon={<MiniGridIcon />} accent="neutral" />
              <StatCard label="Total Volume" value={formatCompactUSDC(stats.totalVolumeWei)} suffix="USDC" icon={<UsdcIcon size={18} />} accent="accent" />
              <StatCard label="Weekly Trades" value={formatCompact(aggregate.totalTrades)} icon={<MiniTradeIcon />} accent="success" />
              <StatCard label="Avg Daily Volume" value={formatCompact(aggregate.avgDailyVolume)} suffix="USDC" icon={<MiniTrendIcon />} accent="info" />
            </div>

            <div className="card p-4 md:p-6">
              <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-2 mb-4">
                <div>
                  <h2 className="section-header mb-1">Volume Trend (7 Days)</h2>
                  <p className="text-2xs text-white/45">Area line for volume with trade bars and day-to-day momentum</p>
                </div>
                <div className="flex items-center gap-3 text-2xs text-white/60">
                  <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-400" />Volume</span>
                  <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-blue-400" />Trades</span>
                </div>
              </div>

              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={aggregate.chartData} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="volumeFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="rgba(52,211,153,0.38)" />
                        <stop offset="100%" stopColor="rgba(52,211,153,0.02)" />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                    <XAxis
                      dataKey="dayLabel"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: '#94a3b8', fontSize: 12 }}
                    />
                    <YAxis
                      yAxisId="volume"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: '#94a3b8', fontSize: 12 }}
                      tickFormatter={(value) => `$${formatCompact(value)}`}
                    />
                    <YAxis yAxisId="trades" hide domain={[0, (max: number) => Math.max(max, 4)]} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0b1220',
                        border: '1px solid rgba(148,163,184,0.28)',
                        borderRadius: '10px',
                        color: '#e2e8f0',
                        boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
                      }}
                      formatter={(value: number, name: string) => {
                        if (name === 'volume') return [`$${formatCompact(value)}`, 'Volume'];
                        if (name === 'trades') return [formatCompact(value), 'Trades'];
                        return [formatCompact(value), name];
                      }}
                      labelStyle={{ color: '#94a3b8' }}
                    />
                    <ReferenceLine
                      yAxisId="volume"
                      y={aggregate.avgDailyVolume}
                      stroke="rgba(148,163,184,0.4)"
                      strokeDasharray="4 4"
                    />
                    <Bar yAxisId="trades" dataKey="trades" barSize={16} radius={[4, 4, 0, 0]} name="trades">
                      {aggregate.chartData.map((entry, index) => (
                        <Cell key={`trade-cell-${index}`} fill={entry.trades > 0 ? 'rgba(96,165,250,0.48)' : 'rgba(71,85,105,0.38)'} />
                      ))}
                    </Bar>
                    <Area
                      yAxisId="volume"
                      type="monotone"
                      dataKey="volume"
                      stroke="#34d399"
                      strokeWidth={2.4}
                      fill="url(#volumeFill)"
                      name="volume"
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
              <div className="card p-4 md:p-5 xl:col-span-2">
                <h2 className="section-header mb-4">Market Status Distribution</h2>
                <div className="space-y-3">
                  {statusData.map((item) => (
                    <div key={item.label} className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-sm font-medium text-white">{item.label}</p>
                        <p className="text-xs text-white/60">
                          {item.value} markets - <span className="font-semibold text-white">{item.pct.toFixed(1)}%</span>
                        </p>
                      </div>
                      <div className="h-2 rounded-full bg-black/25 overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${Math.max(item.pct, 1)}%`, backgroundColor: item.color }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <div className="card p-4 md:p-5">
                  <h2 className="section-header mb-3">Momentum</h2>
                  <MetricRow label="7D Volume" value={formatCompact(aggregate.weeklyVolume)} suffix="USDC" />
                  <MetricRow label="Peak Daily Volume" value={formatCompact(aggregate.maxDailyVolume)} suffix="USDC" />
                  <MetricRow label="Peak Daily Trades" value={formatCompact(aggregate.maxTrades)} />
                </div>

                <div className="card p-4 md:p-5">
                  <h2 className="section-header mb-3">Protocol Health</h2>
                  <MetricRow
                    label="Resolution Rate"
                    value={stats.totalMarkets > 0 ? ((stats.resolvedMarkets / stats.totalMarkets) * 100).toFixed(1) : '0'}
                    suffix="%"
                  />
                  <MetricRow
                    label="Active Ratio"
                    value={stats.totalMarkets > 0 ? ((stats.activeMarkets / stats.totalMarkets) * 100).toFixed(1) : '0'}
                    suffix="%"
                  />
                  <MetricRow label="Total Traders" value={formatCompact(stats.totalParticipants)} />
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
}: {
  label: string;
  value: string;
  suffix?: string;
  icon: React.ReactNode;
  accent: 'neutral' | 'accent' | 'success' | 'info';
}) {
  const accentClass = {
    neutral: 'bg-white/[0.02] border-white/[0.08]',
    accent: 'bg-primary-500/[0.08] border-primary-500/30',
    success: 'bg-emerald-500/[0.08] border-emerald-500/30',
    info: 'bg-blue-500/[0.08] border-blue-500/30',
  };

  return (
    <div className={`card p-3 md:p-4 border ${accentClass[accent]}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="w-7 h-7 rounded-lg bg-black/20 border border-white/[0.08] flex items-center justify-center shrink-0">
          {icon}
        </span>
        <span className="text-2xs font-semibold text-white/55 uppercase tracking-[0.12em]">{label}</span>
      </div>
      <div className="flex items-end gap-1">
        <span className="text-lg md:text-2xl font-bold tabular-nums text-white">{value}</span>
        {suffix ? <span className="text-2xs text-white/45 pb-1">{suffix}</span> : null}
      </div>
    </div>
  );
}

function MetricRow({ label, value, suffix }: { label: string; value: string; suffix?: string }) {
  return (
    <div className="flex items-center justify-between gap-2 py-2 border-b border-white/[0.06] last:border-0">
      <span className="text-xs text-dark-400">{label}</span>
      <span className="text-sm font-semibold text-white tabular-nums">
        {value}{suffix ? <span className="text-2xs text-white/45 ml-1">{suffix}</span> : null}
      </span>
    </div>
  );
}

function MiniGridIcon() {
  return (
    <svg className="w-4 h-4 text-white/75" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4h7v7H4V4zM13 4h7v7h-7V4zM4 13h7v7H4v-7zM13 13h7v7h-7v-7z" />
    </svg>
  );
}

function MiniTradeIcon() {
  return (
    <svg className="w-4 h-4 text-emerald-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h10M7 12h6m-6 5h10" />
    </svg>
  );
}

function MiniTrendIcon() {
  return (
    <svg className="w-4 h-4 text-blue-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 17l6-6 4 4 8-8" />
    </svg>
  );
}
