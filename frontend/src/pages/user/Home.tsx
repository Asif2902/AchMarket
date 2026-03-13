import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ethers } from 'ethers';
import { useWallet } from '../../context/WalletContext';
import { FACTORY_ADDRESS, LENS_ADDRESS, STAGE, STAGE_LABELS, STAGE_COLORS } from '../../config/network';
import { FACTORY_ABI, LENS_ABI, MARKET_ABI } from '../../config/abis';
import MarketCard, { MarketSummaryData } from '../../components/MarketCard';
import { SkeletonCard } from '../../components/LoadingSpinner';
import EmptyState from '../../components/EmptyState';
import UsdcIcon from '../../components/UsdcIcon';
import Countdown from '../../components/Countdown';
import ImageWithFallback from '../../components/ImageWithFallback';
import { formatCompactUSDC, STABILITY_FILTERS, getStabilityLevel, parseDescription, makeMarketSlug, titleCase } from '../../utils/format';

const DEFAULT_CATEGORIES = ['All', 'Crypto', 'Sports', 'Politics', 'Entertainment', 'Science', 'Other'];

function getCategories(markets: MarketSummaryData[]): string[] {
  const customCats = new Set<string>();
  for (const m of markets) {
    const cat = m.category.trim();
    const catLower = cat.toLowerCase();
    const isDefault = DEFAULT_CATEGORIES.some(dc => dc.toLowerCase() === catLower);
    if (!isDefault && cat) {
      customCats.add(cat);
    }
  }
  const sortedCustom = Array.from(customCats).sort();
  return [...DEFAULT_CATEGORIES, ...sortedCustom];
}
const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest First' },
  { value: 'ending', label: 'Ending Soon' },
  { value: 'volume', label: 'Highest Volume' },
  { value: 'participants', label: 'Most Participants' },
];
const STAGE_FILTERS = [
  { value: -1, label: 'All' },
  { value: 0, label: 'Active' },
  { value: 1, label: 'Suspended' },
  { value: 2, label: 'Resolved' },
  { value: 3, label: 'Cancelled' },
  { value: 4, label: 'Expired' },
];
const PAGE_SIZE = 12;

