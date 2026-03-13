import { probToPercent } from '../utils/format';

const OUTCOME_COLORS = [
  { bg: 'bg-[#00d46a]', text: 'text-[#00d46a]', light: 'bg-[#00d46a]/15', gradient: 'from-[#00d46a] to-[#00d46a]' },
  { bg: 'bg-red-500', text: 'text-red-400', light: 'bg-red-500/15', gradient: 'from-red-500 to-red-400' },
  { bg: 'bg-blue-500', text: 'text-blue-400', light: 'bg-blue-500/15', gradient: 'from-blue-500 to-blue-400' },
  { bg: 'bg-purple-500', text: 'text-purple-400', light: 'bg-purple-500/15', gradient: 'from-purple-500 to-purple-400' },
  { bg: 'bg-orange-500', text: 'text-orange-400', light: 'bg-orange-500/15', gradient: 'from-orange-500 to-orange-400' },
  { bg: 'bg-cyan-500', text: 'text-cyan-400', light: 'bg-cyan-500/15', gradient: 'from-cyan-500 to-cyan-400' },
];

export function getOutcomeColor(index: number) {
  return OUTCOME_COLORS[index % OUTCOME_COLORS.length];
}

interface Props {
  labels: string[];
  probabilities: bigint[] | string[];
  winningOutcome?: number;
  isResolved?: boolean;
  compact?: boolean;
}

export default function ProbabilityBar({ labels, probabilities, winningOutcome, isResolved, compact }: Props) {
  if (compact) {
    return (
      <div className="space-y-2">
        {labels.map((label, i) => {
          const pct = probToPercent(probabilities[i]);
          const color = getOutcomeColor(i);
          const isWinner = isResolved && winningOutcome === i;

          return (
            <div key={i} className="flex items-center gap-2">
              <div className="flex-1 flex items-center gap-2 min-w-0">
                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${color.bg}`} />
                <span className={`text-xs truncate ${isWinner ? 'text-[#00d46a] font-semibold' : 'text-white/60'}`}>
                  {isWinner && (
                    <svg className="w-3 h-3 inline mr-0.5 -mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                  {label}
                </span>
              </div>
              <div className="w-16 h-1 rounded-full bg-[var(--bg-border)] overflow-hidden shrink-0">
                <div
                  className={`h-full rounded-full bg-gradient-to-r ${color.gradient} transition-all duration-700 ease-out`}
                  style={{ width: `${Math.max(pct, 2)}%` }}
                />
              </div>
              <span className={`text-xs font-bold tabular-nums ${color.text} w-12 text-right`}>{pct.toFixed(1)}%</span>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {labels.map((label, i) => {
        const pct = probToPercent(probabilities[i]);
        const color = getOutcomeColor(i);
        const isWinner = isResolved && winningOutcome === i;

        return (
          <div key={i} className="space-y-1">
            <div className="flex justify-between items-center">
              <span className={`text-sm font-medium ${isWinner ? 'text-[#00d46a]' : 'text-white/80'}`}>
                {isWinner && (
                  <svg className="w-4 h-4 inline mr-1 -mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
                {label}
              </span>
              <span className={`font-mono text-sm font-bold tabular-nums ${color.text}`}>{pct.toFixed(1)}%</span>
            </div>
            <div className="h-1 bg-[var(--bg-border)] rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ease-out bg-gradient-to-r ${color.gradient}`}
                style={{ width: `${Math.max(pct, 1)}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
