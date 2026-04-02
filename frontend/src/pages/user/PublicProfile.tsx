import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ethers } from 'ethers';
import { useWallet } from '../../context/WalletContext';
import { FACTORY_ADDRESS, LENS_ADDRESS, STAGE, STAGE_LABELS, STAGE_COLORS } from '../../config/network';
import { FACTORY_ABI, LENS_ABI } from '../../config/abis';
import { PageLoader } from '../../components/LoadingSpinner';
import EmptyState from '../../components/EmptyState';
import ImageWithFallback from '../../components/ImageWithFallback';
import UsdcIcon from '../../components/UsdcIcon';
import { formatCompactUSDC, makeMarketSlug } from '../../utils/format';
import { fetchProfileBySlug } from '../../services/profile';
import type { PublicProfile as PublicProfileType, PortfolioStats } from '../../types/profile';

interface PositionItem {
  market: string;
  title: string;
  marketId: number;
  stage: number;
  netDepositedWei: bigint;
}

interface PublicProfileData {
  profile: PublicProfileType | null;
  stats: PortfolioStats;
  positions: PositionItem[];
}

const EMPTY_STATS: PortfolioStats = {
  totalPositions: 0,
  totalMarkets: 0,
  activePositions: 0,
  resolvedPositions: 0,
  totalDepositedWei: '0',
  activeDepositsWei: '0',
};

