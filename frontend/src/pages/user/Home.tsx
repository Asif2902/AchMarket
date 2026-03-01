import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { useWallet } from '../../context/WalletContext';
import { FACTORY_ADDRESS, STAGE } from '../../config/network';
import { FACTORY_ABI } from '../../config/abis';
import MarketCard, { MarketSummaryData } from '../../components/MarketCard';
import { SkeletonCard } from '../../components/LoadingSpinner';
import EmptyState from '../../components/EmptyState';
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

      // Fetch all markets for client-side filtering/sorting
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
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Stats bar */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 animate-fade-in">
          <StatCard label="Total Markets" value={stats.totalMarkets.toString()} />
          <StatCard label="Total Volume" value={`${formatUSDC(stats.totalVolumeWei)} USDC`} />
          <StatCard label="Active Markets" value={stats.activeMarkets.toString()} accent />
          <StatCard label="Participants" value={stats.totalParticipants.toString()} />
        </div>
      )}

      {/* Search and filters */}
      <div className="card p-4 space-y-4">
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Search */}
          <div className="relative flex-1">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search markets..."
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setPage(0); }}
              className="input-field pl-10"
            />
          </div>

          {/* Sort */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="select-field sm:w-48"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>

          {/* Stage filter */}
          <select
            value={stageFilter}
            onChange={(e) => { setStageFilter(Number(e.target.value)); setPage(0); }}
            className="select-field sm:w-40"
          >
            {STAGE_FILTERS.map((sf) => (
              <option key={sf.value} value={sf.value}>{sf.label}</option>
            ))}
          </select>
        </div>

        {/* Category chips */}
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => { setCategoryFilter(cat); setPage(0); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                categoryFilter === cat
                  ? 'bg-primary-600 text-white'
                  : 'bg-dark-700/50 text-dark-300 hover:bg-dark-600/50 hover:text-white'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Market grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {paginated.map((market) => (
              <div key={market.market} className="animate-fade-in">
                <MarketCard data={market} />
              </div>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-4">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="btn-secondary text-sm px-3 py-1.5"
              >
                Previous
              </button>
              <span className="text-sm text-dark-400">
                Page {page + 1} of {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="btn-secondary text-sm px-3 py-1.5"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="card p-4">
      <p className="text-xs text-dark-400 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-xl font-bold ${accent ? 'text-primary-400' : 'text-white'}`}>{value}</p>
    </div>
  );
}
