import type { Contract } from '@internal/contract/types';
import { expectTypeOf, test } from 'vitest';
import type { IsOptionalCreateColumn, SqlStorage, StorageColumn } from '../src/exports/types';

test('a widened column is optional on create, because the contract does not prove it is required', () => {
  expectTypeOf<
    IsOptionalCreateColumn<Contract<SqlStorage>, StorageColumn, 'public', 'user', 'email'>
  >().toEqualTypeOf<true>();
});
