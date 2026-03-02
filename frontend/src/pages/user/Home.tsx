import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { useWallet } from '../../context/WalletContext';
import { FACTORY_ADDRESS, STAGE } from '../../config/network';
import { FACTORY_ABI } from '../../config/abis';
import MarketCard, { MarketSummaryData } from '../../components/MarketCard';
import { SkeletonCard } from '../../components/LoadingSpinner';
import EmptyState from '../../components/EmptyState';
import UsdcIcon from '../../components/UsdcIcon';
import { formatUSDC } from '../../utils/format';

const CATEGORIES = ['All', 'Crypto', 'Sports', 'Politics', 'Entertainment', 'Science', 'Other'];
const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest First' },
  { value: 'ending', label: 'Ending Soon' },
  { value: 'volume', label: 'Highest Volume' },
  { value: 'participants', label: 'Most Participants' },
];
const STAGE_FILTERS = [
  { value: -1, label: 'All Stages' },
  { value: 0, label: 'Active' },
  { value: 1, label: 'Resolved' },
  { value: 2, label: 'Cancelled' },
  { value: 3, label: 'Expired' },
];
const PAGE_SIZE = 12;

interface GlobalStats {
  totalMarkets: number;
  totalVolumeWei: bigint;
  totalParticipants: number;
  activeMarkets: number;
  resolvedMarkets: number;
  cancelledOrExpiredMarkets: number;
}

