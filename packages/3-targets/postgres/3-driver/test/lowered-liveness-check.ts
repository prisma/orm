import { setTimeout as sleep } from 'node:timers/promises';
import { timeouts } from '@repo/test-utils';
import { afterEach, beforeEach } from 'vitest';
import { livenessCheckSettings } from '../src/liveness-check';

const IDLE_THRESHOLD_MILLIS = 30;

const shipped = { ...livenessCheckSettings };

/** The lowered limit on a liveness check. It scales with `TEST_TIMEOUT_MULTIPLIER`, so a healthy check on a slow runner is not evicted. */
function checkLimitMillis(): number {
  return timeouts.default * 3;
}

/** Lowers the liveness check's threshold and time limit for each test in the enclosing scope, and restores them after it. */
export function useLoweredLivenessCheck(): void {
  beforeEach(() => {
    Object.assign(livenessCheckSettings, {
      checkAfterIdleMillis: IDLE_THRESHOLD_MILLIS,
      timeoutMillis: checkLimitMillis(),
    });
  });
  afterEach(() => {
    Object.assign(livenessCheckSettings, shipped);
  });
}

/** Restores the threshold the driver ships with, for a test about a client used within it. */
export function useShippedIdleThreshold(): void {
  livenessCheckSettings.checkAfterIdleMillis = shipped.checkAfterIdleMillis;
}

export function idleBeyondThreshold(): Promise<void> {
  return sleep(IDLE_THRESHOLD_MILLIS * 2);
}
