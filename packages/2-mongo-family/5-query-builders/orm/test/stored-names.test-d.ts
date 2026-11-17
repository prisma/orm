import { expectTypeOf, test } from 'vitest';
import type { CreateInput, IncludedRow, NoIncludes } from '../src/types';
import type { Contract } from './fixtures/stored-names-contract';

test('a create may leave out the field stored as _id and a field an execution default fills by its stored name', () => {
  expectTypeOf<{ displayName: string }>().toExtend<CreateInput<Contract, 'User'>>();
  expectTypeOf<CreateInput<Contract, 'User'>>().toHaveProperty('id');
  expectTypeOf<CreateInput<Contract, 'User'>>().not.toHaveProperty('_id');
});

test('a row names the field stored as _id by its own name', () => {
  expectTypeOf<IncludedRow<Contract, 'User', NoIncludes>>().toHaveProperty('id');
  expectTypeOf<IncludedRow<Contract, 'User', NoIncludes>>().not.toHaveProperty('_id');
});