function isAddress(value: string | undefined): value is string {
  if (!value) return false;
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

export default function PublicProfile() {
  const { slug: routeSlug } = useParams<{ slug: string }>();
  const { readProvider } = useWallet();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PublicProfileData>({ profile: null, stats: EMPTY_STATS, positions: [] });
  const [resolvedAddress, setResolvedAddress] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!routeSlug) {
      setLoading(false);
      setError('No profile specified');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const profileResponse = await fetchProfileBySlug(routeSlug);

      if (!profileResponse.profile) {
        setError('Profile not found');
        setLoading(false);
        return;
      }

      const resolvedAddress = profileResponse.profile.address;

      const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, readProvider);
      const lens = new ethers.Contract(LENS_ADDRESS, LENS_ABI, readProvider);

      const [portfolio, totalMarkets] = await Promise.all([
        lens.getUserPortfolio(resolvedAddress),
        factory.totalMarkets(),
      ]);

      const totalMarketsNum = Number(totalMarkets);
      const summaries = totalMarketsNum > 0 ? await lens.getMarketSummaries(0, totalMarketsNum) : [];
      const addrToId = new Map<string, number>();
      for (const summary of summaries as Array<Record<string, unknown>>) {
        addrToId.set(String(summary.market).toLowerCase(), Number(summary.marketId));
      }

      const positions: PositionItem[] = (portfolio as Array<Record<string, unknown>>)
        .map((entry) => ({
          market: String(entry.market),
          title: String(entry.title),
          marketId: addrToId.get(String(entry.market).toLowerCase()) ?? 0,
          stage: Number(entry.stage),
          netDepositedWei: entry.netDepositedWei as bigint,
        }))
        .sort((a, b) => {
          if (a.netDepositedWei === b.netDepositedWei) return b.marketId - a.marketId;
          return a.netDepositedWei > b.netDepositedWei ? -1 : 1;
        });

      setData({
        profile: profileResponse.profile,
        stats: {
          ...profileResponse.stats,
          totalPositions: positions.length,
          totalMarkets: new Set(positions.map((p) => p.market.toLowerCase())).size,
          activePositions: positions.filter((p) => p.stage === STAGE.Active).length,
          resolvedPositions: positions.filter((p) => p.stage === STAGE.Resolved).length,
          totalDepositedWei: positions.reduce((acc, p) => acc + p.netDepositedWei, 0n).toString(),
          activeDepositsWei: positions
            .filter((p) => p.stage === STAGE.Active)
            .reduce((acc, p) => acc + p.netDepositedWei, 0n)
            .toString(),
        },
        positions,
      });
      setResolvedAddress(resolvedAddress);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load profile';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [readProvider, routeSlug]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) return <PageLoader />;

  if (error || !routeSlug) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <EmptyState
          title="Unable to load profile"
          description={error ?? 'No profile specified'}
          action={<Link to="/" className="btn-secondary text-sm">Back to Markets</Link>}
        />
      </div>
    );
  }

  const safeAddress = resolvedAddress ?? '';
  const displayName = data.profile?.displayName?.trim() || `${safeAddress.slice(0, 6)}...${safeAddress.slice(-4)}`;
  const avatarUrl = data.profile?.avatarUrl?.trim() || '';

  const socials = [
    { label: 'Twitter', value: data.profile?.twitterUrl || '' },
    { label: 'Discord', value: data.profile?.discordUrl || '' },
    { label: 'Telegram', value: data.profile?.telegramUrl || '' },
  ].filter((item) => item.value.trim().length > 0);

  const activeTrades = data.positions.filter((p) => p.stage === STAGE.Active).length;
  const profileSlug = data.profile?.profileSlug ?? routeSlug ?? '';
  const sharedPath = profileSlug ? `/profile/${profileSlug}` : '';

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-5 animate-fade-in">
      <div className="card p-5 sm:p-6 bg-gradient-to-br from-primary-500/[0.10] via-transparent to-emerald-500/[0.06]">
        <div className="flex flex-col md:flex-row md:items-start gap-4 md:gap-6">
          <div className="w-20 h-20 rounded-2xl border border-white/[0.12] overflow-hidden bg-dark-900">
            {avatarUrl ? (
              <ImageWithFallback src={avatarUrl} alt={displayName} className="w-full h-full" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-2xl font-semibold text-primary-300">
                {displayName.charAt(0).toUpperCase()}
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <h1 className="text-xl sm:text-2xl font-bold text-white truncate">{displayName}</h1>
            <p className="text-xs text-dark-400 mt-1 break-all">{safeAddress}</p>
            {sharedPath && <p className="text-2xs text-dark-500 mt-1">Share link: {sharedPath}</p>}

            {socials.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {socials.map((social) => (
                  <a
                    key={social.label}
                    href={social.value}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-white/[0.12] bg-white/[0.03] text-xs text-white/80 hover:text-white hover:border-white/20 transition-all"
                  >
                    {social.label}
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14 3h7m0 0v7m0-7L10 14M5 5h5M5 5v5m0-5l9 9" />
                    </svg>
                  </a>
                ))}
              </div>
            )}
          </div>

          <Link to="/portfolio" className="btn-secondary text-xs px-3 py-2 self-start">My Portfolio</Link>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <ProfileStat label="Positions" value={`${data.stats.totalPositions}`} />
        <ProfileStat label="Markets" value={`${data.stats.totalMarkets}`} />
        <ProfileStat label="Active" value={`${data.stats.activePositions}`} />
        <ProfileStat label="Resolved" value={`${data.stats.resolvedPositions}`} />
        <ProfileStat label="Total Volume" value={formatCompactUSDC(BigInt(data.stats.totalDepositedWei))} suffix="USDC" />
        <ProfileStat label="Active Volume" value={formatCompactUSDC(BigInt(data.stats.activeDepositsWei))} suffix="USDC" />
      </div>

      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-white">Recent Traded Markets</h2>
          <span className="text-2xs text-dark-500">{activeTrades} active</span>
        </div>

        {data.positions.length === 0 ? (
          <EmptyState title="No public trades" description="This user has no visible market activity yet." />
        ) : (
          <div className="space-y-2">
            {data.positions.slice(0, 20).map((item) => (
              <Link
                key={item.market}
                to={`/market/${makeMarketSlug(item.marketId, item.title)}`}
                className="flex items-center justify-between gap-3 p-3 rounded-xl border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05] transition-all"
              >
                <div className="min-w-0">
                  <p className="text-sm text-white font-medium truncate">{item.title}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <p className="text-2xs text-dark-500">Market #{item.marketId}</p>
                    <span className={`badge text-2xs ${STAGE_COLORS[item.stage]}`}>
                      {STAGE_LABELS[item.stage]}
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs text-white/80 font-semibold inline-flex items-center gap-1.5">
                    <UsdcIcon size={11} />
                    {formatCompactUSDC(item.netDepositedWei)}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ProfileStat({ label, value, suffix }: { label: string; value: string; suffix?: string }) {
  return (
    <div className="card p-3.5 border border-white/[0.09] bg-white/[0.02]">
      <p className="text-2xs uppercase tracking-[0.12em] text-white/45 font-semibold">{label}</p>
      <p className="text-lg font-bold text-white mt-1 tabular-nums">
        {value}
        {suffix ? <span className="text-2xs font-medium text-white/45 ml-1">{suffix}</span> : null}
      </p>
    </div>
  );
}
