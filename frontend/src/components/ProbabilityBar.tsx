import { probToPercent } from '../utils/format';

const OUTCOME_COLORS = [
  { bg: 'bg-green-500', text: 'text-green-400', light: 'bg-green-500/20' },
  { bg: 'bg-red-500', text: 'text-red-400', light: 'bg-red-500/20' },
  { bg: 'bg-blue-500', text: 'text-blue-400', light: 'bg-blue-500/20' },
  { bg: 'bg-purple-500', text: 'text-purple-400', light: 'bg-purple-500/20' },
  { bg: 'bg-orange-500', text: 'text-orange-400', light: 'bg-orange-500/20' },
  { bg: 'bg-cyan-500', text: 'text-cyan-400', light: 'bg-cyan-500/20' },
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
  return (
    <div className="space-y-2">
      {labels.map((label, i) => {
        const pct = probToPercent(probabilities[i]);
        const color = getOutcomeColor(i);
        const isWinner = isResolved && winningOutcome === i;

        return (
          <div key={i} className={compact ? '' : 'space-y-1'}>
            <div className="flex justify-between items-center text-sm">
              <span className={`font-medium ${isWinner ? 'text-green-400' : 'text-dark-200'}`}>
                {isWinner && (
                  <svg className="w-3.5 h-3.5 inline mr-1 -mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
                {label}
              </span>
              <span className={`font-mono font-semibold ${color.text}`}>{pct.toFixed(1)}%</span>
            </div>
            {!compact && (
              <div className="h-2 bg-dark-700/50 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${color.bg}`}
                  style={{ width: `${Math.max(pct, 1)}%` }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
