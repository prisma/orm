import type { Contract } from '@internal/contract/types';
import { describe, expectTypeOf, it } from 'vitest';
import type { EmitOptions } from '../src/exports';

describe('EmitOptions', () => {
  it('requires the deserializer, so contract.d.ts is always generated from the canonical JSON', () => {
    expectTypeOf<Pick<EmitOptions, 'deserializeContract'>>().toEqualTypeOf<{
      readonly deserializeContract: (json: Record<string, unknown>) => Contract;
    }>();
  });
});
