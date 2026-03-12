import { Link } from 'react-router-dom';
import ImageWithFallback from './ImageWithFallback';
import ProbabilityBar from './ProbabilityBar';
import Countdown from './Countdown';
import UsdcIcon from './UsdcIcon';
import { formatCompactUSDC, makeMarketSlug, probToPercent, getStabilityLevel } from '../utils/format';
import { STAGE, STAGE_LABELS, STAGE_COLORS } from '../config/network';
import { getOutcomeColor } from './ProbabilityBar';

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
  const isResolved = data.stage === STAGE.Resolved;
  const isCancelled = data.stage === STAGE.Cancelled || data.stage === STAGE.Expired;

  const hasOutcomes = data.impliedProbabilitiesWad.length > 0;
  const leadingIdx = hasOutcomes
    ? data.impliedProbabilitiesWad.reduce((best, p, i) => p > data.impliedProbabilitiesWad[best] ? i : best, 0)
    : 0;
  const leadingPct = hasOutcomes ? probToPercent(data.impliedProbabilitiesWad[leadingIdx]) : 0;
  const leadingColor = getOutcomeColor(leadingIdx);
  const stability = getStabilityLevel(data.bWad);

  return (
    <Link to={`/market/${makeMarketSlug(data.marketId, data.title)}`} className="block group">
      <div className={`card-hover overflow-hidden h-full flex flex-col transition-all duration-200 ${
        isCancelled ? 'card-hover-cancelled' : ''
      }`}>
        <div className="relative overflow-hidden" style={{ height: '45%', minHeight: '140px' }}>
          <ImageWithFallback
            src={data.imageUri}
            alt={data.title}
            className={`w-full h-full object-cover transition-all duration-500 group-hover:scale-105 ${
              isCancelled ? 'grayscale-[0.5] opacity-70' : ''
            }`}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg-card)] via-[var(--bg-card)]/30 to-transparent" />

          <div className="absolute top-2.5 left-2.5">
            <span className={`badge ${STAGE_COLORS[data.stage]} backdrop-blur-sm text-2xs`}>
              {STAGE_LABELS[data.stage]}
            </span>
          </div>
          <div className="absolute top-2.5 right-2.5">
            <span className="badge bg-[var(--bg-card)]/80 text-white/90 border-[var(--bg-border)] backdrop-blur-sm text-2xs">
              {data.category}
            </span>
          </div>

          <div className="absolute bottom-3 left-3 right-3">
            <h3 className={`font-semibold text-sm leading-snug line-clamp-2 transition-colors duration-200 ${
              isResolved ? 'text-[var(--accent-green)]' : isCancelled ? 'text-[var(--accent-red)]/80' : 'text-white'
            }`}>
              {data.title}
            </h3>
          </div>
        </div>

        <div className="p-4 flex-1 flex flex-col gap-3">
          <div className="flex-1">
            <ProbabilityBar
              labels={data.outcomeLabels}
              probabilities={data.impliedProbabilitiesWad}
              winningOutcome={data.winningOutcome}
              isResolved={isResolved}
              compact
            />
          </div>

          <div className="pt-3 border-t border-[var(--bg-border)] flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs text-white/60">
              <UsdcIcon size={12} />
              <span className="font-medium">{formatCompactUSDC(data.totalVolumeWei)}</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-white/60">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className="font-medium">{data.participants}</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              {isActive ? (
                <>
                  <svg className="w-3 h-3 text-white/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
