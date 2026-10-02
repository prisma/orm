import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import { describe, expect, it } from 'vitest';
import { setDefault } from '../../src/core/migrations/operations/columns';

function stubLowerer(): ExecuteRequestLowerer {
  return {
    lower: () => Object.freeze({ sql: 'UNUSED', params: Object.freeze([]) }),
    lowerToExecuteRequest: async () => Object.freeze({ sql: 'UNUSED', params: Object.freeze([]) }),
  };
}

describe('setDefault idempotency probing', () => {
  it('opts a widening setDefault out of the runner idempotency probe', async () => {
    const op = await setDefault(
      'public',
      'instruments',
      'is_active',
      'DEFAULT false',
      stubLowerer(),
      'widening',
    );
    expect(op.skipIdempotencyProbe).toBe(true);
  });

  it('keeps the idempotency probe for an additive setDefault', async () => {
    const op = await setDefault(
      'public',
      'instruments',
      'is_active',
      'DEFAULT false',
      stubLowerer(),
    );
    expect(op.skipIdempotencyProbe ?? false).toBe(false);
  });
});
