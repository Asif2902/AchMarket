import { Link } from 'react-router-dom';
import ImageWithFallback from './ImageWithFallback';
import Countdown from './Countdown';
import UsdcIcon from './UsdcIcon';
import { formatCompactUSDC, makeMarketSlug, probToPercent, getStabilityLevel } from '../utils/format';
import { STAGE, STAGE_LABELS, STAGE_COLORS } from '../config/network';

export interface MarketSummaryData {
  market: string;
  marketId: number;
  title: string;
  category: string;
  imageUri: string;
  outcomeLabels: string[];
  impliedProbabilitiesWad: bigint[];
  stage: number;
  winningOutcome: number;
  marketDeadline: number;
  totalVolumeWei: bigint;
  participants: number;
  bWad: bigint;
}

interface Props {
  data: MarketSummaryData;
}

export default function MarketCard({ data }: Props) {
  const isActive = data.stage === STAGE.Active;
  const isSuspended = data.stage === STAGE.Suspended;
  const isResolved = data.stage === STAGE.Resolved;
  const isCancelled = data.stage === STAGE.Cancelled || data.stage === STAGE.Expired;
  const isTradingAllowed = isActive || isSuspended;

  const hasOutcomes = data.impliedProbabilitiesWad.length > 0;
  const buyLabel = data.outcomeLabels[0] ?? 'Buy';
  const buyPct = hasOutcomes ? probToPercent(data.impliedProbabilitiesWad[0]) : 0;
  const clampedBuyPct = Math.max(2, Math.min(100, buyPct));
  const stability = getStabilityLevel(data.bWad);

  return (
    <Link to={`/market/${makeMarketSlug(data.marketId, data.title)}`} className="block group">
      <div className={`card-hover overflow-hidden h-full flex flex-col transition-all duration-200 ${
        isCancelled ? 'card-hover-cancelled' : ''
      }`}>
        <div className="relative overflow-hidden h-32">
          <ImageWithFallback
            src={data.imageUri}
            alt={data.title}
            className={`w-full h-full object-cover transition-all duration-500 group-hover:scale-105 ${
              isCancelled ? 'grayscale-[0.5] opacity-70' : ''
            }`}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg-card)] via-[var(--bg-card)]/30 to-transparent" />

          <div className="absolute top-2 left-2">
            <span className={`badge ${STAGE_COLORS[data.stage]} backdrop-blur-sm text-2xs`}>
              {STAGE_LABELS[data.stage]}
            </span>
          </div>
          <div className="absolute top-2 right-2">
            <span className="badge bg-[var(--bg-card)]/80 text-white/90 border-[var(--bg-border)] backdrop-blur-sm text-2xs">
              {data.category}
            </span>
            <span className={`badge mt-1.5 block ${stability.bgColor} ${stability.color} border backdrop-blur-sm text-2xs`}>
              {stability.label}
            </span>
          </div>

          <div className="absolute bottom-2.5 left-2.5 right-2.5">
            <h3 className={`font-semibold text-xs leading-snug line-clamp-2 transition-colors duration-200 ${
              isResolved ? 'text-[#00d46a]' : isCancelled ? 'text-red-400/80' : 'text-white'
            }`}>
              {data.title}
            </h3>
          </div>
        </div>

        <div className="p-3 flex flex-col gap-2.5 min-h-[96px]">
          <div className="rounded-lg border border-[var(--bg-border)] bg-dark-950/40 p-2">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] text-white/65 font-medium truncate max-w-[70%]">{buyLabel} Buy</span>
              <span className="text-[11px] font-semibold text-emerald-300 tabular-nums">{buyPct.toFixed(1)}%</span>
            </div>
            <div className="relative h-6 rounded-md bg-black/30 overflow-hidden border border-white/[0.04]">
              <div
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-emerald-500/35 via-emerald-400/25 to-emerald-300/10"
                style={{ width: `${clampedBuyPct}%` }}
              />
              <div
                className="absolute top-0 bottom-0 w-px bg-emerald-300/90 shadow-[0_0_8px_rgba(16,185,129,0.65)]"
                style={{ left: `calc(${clampedBuyPct}% - 1px)` }}
              />
              <div className="absolute inset-0 opacity-25" style={{
                backgroundImage: 'linear-gradient(to right, rgba(255,255,255,0.08) 1px, transparent 1px)',
                backgroundSize: '16px 100%',
              }} />
            </div>
          </div>

          <div className="pt-2.5 border-t border-[var(--bg-border)] flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[11px] text-white/60">
              <UsdcIcon size={11} />
              <span className="font-medium">{formatCompactUSDC(data.totalVolumeWei)}</span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-white/60">
              <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className="font-medium">{data.participants}</span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px]">
              {isTradingAllowed ? (
                <>
                  <svg className="w-2.5 h-2.5 text-white/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <Countdown deadline={data.marketDeadline} compact className="text-white/80 font-medium" />
                </>
              ) : (
                <span className="text-white/60">Ended</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}
