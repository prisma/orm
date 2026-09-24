import type { ExecutionMutationDefaultValue } from '@internal/contract/types';
import { expectTypeOf, test } from 'vitest';
import type {
  MongoContractExecutionSection,
  MongoExecutionMutationDefault,
} from '../src/contract-types';

test('a Mongo mutation default names a model and a field', () => {
  expectTypeOf<MongoExecutionMutationDefault['ref']>().toEqualTypeOf<{
    readonly namespace: string;
    readonly model: string;
    readonly field: string;
  }>();
  expectTypeOf<MongoExecutionMutationDefault['onCreate']>().toEqualTypeOf<
    ExecutionMutationDefaultValue | undefined
  >();
});

test('the Mongo execution section lists Mongo mutation defaults', () => {
  expectTypeOf<
    MongoContractExecutionSection['mutations']['defaults'][number]
  >().toEqualTypeOf<MongoExecutionMutationDefault>();
});
