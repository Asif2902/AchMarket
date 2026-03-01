import { Link } from 'react-router-dom';
import ImageWithFallback from './ImageWithFallback';
import ProbabilityBar from './ProbabilityBar';
import Countdown from './Countdown';
import { formatUSDC } from '../utils/format';
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
    <Link to={`/market/${data.market}`} className="block">
      <div className="card-hover overflow-hidden group">
        {/* Image */}
        <div className="relative">
          <ImageWithFallback
            src={data.imageUri}
            alt={data.title}
            className="h-40 w-full"
          />
          <div className="absolute top-3 left-3">
            <span className={`badge ${STAGE_COLORS[data.stage]}`}>
              {STAGE_LABELS[data.stage]}
            </span>
          </div>
          <div className="absolute top-3 right-3">
            <span className="badge bg-dark-900/80 text-dark-200 border-dark-700/50 backdrop-blur-sm">
              {data.category}
            </span>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 space-y-3">
          <h3 className="font-semibold text-white text-sm leading-tight line-clamp-2 group-hover:text-primary-400 transition-colors">
            {data.title}
          </h3>

          {/* Probability bars */}
          <ProbabilityBar
            labels={data.outcomeLabels}
            probabilities={data.impliedProbabilitiesWad}
            winningOutcome={data.winningOutcome}
            isResolved={isResolved}
            compact
          />

          {/* Footer stats */}
          <div className="flex items-center justify-between pt-2 border-t border-dark-700/30">
            <div className="flex items-center gap-3 text-xs text-dark-400">
              <span className="flex items-center gap-1">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {formatUSDC(data.totalVolumeWei)} USDC
              </span>
              <span className="flex items-center gap-1">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                {data.participants}
              </span>
            </div>

            {isActive && (
              <Countdown deadline={data.marketDeadline} compact className="text-xs text-dark-300" />
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
