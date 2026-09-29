import type { MutationDefaultGeneratorDescriptor } from '@internal/framework-components/control';
import { requireTemporal } from './require-temporal';

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
  return requireTemporal({ generatorId: INSTANT_NOW_GENERATOR_ID }).Now.instant();
}
