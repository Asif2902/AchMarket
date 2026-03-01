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
    return <span className={`text-yellow-400 ${className}`}>Expired</span>;
  }

  if (compact) {
    if (time.days > 0) return <span className={className}>{time.days}d {time.hours}h</span>;
    if (time.hours > 0) return <span className={className}>{time.hours}h {time.minutes}m</span>;
    return <span className={`text-yellow-400 ${className}`}>{time.minutes}m {time.seconds}s</span>;
  }

  return (
    <div className={`flex gap-2 ${className}`}>
      {time.days > 0 && (
        <div className="text-center">
          <div className="text-lg font-bold text-white">{time.days}</div>
          <div className="text-[10px] text-dark-400 uppercase tracking-wider">days</div>
        </div>
      )}
      <div className="text-center">
        <div className="text-lg font-bold text-white">{String(time.hours).padStart(2, '0')}</div>
        <div className="text-[10px] text-dark-400 uppercase tracking-wider">hrs</div>
      </div>
      <div className="text-dark-500 text-lg font-bold">:</div>
      <div className="text-center">
        <div className="text-lg font-bold text-white">{String(time.minutes).padStart(2, '0')}</div>
        <div className="text-[10px] text-dark-400 uppercase tracking-wider">min</div>
      </div>
      <div className="text-dark-500 text-lg font-bold">:</div>
      <div className="text-center">
        <div className="text-lg font-bold text-white">{String(time.seconds).padStart(2, '0')}</div>
        <div className="text-[10px] text-dark-400 uppercase tracking-wider">sec</div>
      </div>
    </div>
  );
}
