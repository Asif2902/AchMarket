import { useState, useEffect } from 'react';

export function useDateTimePicker(utcInitialValue?: string) {
  const [localValue, setLocalValue] = useState<string>('');

  useEffect(() => {
    if (utcInitialValue) {
      const date = new Date(utcInitialValue);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      setLocalValue(`${year}-${month}-${day}T${hours}:${minutes}`);
    }
  }, [utcInitialValue]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalValue(e.target.value);
  };

  const getUtcValue = (): string => {
    if (!localValue) return '';
    const date = new Date(localValue);
    return date.toISOString();
  };

  const setUtcValue = (utcValue: string) => {
    if (utcValue) {
      const date = new Date(utcValue);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      setLocalValue(`${year}-${month}-${day}T${hours}:${minutes}`);
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
