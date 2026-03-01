import { useState, useEffect } from 'react';
import { getTimeRemaining } from '../utils/format';

interface Props {
  deadline: number;
  className?: string;
  compact?: boolean;
}

export default function Countdown({ deadline, className = '', compact = false }: Props) {
  const [time, setTime] = useState(getTimeRemaining(deadline));

  useEffect(() => {
    const timer = setInterval(() => {
      setTime(getTimeRemaining(deadline));
    }, 1000);
    return () => clearInterval(timer);
  }, [deadline]);

  if (time.expired) {
    return <span className={`text-amber-400 font-medium ${className}`}>Expired</span>;
  }

  if (compact) {
    if (time.days > 0) return <span className={className}>{time.days}d {time.hours}h</span>;
    if (time.hours > 0) return <span className={className}>{time.hours}h {time.minutes}m</span>;
    return <span className={`text-amber-400 ${className}`}>{time.minutes}m {time.seconds}s</span>;
  }

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {time.days > 0 && (
        <TimeUnit value={time.days} label="days" />
      )}
      <TimeUnit value={time.hours} label="hrs" />
      <span className="text-dark-600 text-base font-bold -mx-0.5">:</span>
      <TimeUnit value={time.minutes} label="min" />
      <span className="text-dark-600 text-base font-bold -mx-0.5">:</span>
      <TimeUnit value={time.seconds} label="sec" />
    </div>
  );
}

function TimeUnit({ value, label }: { value: number; label: string }) {
  return (
    <div className="text-center min-w-[2.5rem]">
      <div className="text-lg font-bold text-white tabular-nums">{String(value).padStart(2, '0')}</div>
      <div className="text-2xs text-dark-500 uppercase tracking-wider font-medium">{label}</div>
    </div>
  );
}