export default function Home() {
  const { readProvider } = useWallet();
  const [markets, setMarkets] = useState<MarketSummaryData[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [subcategoryFilter, setSubcategoryFilter] = useState<string>('All');
  const [descriptionByMarket, setDescriptionByMarket] = useState<Record<string, string>>({});
  const fetchedMarketsRef = useRef<Set<string>>(new Set());
  const [stageFilter, setStageFilter] = useState(0);
  const [stabilityFilter, setStabilityFilter] = useState('all');
  const [sortBy, setSortBy] = useState('newest');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(0);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [filtersOpen, setFiltersOpen] = useState(false);

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
        bWad: s.bWad as bigint,
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

  const filteredNoSubcategory = markets
    .filter((m) => {
      if (categoryFilter !== 'All' && m.category.toLowerCase() !== categoryFilter.toLowerCase()) return false;
      if (stageFilter !== -1 && m.stage !== stageFilter) return false;
      if (searchQuery && !m.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      if (stabilityFilter !== 'all') {
        const sf = STABILITY_FILTERS.find(f => f.value === stabilityFilter);
        if (sf && sf.min !== undefined && sf.max !== undefined) {
          const bValue = Number(ethers.formatEther(m.bWad));
          if (bValue < sf.min || bValue > sf.max) return false;
        }
      }
      return true;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'newest': return b.marketId - a.marketId;
        case 'ending':
          if (a.stage !== STAGE.Active && a.stage !== STAGE.Suspended && (b.stage === STAGE.Active || b.stage === STAGE.Suspended)) return 1;
          if ((a.stage === STAGE.Active || a.stage === STAGE.Suspended) && b.stage !== STAGE.Active && b.stage !== STAGE.Suspended) return -1;
          return a.marketDeadline - b.marketDeadline;
        case 'volume': return Number(b.totalVolumeWei - a.totalVolumeWei);
        case 'participants': return b.participants - a.participants;
        default: return 0;
      }
    });

  const filtered = filteredNoSubcategory.filter((m) => {
    if (subcategoryFilter === 'All') return true;
    const raw = descriptionByMarket[m.market];
    if (raw === undefined) return false;
    const parsed = parseDescription(raw);
    const sub = (parsed.subcategory ?? '__uncategorized__').trim().toLowerCase();
    return sub === subcategoryFilter.trim().toLowerCase();
  });

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const subcategoryCounts = (() => {
    if (categoryFilter === 'All') return [];
    const counts = new Map<string, number>();
    for (const m of filteredNoSubcategory) {
      if (m.category.toLowerCase() !== categoryFilter.toLowerCase()) continue;
      const raw = descriptionByMarket[m.market];
      if (raw === undefined) continue;
      const parsed = parseDescription(raw);
      const sub = (parsed.subcategory ?? '__uncategorized__').trim().toLowerCase();
      counts.set(sub, (counts.get(sub) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([key, count]) => ({ key, count }));
  })();

  const activeCount = markets.filter(m => m.stage === STAGE.Active).length;
  const totalVolume = markets.reduce((acc, m) => acc + m.totalVolumeWei, 0n);

  useEffect(() => {
    // Reset subcategory whenever the top-level category changes
    setSubcategoryFilter('All');
    setPage(0);
  }, [categoryFilter]);

  useEffect(() => {
    const BATCH_SIZE = 5;
    const run = async () => {
      if (categoryFilter === 'All') return;
      const targets = markets.filter(m => m.category.toLowerCase() === categoryFilter.toLowerCase());
      const missing = targets.filter(m => !fetchedMarketsRef.current.has(m.market));
      if (missing.length === 0) return;

      try {
        for (let i = 0; i < missing.length; i += BATCH_SIZE) {
          const batch = missing.slice(i, i + BATCH_SIZE);
          const entries = await Promise.all(batch.map(async (m) => {
            try {
              const mc = new ethers.Contract(m.market, MARKET_ABI, readProvider);
              const desc = await mc.description();
              fetchedMarketsRef.current.add(m.market);
              return [m.market, desc as string] as const;
            } catch (err) {
              console.error(`Failed to fetch description for ${m.market}:`, err);
              return null;
            }
          }));
          const validEntries = entries.filter((e): e is [string, string] => e !== null);
          setDescriptionByMarket(prev => {
            const next = { ...prev };
            for (const [addr, desc] of validEntries) next[addr] = desc;
            return next;
          });
        }
      } catch (err) {
        console.error('Failed to fetch market descriptions:', err);
      }
    };
    run();
  }, [categoryFilter, markets, readProvider]);

  return (
    <div className="min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-4">
        <div className="relative">
          <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="select-field text-sm w-40"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <select
              value={stageFilter}
              onChange={(e) => { setStageFilter(Number(e.target.value)); setPage(0); }}
              className="select-field text-sm w-32"
            >
              {STAGE_FILTERS.map((sf) => (
                <option key={sf.value} value={sf.value}>{sf.label}</option>
              ))}
            </select>

            <button
              onClick={() => setFiltersOpen(true)}
              className="inline-flex items-center gap-1.5 text-sm px-4 py-3 rounded-lg border bg-[var(--bg-card)] text-white/80 hover:text-white hover:border-white/20 transition-all duration-150"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h18M4 9h16M6 14h12M9 19h6" />
              </svg>
              Filters
            </button>
          </div>

          <div className="view-toggle">
            <button
              onClick={() => setViewMode('grid')}
              className={viewMode === 'grid' ? 'active' : ''}
              aria-label="Grid view"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />
              </svg>
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={viewMode === 'list' ? 'active' : ''}
              aria-label="List view"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h10" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1 -mx-4 px-4 sm:mx-0 sm:px-0">
          {getCategories(markets).map((cat) => (
            <button
              key={cat}
              onClick={() => { setCategoryFilter(cat); setPage(0); }}
              className={`chip whitespace-nowrap shrink-0 ${categoryFilter === cat ? 'chip-active' : ''}`}
            >
              {cat}
            </button>
          ))}
        </div>

        {categoryFilter !== 'All' && subcategoryCounts.length > 0 && (
          <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1 -mx-4 px-4 sm:mx-0 sm:px-0 animate-fade-in">
            <button
              onClick={() => { setSubcategoryFilter('All'); setPage(0); }}
              className={`chip-sm whitespace-nowrap shrink-0 ${subcategoryFilter === 'All' ? 'chip-sm-active' : ''}`}
            >
              All
            </button>
            {subcategoryCounts.map(({ key, count }) => {
              const isUncategorized = key === '__uncategorized__';
              const label = isUncategorized ? 'Uncategorized' : titleCase(key);
              return (
                <button
                  key={key}
                  onClick={() => { setSubcategoryFilter(key); setPage(0); }}
                  className={`chip-sm whitespace-nowrap shrink-0 ${subcategoryFilter === key ? 'chip-sm-active' : ''}`}
                  title={isUncategorized ? 'No subcategory' : label}
                >
                  {label}
                  <span className="ml-1.5 text-[10px] opacity-60">{count}</span>
                </button>
              );
            })}
          </div>
        )}

        {!loading && (
          <div className="flex items-center justify-between">
            <p className="text-xs text-white/50 font-medium">
              {filtered.length} market{filtered.length !== 1 ? 's' : ''} found
            </p>
            {(searchQuery || categoryFilter !== 'All' || stageFilter !== 0 || stabilityFilter !== 'all') && (
              <button
                onClick={() => { setSearchQuery(''); setCategoryFilter('All'); setStageFilter(0); setStabilityFilter('all'); setPage(0); }}
                className="text-xs text-[#00d46a] hover:text-[#00d46a] font-medium transition-colors"
              >
                Clear filters
              </button>
            )}
          </div>
        )}

        {loading ? (
          <div className={viewMode === 'grid' ? 'grid grid-cols-1 sm:grid-cols-2 gap-4' : 'space-y-3'}>
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : paginated.length === 0 ? (
          <EmptyState
            title="No markets found"
            description={searchQuery || categoryFilter !== 'All' || stageFilter !== 0 || stabilityFilter !== 'all'
              ? "Try adjusting your filters or search query."
              : "No prediction markets have been created yet. Check back soon!"}
          />
        ) : (
          <>
            {viewMode === 'grid' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {paginated.map((market, i) => (
                  <div
                    key={market.market}
                    className="animate-fade-in-up"
                    style={{ animationDelay: `${i * 60}ms`, animationFillMode: 'both' }}
                  >
                    <MarketCard data={market} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {paginated.map((market, i) => (
                  <div
                    key={market.market}
                    className="animate-fade-in-up"
                    style={{ animationDelay: `${i * 60}ms`, animationFillMode: 'both' }}
                  >
                    <MarketListItem data={market} />
                  </div>
                ))}
              </div>
            )}

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
                            ? 'bg-[#00d46a] text-white font-semibold'
                            : 'text-white/50 hover:text-white hover:bg-white/[0.06]'
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

        {filtersOpen && (
          <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
            <div
              className="absolute inset-0 bg-black/60"
              onClick={() => setFiltersOpen(false)}
            />
            <div className="relative w-full sm:max-w-md bg-[var(--bg-card)] border border-[var(--bg-border)] rounded-t-2xl sm:rounded-2xl p-5 sm:p-6 z-50">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-white">Filters</h2>
                <button
                  onClick={() => setFiltersOpen(false)}
                  className="w-8 h-8 rounded-lg bg-[var(--bg-base)] border border-[var(--bg-border)] flex items-center justify-center text-white/60 hover:text-white"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
                <div>
                  <p className="text-2xs font-medium text-white/40 uppercase tracking-wider mb-2">Stability</p>
                  <div className="grid grid-cols-2 gap-2">
                    {STABILITY_FILTERS.map(sf => (
                      <button
                        key={sf.value}
                        onClick={() => { setStabilityFilter(sf.value); setPage(0); }}
                        className={`px-2.5 py-2 rounded-lg text-xs border text-left transition-all duration-150 ${
                          stabilityFilter === sf.value
                            ? 'bg-[#00d46a] border-[#00d46a] text-white font-semibold'
                            : 'bg-[var(--bg-base)] border-[var(--bg-border)] text-white/60 hover:text-white hover:border-white/20'
                        }`}
                      >
                        {sf.label}
                      </button>
                    ))}
                  </div>
                </div>

                {categoryFilter !== 'All' && subcategoryCounts.length > 0 && (
                  <div>
                    <p className="text-2xs font-medium text-white/40 uppercase tracking-wider mb-2">Subcategory</p>
                    <select
                      value={subcategoryFilter}
                      onChange={e => { setSubcategoryFilter(e.target.value); setPage(0); }}
                      className="select-field text-sm w-full"
                    >
                      <option value="All">All</option>
                      {subcategoryCounts.map(({ key }) => {
                        const isUncategorized = key === '__uncategorized__';
                        const label = isUncategorized ? 'Uncategorized' : titleCase(key);
                        return (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                )}
              </div>

              <div className="mt-5 flex items-center justify-between gap-3">
                <button
                  onClick={() => {
                    setStabilityFilter('all');
                    setSubcategoryFilter('All');
                    setPage(0);
                  }}
                  className="text-xs text-white/40 hover:text-white"
                >
                  Clear filters
                </button>
                <button
                  onClick={() => setFiltersOpen(false)}
                  className="px-5 py-2.5 rounded-lg text-sm font-semibold transition-all duration-150 bg-[#00d46a] text-white hover:opacity-90"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MarketListItem({ data }: { data: MarketSummaryData }) {
  const isActive = data.stage === STAGE.Active;
  const isSuspended = data.stage === STAGE.Suspended;
  const isTradingAllowed = isActive || isSuspended;
  const isResolved = data.stage === STAGE.Resolved;
  const isCancelled = data.stage === STAGE.Cancelled || data.stage === STAGE.Expired;

  return (
    <Link
      to={`/market/${makeMarketSlug(data.marketId, data.title)}`}
      className="block group"
    >
      <div
        className={`card overflow-hidden flex gap-4 items-stretch transition-all duration-200 ${
          isCancelled ? 'card-hover-cancelled' : 'card-hover'
        }`}
      >
        <div className="relative w-[100px] h-[90px] flex-shrink-0 overflow-hidden rounded-lg">
          <ImageWithFallback
            src={data.imageUri}
            alt={data.title}
            className={`w-full h-full object-cover transition-all duration-500 group-hover:scale-105 ${
              isCancelled ? 'grayscale-[0.5] opacity-70' : ''
            }`}
          />
          <div className="absolute top-1.5 left-1.5">
            <span className={`badge-sm ${STAGE_COLORS[data.stage]}`}>{STAGE_LABELS[data.stage]}</span>
          </div>
        </div>

        <div className="flex-1 min-w-0 flex flex-col justify-center py-1.5 pr-1">
          <div className="flex items-center gap-2 text-[10px] text-white/50 mb-1">
            <span className="px-1.5 py-0.5 rounded bg-[var(--bg-border)]">
              {data.category}
            </span>
          </div>
          <h3 className={`text-sm font-semibold line-clamp-2 transition-colors duration-200 ${
            isResolved ? 'text-[#00d46a]' : isCancelled ? 'text-red-400/80' : 'text-white group-hover:text-[#00d46a]'
          }`}>{data.title}</h3>

          <div className="mt-2 flex items-center gap-4 text-[11px] text-white/60">
            <span className="flex items-center gap-1">
              <UsdcIcon size={11} />
              <span className="font-medium">{formatCompactUSDC(data.totalVolumeWei)}</span>
            </span>
            <span className="flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className="font-medium">{data.participants}</span>
            </span>
            <span className="flex items-center gap-1">
              {isTradingAllowed ? (
                <>
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <Countdown deadline={data.marketDeadline} compact className="text-white/80" />
                </>
              ) : (
                <>
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span>Ended</span>
                </>
              )}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}
