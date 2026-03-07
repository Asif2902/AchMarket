import { Link } from 'react-router-dom';
import ImageWithFallback from './ImageWithFallback';
import ProbabilityBar from './ProbabilityBar';
import Countdown from './Countdown';
import UsdcIcon from './UsdcIcon';
import { formatCompactUSDC, makeMarketSlug, probToPercent } from '../utils/format';
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
}

interface Props {
  data: MarketSummaryData;
}

export default function MarketCard({ data }: Props) {
  const isActive = data.stage === STAGE.Active;
  const isResolved = data.stage === STAGE.Resolved;
  const isCancelled = data.stage === STAGE.Cancelled || data.stage === STAGE.Expired;

  const leadingIdx = data.impliedProbabilitiesWad.length > 0
    ? data.impliedProbabilitiesWad.reduce((best, p, i) => p > data.impliedProbabilitiesWad[best] ? i : best, 0)
    : 0;
  const leadingPct = probToPercent(data.impliedProbabilitiesWad[leadingIdx]);
  const leadingColor = getOutcomeColor(leadingIdx);

  return (
    <Link to={`/market/${makeMarketSlug(data.marketId, data.title)}`} className="block group">
      <div className={`card-hover overflow-hidden h-full flex flex-col transition-all duration-300 ${
        isResolved ? 'ring-2 ring-emerald-500/30' : isCancelled ? 'ring-2 ring-red-500/20' : ''
      }`}>
        <div className="relative overflow-hidden">
          <ImageWithFallback
            src={data.imageUri}
            alt={data.title}
            className={`h-36 sm:h-40 w-full transition-all duration-500 group-hover:scale-105 ${
              isCancelled ? 'grayscale-[0.5] opacity-70' : ''
            }`}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-dark-900/80 via-dark-900/20 to-transparent" />

          <div className="absolute top-2.5 left-2.5">
            <span className={`badge ${STAGE_COLORS[data.stage]} backdrop-blur-sm text-2xs`}>
              {STAGE_LABELS[data.stage]}
            </span>
          </div>
          <div className="absolute top-2.5 right-2.5">
            <span className="badge bg-dark-900/70 text-dark-200 border-white/[0.1] backdrop-blur-sm text-2xs">
              {data.category}
            </span>
          </div>

          <div className="absolute bottom-2.5 left-2.5 right-2.5 flex items-center justify-between">
            <span className="text-2xs font-medium text-white/90 backdrop-blur-sm bg-dark-900/60 px-2 py-0.5 rounded-md flex items-center gap-1">
              <UsdcIcon size={12} />
              {formatCompactUSDC(data.totalVolumeWei)} USDC
            </span>
            {isActive && (
              <Countdown deadline={data.marketDeadline} compact className="text-2xs font-medium text-white/90 backdrop-blur-sm bg-dark-900/60 px-2 py-0.5 rounded-md" />
            )}
          </div>
        </div>

        <div className="p-4 flex-1 flex flex-col gap-3">
          <h3 className={`font-semibold text-sm leading-snug line-clamp-2 transition-colors duration-200 ${
            isResolved ? 'text-emerald-400' : isCancelled ? 'text-red-400/80' : 'text-white group-hover:text-primary-400'
          }`}>
            {data.title}
          </h3>

          <div className="flex-1">
            <ProbabilityBar
              labels={data.outcomeLabels}
              probabilities={data.impliedProbabilitiesWad}
              winningOutcome={data.winningOutcome}
              isResolved={isResolved}
              compact
            />
          </div>

          <div className="pt-2 border-t border-white/[0.06] space-y-2">
            <div className="progress-thin">
              <div
                className={`progress-thin-fill bg-gradient-to-r ${leadingColor.gradient}`}
                style={{ width: `${Math.max(leadingPct, 2)}%` }}
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-2xs text-dark-500">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span>{data.participants} traders</span>
              </div>
              <span className="text-2xs text-dark-500 font-medium group-hover:text-primary-400 transition-colors flex items-center gap-0.5">
                Trade
                <svg className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </span>
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}
