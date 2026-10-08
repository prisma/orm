/**
 * Type-level proof that a `many` enum-typed field generates
 * `ReadonlyArray<EnumValueUnion>` (not a scalar enum union) in the no-emit
 * (`FieldOutputType`) path in SqlContractResult, while a non-`many` enum field
 * stays the scalar union.
 *
 * Mirrors `scalar-list-output-types.test-d.ts` but exercises the enum branch of
 * `FieldChannelType`, which short-circuits to `EnumValueUnion` and must apply
 * the same `StorageColumnManyOf` wrapping as `CodecChannelType`.
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
        status: field.namedType(Status),
        statuses: field.namedType(Status).many(),
      },
    }).sql({ table: 'tasks' }),
  },
};

type Contract = SqlContractResult<typeof definition>;
type FieldTypes = ExtractFieldOutputTypes<Contract>['public']['Task'];

test('non-many enum field stays the scalar value union', () => {
  expectTypeOf<FieldTypes['status']>().toEqualTypeOf<'active' | 'done'>();
});

test('many enum field resolves to ReadonlyArray of the value union', () => {
  expectTypeOf<FieldTypes['statuses']>().toEqualTypeOf<ReadonlyArray<'active' | 'done'>>();
});
