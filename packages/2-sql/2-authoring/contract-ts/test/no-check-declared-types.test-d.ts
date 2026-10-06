/**
 * Type-level proof that `noCheck(...)` does not change declared types
 * (slice-3 locked decision 1): an opted-out enum column still types as the
 * value union, and an opted-out list still types as a `ReadonlyArray` of
 * non-null elements. Enforcement is waived at the database only; runtime
 * values may diverge from these types — the author's accepted risk.
 */

import type { ColumnTypeDescriptor } from '@internal/framework-components/codec';
import type { FamilyPackRef, TargetPackRef } from '@internal/framework-components/components';
import type { ExtractFieldOutputTypes } from '@internal/sql-contract/types';
import { expectTypeOf, test } from 'vitest';
import { field, model } from '../src/contract-builder';
import type { SqlContractResult } from '../src/contract-types';
import { enumType, member } from '../src/enum-type';

type TextCodecTypes = {
  readonly 'pg/text@1': { readonly input: string; readonly output: string };
};

declare const typedPostgresPack: TargetPackRef<'sql', 'postgres'> & {
  readonly __codecTypes: TextCodecTypes;
};

const bareFamilyPack: FamilyPackRef<'sql'> = {
  kind: 'family',
  id: 'sql',
  familyId: 'sql',
  version: '0.0.1',
};

declare const textColumn: ColumnTypeDescriptor<'pg/text@1'>;

const Status = enumType(
  'Status',
  { codecId: 'pg/text@1' },
  member('Active', 'active'),
  member('Done', 'done'),
);

const definition = {
  family: bareFamilyPack,
  target: typedPostgresPack,
  enums: { Status },
  models: {
    Task: model('Task', {
      fields: {
        id: field.column(textColumn).id(),
        status: field.namedType(Status).noCheck(),
        statuses: field.namedType(Status).many().noCheck('membership'),
        tags: field.column(textColumn).many().noCheck('elementNotNull'),
      },
    }).sql({ table: 'tasks' }),
  },
};

type Contract = SqlContractResult<typeof definition>;
type FieldTypes = ExtractFieldOutputTypes<Contract>['public']['Task'];

test('an opted-out enum column still types as the value union', () => {
  expectTypeOf<FieldTypes['status']>().toEqualTypeOf<'active' | 'done'>();
});

test('an opted-out enum list still types as ReadonlyArray of the value union', () => {
  expectTypeOf<FieldTypes['statuses']>().toEqualTypeOf<ReadonlyArray<'active' | 'done'>>();
});

test('an opted-out plain list still types as ReadonlyArray of non-null elements', () => {
  expectTypeOf<FieldTypes['tags']>().toEqualTypeOf<ReadonlyArray<string>>();
  expectTypeOf<FieldTypes['tags'][number]>().toEqualTypeOf<
    NonNullable<FieldTypes['tags'][number]>
  >();
});
