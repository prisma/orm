import type { MutationDefaultGeneratorDescriptor } from '@internal/framework-components/control';
import { requireTemporal } from './require-temporal';

/**
 * The "now" generator for `timestamp` (without time zone) columns: the current
 * moment as a UTC wall-clock `Temporal.PlainDateTime`, the representation
 * `pg/timestamp-temporal@1` encodes. `timestamptz` columns use `instantNow`.
 */
export const PLAIN_DATE_TIME_NOW_GENERATOR_ID = 'plainDateTimeNow' as const;

export function plainDateTimeNowControlDescriptor(): MutationDefaultGeneratorDescriptor {
  return {
    id: PLAIN_DATE_TIME_NOW_GENERATOR_ID,
    buildPhases: () => ({
      onCreate: { kind: 'generator', id: PLAIN_DATE_TIME_NOW_GENERATOR_ID },
      onUpdate: { kind: 'generator', id: PLAIN_DATE_TIME_NOW_GENERATOR_ID },
    }),
  };
}

export function plainDateTimeNow(): Temporal.PlainDateTime {
  return requireTemporal({
    generatorId: PLAIN_DATE_TIME_NOW_GENERATOR_ID,
  }).Now.plainDateTimeISO('UTC');
}
