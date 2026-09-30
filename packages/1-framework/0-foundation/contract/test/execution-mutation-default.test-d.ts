import { expectTypeOf, test } from 'vitest';
import type { ExecutionMutationDefault } from '../src/types';

test('an execution mutation default names its storage entry and field', () => {
  expectTypeOf<ExecutionMutationDefault['ref']>().toEqualTypeOf<{
    readonly namespace: string;
    readonly entry: string;
    readonly field: string;
  }>();
});
