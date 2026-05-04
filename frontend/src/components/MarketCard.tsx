import { Link } from 'react-router-dom';
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
  const isActive = data.stage === STAGE.Active;
  const isSuspended = data.stage === STAGE.Suspended;
  const isResolved = data.stage === STAGE.Resolved;
  const isCancelled = data.stage === STAGE.Cancelled || data.stage === STAGE.Expired;
  const isTradingAllowed = isActive || isSuspended;

  const hasOutcomes = data.impliedProbabilitiesWad.length > 0;
  const rawLabel = hasOutcomes ? (data.outcomeLabels[0] ?? '') : '';
  const displayLabel = rawLabel.trim() || 'Buy';
  const buyPct = hasOutcomes ? probToPercent(data.impliedProbabilitiesWad[0]) : 0;
  const sparklinePoints = hasOutcomes ? buildBuySparklinePoints(buyPct, data.marketId) : [];
  const sparklinePath = sparklinePoints.length > 0 ? pointsToPath(sparklinePoints) : '';
  const sparklineAreaPath = sparklinePath ? `${sparklinePath} L 100 100 L 0 100 Z` : '';
  const lastPoint = sparklinePoints.length > 0 ? sparklinePoints[sparklinePoints.length - 1] : null;
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
            <span className={`badge backdrop-blur-sm text-2xs ${STAGE_COLORS[data.stage]}`}>
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
              <span className="text-[11px] text-white/65 font-medium truncate max-w-[70%]">{displayLabel}</span>
              <span className="text-[11px] font-semibold text-emerald-300 tabular-nums">{buyPct.toFixed(1)}%</span>
            </div>
            <div className="relative h-14 rounded-md bg-black/30 overflow-hidden border border-white/[0.04]" role="img" aria-label="Illustrative buy probability chart — not historical price data">
              {sparklinePath && lastPoint && (
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
                  <defs>
                    <linearGradient id={`buy-fill-${data.marketId}`} x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="rgba(52, 211, 153, 0.30)" />
                      <stop offset="100%" stopColor="rgba(52, 211, 153, 0.02)" />
                    </linearGradient>
                    <linearGradient id={`buy-line-${data.marketId}`} x1="0" x2="1" y1="0" y2="0">
                      <stop offset="0%" stopColor="rgba(52, 211, 153, 0.35)" />
                      <stop offset="100%" stopColor="rgba(110, 231, 183, 0.95)" />
                    </linearGradient>
                  </defs>
                  <path d={sparklineAreaPath} fill={`url(#buy-fill-${data.marketId})`} />
                  <path
                    d={sparklinePath}
                    fill="none"
                    stroke={`url(#buy-line-${data.marketId})`}
                    strokeWidth={2.4}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <circle cx={lastPoint.x} cy={lastPoint.y} r={2.4} fill="#6ee7b7" />
                </svg>
              )}
              <div className="absolute inset-0 opacity-15" style={{
                backgroundImage: 'linear-gradient(to right, rgba(255,255,255,0.08) 1px, transparent 1px)',
                backgroundSize: '16px 100%',
              }} />
              <div className="absolute left-0 right-0 top-1/2 border-t border-white/[0.07] border-dashed" />
              <div className="absolute bottom-1 left-1.5 right-1.5 flex items-center justify-between text-[10px] text-white/35 font-medium">
                <span>0%</span>
                <span>Buy Line</span>
                <span>100%</span>
              </div>
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
      </div>
    </Link>
  );
}

function buildBuySparklinePoints(targetPct: number, seed: number): Array<{ x: number; y: number }> {
  const pointsCount = 16;
  const clampedTarget = Math.max(0, Math.min(100, targetPct));
  const normalizedSeed = ((seed % 37) + 37) / 37;

  const points: Array<{ x: number; y: number }> = [];

  for (let i = 0; i < pointsCount; i += 1) {
    const t = i / (pointsCount - 1);
    const waveA = Math.sin((t * 2.9 + normalizedSeed) * Math.PI) * 4;
    const waveB = Math.cos((t * 5.2 + normalizedSeed * 0.7) * Math.PI) * 1.8;
    const drift = (t - 0.5) * 5;
    const startBias = (normalizedSeed - 0.5) * 6;

    let value = clampedTarget + waveA + waveB + drift - startBias;
    if (i === 0) value = clampedTarget - (3 - normalizedSeed * 6);
    if (i === pointsCount - 1) value = clampedTarget;

    const normalizedValue = Math.max(0, Math.min(100, value));
    points.push({ x: t * 100, y: 100 - normalizedValue });
  }

  return points;
}

function pointsToPath(points: Array<{ x: number; y: number }>): string {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
}
