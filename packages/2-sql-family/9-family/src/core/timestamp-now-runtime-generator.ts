import { TIMESTAMP_NOW_GENERATOR_ID } from '@internal/framework-components/authoring';
import type { RuntimeMutationDefaultGenerator } from '@internal/framework-components/runtime';

const DATE_FRACTION_DIGITS = 3;

function roundedDown(now: number, params: Readonly<Record<string, unknown>> | undefined): Date {
  const precision = params?.['precision'];
  if (typeof precision !== 'number' || precision >= DATE_FRACTION_DIGITS) return new Date(now);
  const step = 10 ** (DATE_FRACTION_DIGITS - Math.max(precision, 0));
  return new Date(Math.floor(now / step) * step);
}

/**
 * Builds the canonical runtime-plane generator for the wall-clock-now
 * mutation default. Returns a `Date`, rounded down to the `precision` param
 * when a target passes one; semantics are target-agnostic so all SQL targets
 * share this single implementation.
 *
 * Declares `stability: 'query'` so a single ORM bulk operation
 * (e.g. `createAll([...])`) shares one timestamp across every row and
 * every timestamp-defaulted column. Matches Prisma 6's `@updatedAt`
 * semantics: one `new Date()` per lowered mutation, not per row.
 *
 * Lives in its own module, exported only through `exports/runtime.ts`,
 * so the control plane stays free of runtime-plane imports.
 */
export function timestampNowRuntimeGenerator(): RuntimeMutationDefaultGenerator {
  return {
    id: TIMESTAMP_NOW_GENERATOR_ID,
    generate: (params) => roundedDown(Date.now(), params),
    stability: 'query',
  };
}