export default function Home() {
  const { readProvider } = useWallet();
  const [markets, setMarkets] = useState<MarketSummaryData[]>([]);
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [stageFilter, setStageFilter] = useState(-1);
  const [sortBy, setSortBy] = useState('newest');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(0);

  const fetchMarkets = useCallback(async () => {
    try {
      setLoading(true);
      const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, readProvider);

      const [statsResult, totalMarkets] = await Promise.all([
        factory.getGlobalStats(),
        factory.totalMarkets(),
      ]);

      setStats({
        totalMarkets: Number(statsResult.totalMarkets),
        totalVolumeWei: statsResult.totalVolumeWei,
        totalParticipants: Number(statsResult.totalParticipants),
        activeMarkets: Number(statsResult.activeMarkets),
        resolvedMarkets: Number(statsResult.resolvedMarkets),
        cancelledOrExpiredMarkets: Number(statsResult.cancelledOrExpiredMarkets),
      });

      const total = Number(totalMarkets);
      if (total === 0) {
        setMarkets([]);
        return;
      }

      const summaries = await factory.getMarketSummaries(0, total);
      const parsed: MarketSummaryData[] = summaries.map((s: Record<string, unknown>) => ({
        market: s.market as string,
        marketId: Number(s.marketId),
        title: s.title as string,
        category: s.category as string,
        imageUri: s.imageUri as string,
        outcomeLabels: [...(s.outcomeLabels as string[])],
        impliedProbabilitiesWad: [...(s.impliedProbabilitiesWad as bigint[])],
        stage: Number(s.stage),
        winningOutcome: Number(s.winningOutcome),
        marketDeadline: Number(s.marketDeadline),
        totalVolumeWei: s.totalVolumeWei as bigint,
        participants: Number(s.participants),
      }));

      setMarkets(parsed);
    } catch (err) {
      console.error('Failed to fetch markets:', err);
    } finally {
      setLoading(false);
    }
  }, [readProvider]);

  useEffect(() => {
    fetchMarkets();
  }, [fetchMarkets]);

  // Filter and sort
  const filtered = markets
    .filter((m) => {
      if (categoryFilter !== 'All' && m.category.toLowerCase() !== categoryFilter.toLowerCase()) return false;
      if (stageFilter >= 0 && m.stage !== stageFilter) return false;
      if (searchQuery && !m.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      return true;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'newest': return b.marketId - a.marketId;
        case 'ending':
          if (a.stage !== STAGE.Active && b.stage === STAGE.Active) return 1;
          if (a.stage === STAGE.Active && b.stage !== STAGE.Active) return -1;
          return a.marketDeadline - b.marketDeadline;
        case 'volume': return Number(b.totalVolumeWei - a.totalVolumeWei);
        case 'participants': return b.participants - a.participants;
        default: return 0;
      }
    });

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="min-h-screen">
      {/* Hero Section */}
      <div className="relative overflow-hidden border-b border-white/[0.06]">
        {/* Background decorations */}
        <div className="absolute inset-0 bg-hero-gradient" />
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary-500/5 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-72 h-72 bg-accent-cyan/5 rounded-full blur-3xl" />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
          <div className="max-w-2xl">
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold text-white tracking-tight mb-3">
              Predict the Future,{' '}
              <span className="text-gradient">Trade on Events</span>
            </h1>
            <p className="text-sm sm:text-base text-dark-400 leading-relaxed max-w-lg">
              Decentralized prediction markets powered by LMSR on ARC Testnet. Trade with USDC on real-world outcomes.
            </p>
          </div>

          {/* Stats row */}
          {stats && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-8 animate-fade-in-up">
              <StatCard
                label="Total Markets"
                value={stats.totalMarkets.toString()}
                icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" /></svg>}
              />
              <StatCard
                label="Total Volume"
                value={`${formatUSDC(stats.totalVolumeWei)}`}
                suffix="USDC"
                icon={<UsdcIcon size={16} />}
                accent
              />
              <StatCard
                label="Active"
                value={stats.activeMarkets.toString()}
                icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" /></svg>}
              />
              <StatCard
                label="Traders"
                value={stats.totalParticipants.toString()}
                icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" /></svg>}
              />
            </div>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
        {/* Filter bar */}
        <div className="space-y-3">
          {/* Search + Sort + Stage */}
          <div className="flex flex-col sm:flex-row gap-2.5">
            {/* Search */}
            <div className="relative flex-1">
              <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search markets..."
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setPage(0); }}
                className="input-field pl-10 text-sm"
              />
            </div>

            {/* Sort + Stage filter */}
            <div className="flex gap-2.5">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="select-field text-sm flex-1 sm:flex-none sm:w-44"
              >
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <select
                value={stageFilter}
                onChange={(e) => { setStageFilter(Number(e.target.value)); setPage(0); }}
                className="select-field text-sm flex-1 sm:flex-none sm:w-36"
              >
                {STAGE_FILTERS.map((sf) => (
                  <option key={sf.value} value={sf.value}>{sf.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Category chips — horizontal scroll on mobile */}
          <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1 -mx-4 px-4 sm:mx-0 sm:px-0 sm:flex-wrap">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => { setCategoryFilter(cat); setPage(0); }}
                className={`chip whitespace-nowrap shrink-0 ${categoryFilter === cat ? 'chip-active' : ''}`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Results count */}
        {!loading && (
          <div className="flex items-center justify-between">
            <p className="text-xs text-dark-500 font-medium">
              {filtered.length} market{filtered.length !== 1 ? 's' : ''} found
            </p>
            {(searchQuery || categoryFilter !== 'All' || stageFilter >= 0) && (
              <button
                onClick={() => { setSearchQuery(''); setCategoryFilter('All'); setStageFilter(-1); setPage(0); }}
                className="text-xs text-primary-400 hover:text-primary-300 font-medium transition-colors"
              >
                Clear filters
              </button>
            )}
          </div>
        )}

        {/* Market grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
            {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : paginated.length === 0 ? (
          <EmptyState
            title="No markets found"
            description={searchQuery || categoryFilter !== 'All' || stageFilter >= 0
              ? "Try adjusting your filters or search query."
              : "No prediction markets have been created yet. Check back soon!"}
          />
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
              {paginated.map((market, i) => (
                <div key={market.market} className="animate-fade-in-up" style={{ animationDelay: `${i * 50}ms`, animationFillMode: 'both' }}>
                  <MarketCard data={market} />
                </div>
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 pt-6">
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="btn-secondary text-sm px-4 py-2"
                >
                  <span className="flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                    </svg>
                    Previous
                  </span>
                </button>

                <div className="flex items-center gap-1">
                  {Array.from({ length: Math.min(totalPages, 5) }).map((_, i) => {
                    let pageNum = i;
                    if (totalPages > 5) {
                      if (page < 3) pageNum = i;
                      else if (page > totalPages - 4) pageNum = totalPages - 5 + i;
                      else pageNum = page - 2 + i;
                    }
                    return (
                      <button
                        key={pageNum}
                        onClick={() => setPage(pageNum)}
                        className={`w-8 h-8 rounded-lg text-xs font-medium transition-all ${
                          page === pageNum
                            ? 'bg-primary-600 text-white shadow-glow-sm'
                            : 'text-dark-400 hover:text-white hover:bg-white/[0.06]'
                        }`}
                      >
                        {pageNum + 1}
                      </button>
                    );
                  })}
                </div>

                <button
                  onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="btn-secondary text-sm px-4 py-2"
                >
                  <span className="flex items-center gap-1.5">
                    Next
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </span>
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, suffix, icon, accent }: { label: string; value: string; suffix?: string; icon?: React.ReactNode; accent?: boolean }) {
  return (
    <div className="card p-3.5 sm:p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${accent ? 'bg-primary-500/15 text-primary-400' : 'bg-dark-750 text-dark-400'}`}>
          {icon}
        </div>
        <span className="text-2xs font-medium text-dark-500 uppercase tracking-wider">{label}</span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className={`text-lg sm:text-xl font-bold tabular-nums ${accent ? 'text-gradient' : 'text-white'}`}>{value}</span>
        {suffix && <span className="text-2xs text-dark-500 font-medium">{suffix}</span>}
      </div>
    </div>
  );
}
