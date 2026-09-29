import type { MutationDefaultGeneratorDescriptor } from '@internal/framework-components/control';
import { temporalImplementation } from './temporal-implementation';

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
  return temporalImplementation({ generatorId: INSTANT_NOW_GENERATOR_ID }).Now.instant();
}
