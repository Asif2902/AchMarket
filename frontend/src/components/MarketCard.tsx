import { Link } from 'react-router-dom';
import ImageWithFallback from './ImageWithFallback';
import Countdown from './Countdown';
import UsdcIcon from './UsdcIcon';
import { getOutcomeColor } from './ProbabilityBar';
import { formatUSDC, makeMarketSlug, probToPercent } from '../utils/format';
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

  // Build outcome probabilities
  const outcomes = data.outcomeLabels.map((label, i) => ({
    label,
    pct: probToPercent(data.impliedProbabilitiesWad[i]),
    color: getOutcomeColor(i),
    isWinner: isResolved && data.winningOutcome === i,
  }));

  // For the mini bar chart — scale bar widths relative to max probability
  const maxPct = Math.max(...outcomes.map(o => o.pct), 1);

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
              <UsdcIcon size={12} />
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

          {/* Prediction market style outcome prices */}
          <div className="flex-1 space-y-2">
            {/* Outcome buttons — like Polymarket Yes/No pricing */}
            <div className={`grid gap-2 ${outcomes.length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {outcomes.slice(0, outcomes.length === 2 ? 2 : 3).map((o, i) => (
                <div
                  key={i}
                  className={`relative overflow-hidden rounded-lg border px-3 py-2 transition-all ${
                    o.isWinner
                      ? 'border-emerald-500/30 bg-emerald-500/10'
                      : 'border-white/[0.06] bg-dark-900/30 group-hover:border-white/[0.1]'
                  }`}
                >
                  {/* Background fill bar */}
                  <div
                    className={`absolute inset-y-0 left-0 opacity-[0.08] transition-all duration-700 bg-gradient-to-r ${o.color.gradient}`}
                    style={{ width: `${Math.max(o.pct, 2)}%` }}
                  />
                  <div className="relative flex items-center justify-between">
                    <span className={`text-xs font-medium truncate mr-2 ${
                      o.isWinner ? 'text-emerald-400' : 'text-dark-300'
                    }`}>
                      {o.isWinner && (
                        <svg className="w-3 h-3 inline mr-0.5 -mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                      {o.label}
                    </span>
                    <span className={`text-sm font-bold tabular-nums whitespace-nowrap ${o.color.text}`}>
                      {o.pct.toFixed(0)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Mini horizontal bar chart for visual comparison */}
            <div className="flex items-end gap-[3px] h-6">
              {outcomes.map((o, i) => (
                <div key={i} className="flex-1 flex flex-col justify-end h-full">
                  <div
                    className={`w-full rounded-t-sm transition-all duration-700 bg-gradient-to-t ${o.color.gradient} ${
                      o.isWinner ? 'opacity-90' : 'opacity-40 group-hover:opacity-60'
                    }`}
                    style={{ height: `${Math.max((o.pct / maxPct) * 100, 8)}%` }}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between pt-2 border-t border-white/[0.06]">
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
