import type { ContractExecutionSection } from '@internal/contract/types';
import { expectTypeOf, test } from 'vitest';
import type { MongoContract } from '../src/contract-types';

test('a Mongo contract carries the framework execution section', () => {
  expectTypeOf<MongoContract['execution']>().toEqualTypeOf<ContractExecutionSection | undefined>();
});

test('a Mongo mutation default names an entry and a field', () => {
  expectTypeOf<
    NonNullable<MongoContract['execution']>['mutations']['defaults'][number]['ref']
  >().toEqualTypeOf<{
    readonly namespace: string;
    readonly entry: string;
    readonly field: string;
  }>();
});
