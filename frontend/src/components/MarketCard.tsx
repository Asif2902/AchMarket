import { Link } from 'react-router-dom';
import ImageWithFallback from './ImageWithFallback';
import ProbabilityBar from './ProbabilityBar';
import Countdown from './Countdown';
import { formatUSDC, makeMarketSlug } from '../utils/format';
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
}

interface Props {
  data: MarketSummaryData;
}

export default function MarketCard({ data }: Props) {
  const isActive = data.stage === STAGE.Active;
  const isResolved = data.stage === STAGE.Resolved;

  return (
    <Link to={`/market/${makeMarketSlug(data.marketId, data.title)}`} className="block group">
      <div className="card-hover overflow-hidden h-full flex flex-col">
        {/* Image with gradient overlay */}
        <div className="relative overflow-hidden">
          <ImageWithFallback
            src={data.imageUri}
            alt={data.title}
            className="h-36 sm:h-40 w-full"
          />
          {/* Gradient overlay for readability */}
          <div className="absolute inset-0 bg-gradient-to-t from-dark-900/60 via-transparent to-transparent" />

          {/* Badges */}
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

          {/* Volume overlay at bottom of image */}
          <div className="absolute bottom-2.5 left-2.5 right-2.5 flex items-center justify-between">
            <span className="text-2xs font-medium text-white/80 backdrop-blur-sm bg-dark-900/50 px-2 py-0.5 rounded-md flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {formatUSDC(data.totalVolumeWei)} USDC
            </span>
            {isActive && (
              <Countdown deadline={data.marketDeadline} compact className="text-2xs font-medium text-white/80 backdrop-blur-sm bg-dark-900/50 px-2 py-0.5 rounded-md" />
            )}
          </div>
        </div>

        {/* Content */}
        <div className="p-4 flex-1 flex flex-col gap-3">
          {/* Title */}
          <h3 className="font-semibold text-white text-sm leading-snug line-clamp-2 group-hover:text-primary-400 transition-colors duration-200">
            {data.title}
          </h3>

          {/* Probability display — compact inline version for cards */}
          <div className="flex-1">
            <ProbabilityBar
              labels={data.outcomeLabels}
              probabilities={data.impliedProbabilitiesWad}
              winningOutcome={data.winningOutcome}
              isResolved={isResolved}
              compact
            />
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between pt-2 border-t border-white/[0.04]">
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
    </Link>
  );
}
