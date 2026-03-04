import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { useWallet } from '../../context/WalletContext';
import { FACTORY_ADDRESS, LENS_ADDRESS, STAGE } from '../../config/network';
import { FACTORY_ABI, LENS_ABI } from '../../config/abis';
import MarketCard, { MarketSummaryData } from '../../components/MarketCard';
import { SkeletonCard } from '../../components/LoadingSpinner';
import EmptyState from '../../components/EmptyState';

const CATEGORIES = ['All', 'Crypto', 'Sports', 'Politics', 'Entertainment', 'Science', 'Other'];
const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest First' },
  { value: 'ending', label: 'Ending Soon' },
  { value: 'volume', label: 'Highest Volume' },
  { value: 'participants', label: 'Most Participants' },
];
const STAGE_FILTERS = [
  { value: -1, label: 'All' },
  { value: 0, label: 'Active' },
  { value: 1, label: 'Resolved' },
  { value: 2, label: 'Cancelled' },
];
const PAGE_SIZE = 12;

export default function Home() {
  const { readProvider } = useWallet();
  const [markets, setMarkets] = useState<MarketSummaryData[]>([]);
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
      const lens = new ethers.Contract(LENS_ADDRESS, LENS_ABI, readProvider);

      const totalMarkets = await factory.totalMarkets();
      const total = Number(totalMarkets);
      if (total === 0) {
        setMarkets([]);
        return;
      }

      const summaries = await lens.getMarketSummaries(0, total);
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

  const filtered = markets
    .filter((m) => {
      if (categoryFilter !== 'All' && m.category.toLowerCase() !== categoryFilter.toLowerCase()) return false;
      if (stageFilter === -1) {
        if (m.stage !== STAGE.Active && m.stage !== STAGE.Resolved) return false;
      } else if (m.stage !== stageFilter) {
        return false;
      }
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
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-2.5">
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
