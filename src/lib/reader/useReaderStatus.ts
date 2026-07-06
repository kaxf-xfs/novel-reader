/**
 * T7: live system status for the reader top bar — wall-clock time (ticking
 * every 30s) and battery level (initial read + live updates via expo-battery).
 */

import { useEffect, useState } from 'react';
import * as Battery from 'expo-battery';

import { formatBattery, formatClock } from './statusFormat';

export interface ReaderStatus {
  clock: string;
  battery: string;
}

export function useReaderStatus(): ReaderStatus {
  const [now, setNow] = useState(() => new Date());
  const [level, setLevel] = useState(-1);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let mounted = true;
    Battery.getBatteryLevelAsync()
      .then((l) => {
        if (mounted) setLevel(l);
      })
      .catch(() => {});
    const sub = Battery.addBatteryLevelListener(({ batteryLevel }) => setLevel(batteryLevel));
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  return { clock: formatClock(now), battery: formatBattery(level) };
}
