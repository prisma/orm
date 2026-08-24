import type { MutationDefaultGeneratorDescriptor } from '@internal/framework-components/control';
import { errorTemporalUnavailableForDefault } from './errors';

export const INSTANT_NOW_GENERATOR_ID = 'instantNow' as const;

export function instantNowControlDescriptor(): MutationDefaultGeneratorDescriptor {
  return {
    id: INSTANT_NOW_GENERATOR_ID,
    buildPhases: () => ({
      onCreate: { kind: 'generator', id: INSTANT_NOW_GENERATOR_ID },
      onUpdate: { kind: 'generator', id: INSTANT_NOW_GENERATOR_ID },
    }),
  };
}

export function instantNow(): Temporal.Instant {
  if (typeof Temporal === 'undefined') {
    throw errorTemporalUnavailableForDefault(INSTANT_NOW_GENERATOR_ID);
  }
  return Temporal.Now.instant();
}
