import { useState, useEffect } from 'react';
import { utcToLocal, localToUtc } from '../lib/datetime';

export function useDateTimePicker(utcInitialValue?: string) {
  const [localValue, setLocalValue] = useState<string>('');

  useEffect(() => {
    if (utcInitialValue) {
      const converted = utcToLocal(utcInitialValue);
      if (converted) {
        setLocalValue(converted);
      }
    }
  }, [utcInitialValue]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalValue(e.target.value);
  };

  const getUtcValue = (): string => {
    if (!localValue) return '';
    return localToUtc(localValue);
  };

  const setUtcValue = (utcValue: string) => {
    if (utcValue) {
      const converted = utcToLocal(utcValue);
      setLocalValue(converted);
    } else {
      setLocalValue('');
    }
  };

  return {
    value: localValue,
    onChange: handleChange,
    getUtcValue,
    setUtcValue,
    isEmpty: !localValue,
  };
}
