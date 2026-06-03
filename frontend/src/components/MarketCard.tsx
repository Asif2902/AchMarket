import { Link } from 'react-router-dom';
import { Activity, Clock3, UsersRound } from 'lucide-react';
import ImageWithFallback from './ImageWithFallback';
import Countdown from './Countdown';
import UsdcIcon from './UsdcIcon';
import { formatCompactUSDC, makeMarketSlug, probToPercent, getStabilityLevel } from '../utils/format';
import { STAGE, STAGE_LABELS, STAGE_COLORS } from '../config/network';
import { EffectiveStatus } from '../types/live';

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
  effectiveStatus?: EffectiveStatus;
}

export default function MarketCard({ data, effectiveStatus }: Props) {
  let derivedStage = data.stage;
  if (effectiveStatus) {
    switch (effectiveStatus) {
      case 'live':
      case 'upcoming':
        derivedStage = STAGE.Active;
        break;
      case 'postponed':
        derivedStage = STAGE.Suspended;
        break;
      case 'finished':
        derivedStage = STAGE.Resolved;
        break;
      case 'cancelled':
        derivedStage = STAGE.Cancelled;
        break;
    }
  }

  const isActive = derivedStage === STAGE.Active;
  const isSuspended = derivedStage === STAGE.Suspended;
  const isResolved = derivedStage === STAGE.Resolved;
  const isCancelled = derivedStage === STAGE.Cancelled || derivedStage === STAGE.Expired;
  const isTradingAllowed = isActive || isSuspended;

  const hasOutcomes = data.impliedProbabilitiesWad.length > 0;
  const topOutcomeIndex = hasOutcomes
    ? data.impliedProbabilitiesWad.reduce((best, probability, index) => (
      probability > data.impliedProbabilitiesWad[best] ? index : best
    ), 0)
    : 0;
  const rawLabel = hasOutcomes ? (data.outcomeLabels[topOutcomeIndex] ?? '') : '';
  const displayLabel = rawLabel.trim() || 'Top outcome';
  const buyPct = hasOutcomes ? probToPercent(data.impliedProbabilitiesWad[topOutcomeIndex]) : 0;
  const miniChartPoints = hasOutcomes ? buildMiniChartPoints(buyPct, data.marketId) : [];
  const miniChartPath = miniChartPoints.length > 0 ? pointsToPath(miniChartPoints) : '';
  const miniChartAreaPath = miniChartPath ? `${miniChartPath} L 100 100 L 0 100 Z` : '';
  const stability = getStabilityLevel(data.bWad);

  return (
    <Link to={`/market/${makeMarketSlug(data.marketId, data.title)}`} className="market-card-link group">
      <article className={`market-card ${
        isCancelled ? 'card-hover-cancelled' : ''
      }`}>
        <div className="market-card-media">
          <ImageWithFallback
            src={data.imageUri}
            alt={data.title}
            className={`market-card-image ${
              isCancelled ? 'grayscale-[0.5] opacity-70' : ''
            }`}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#090d14] via-[#090d14]/35 to-transparent" />

          <div className="absolute top-3 left-3 right-3 flex items-start justify-between gap-2">
            <span className={`market-chip market-chip-strong ${STAGE_COLORS[derivedStage]}`}>
              {STAGE_LABELS[derivedStage]}
            </span>
            <span className="market-chip bg-black/45 text-white/90 border-white/15">
              {data.category}
            </span>
          </div>

          <div className="absolute bottom-3 left-3 right-3">
            <h3 className={`market-card-title ${
              isResolved ? 'text-[#00d46a]' : isCancelled ? 'text-red-400/80' : 'text-white'
            }`}>
              {data.title}
            </h3>
          </div>
        </div>

        <div className="market-card-body">
          <div className="market-chip-row">
            <span className={`market-chip ${stability.bgColor} ${stability.color} border-current/20`}>
              <Activity className="h-3 w-3" aria-hidden="true" />
              {stability.label}
            </span>
            <span className="market-chip bg-white/[0.045] text-white/65 border-white/[0.08]">
              ID #{data.marketId}
            </span>
          </div>

          <section className="market-prob-panel" aria-label={`${displayLabel} probability ${buyPct.toFixed(1)} percent`}>
            <div className="market-prob-head">
              <span className="truncate">{displayLabel}</span>
              <strong>{buyPct.toFixed(1)}%</strong>
            </div>
            <div className="market-mini-chart" aria-hidden="true">
              {miniChartPath && (
                <svg viewBox="0 0 100 100" preserveAspectRatio="none">
                  <path d={miniChartAreaPath} />
                  <path d={miniChartPath} />
                </svg>
              )}
            </div>
          </section>

          <div className="market-card-stats">
            <div className="market-stat">
              <UsdcIcon size={13} />
              <span>{formatCompactUSDC(data.totalVolumeWei)}</span>
            </div>
            <div className="market-stat">
              <UsersRound className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{data.participants}</span>
            </div>
            <div className="market-stat min-w-0 justify-end">
              {isTradingAllowed ? (
                <>
                  <Clock3 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <Countdown deadline={data.marketDeadline} compact />
                </>
              ) : isResolved ? (
                <span className="text-cyan-400">Resolved</span>
              ) : (
                <span className="text-red-400">Ended</span>
              )}
            </div>
          </div>
        </div>
      </article>
    </Link>
  );
}

function buildMiniChartPoints(targetPct: number, seed: number): Array<{ x: number; y: number }> {
  const pointsCount = 14;
  const clampedTarget = Math.max(0, Math.min(100, targetPct));
  const normalizedSeed = ((seed % 41) + 41) / 41;

  return Array.from({ length: pointsCount }, (_, index) => {
    const t = index / (pointsCount - 1);
    const wave = Math.sin((t * 2.4 + normalizedSeed) * Math.PI) * 5;
    const secondaryWave = Math.cos((t * 5.6 + normalizedSeed * 0.6) * Math.PI) * 2.4;
    const startOffset = (normalizedSeed - 0.5) * 8;
    let value = clampedTarget + wave + secondaryWave + (t - 0.5) * 4 - startOffset;
    if (index === 0) value = clampedTarget - (4 - normalizedSeed * 8);
    if (index === pointsCount - 1) value = clampedTarget;

    return {
      x: t * 100,
      y: 100 - Math.max(4, Math.min(96, value)),
    };
  });
}

function pointsToPath(points: Array<{ x: number; y: number }>): string {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
}
