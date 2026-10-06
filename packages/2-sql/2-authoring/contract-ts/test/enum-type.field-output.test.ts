import type { FamilyPackRef, TargetPackRef } from '@internal/framework-components/components';
import type { ExtractFieldInputTypes, ExtractFieldOutputTypes } from '@internal/sql-contract/types';
import { describe, expectTypeOf, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { testTypeLookups } from '../../../1-core/contract/test/test-type-lookups';
import { defineContract, field, model } from '../src/contract-builder';
import { enumType, member } from '../src/enum-type';

// ---------------------------------------------------------------------------
// Minimal pack stubs (same as enum-type.authoring.test.ts)
// ---------------------------------------------------------------------------

const sqlFamilyPack = {
  kind: 'family',
  id: 'sql',
  familyId: 'sql',
  version: '0.0.1',
  authoring: {
    field: {
      text: {
        kind: 'fieldPreset',
        output: { codecId: 'pg/text@1' },
      },
    },
  },
} as const satisfies FamilyPackRef<'sql'>;

const postgresTargetPack = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
} as const satisfies TargetPackRef<'sql', 'postgres'>;

const pgText = { codecId: 'pg/text@1' as const, nativeType: 'text' } as const;
const pgInt = { codecId: 'pg/int4@1' as const, nativeType: 'int4' } as const;

// ---------------------------------------------------------------------------
// Fixture: enum + model using enumType field
// ---------------------------------------------------------------------------

const Role = enumType('Role', pgText, member('User', 'user'), member('Admin', 'admin'));
const Status = enumType(
  'Status',
  pgText,
  member('Active', 'active'),
  member('Inactive', 'inactive'),
);
const Priority = enumType('Priority', pgInt, member('Low', 1), member('High', 10));

const enumContract = defineContract({
  ...testTypeLookups,
  family: sqlFamilyPack,
  target: postgresTargetPack,
  createNamespace: createTestSqlNamespace,
  enums: { Role, Status, Priority },
  models: {
    User: model('User', {
      fields: {
        role: field.namedType(Role),
        status: field.namedType(Status).optional(),
        priority: field.namedType(Priority),
      },
    }),
  },
});

// ---------------------------------------------------------------------------
// Literal-propagation hop 1: FieldOutputTypes carries the value union
// ---------------------------------------------------------------------------

describe('FieldOutputTypes: enum field narrows to value union', () => {
  // Field-type maps are nested by namespace coordinate; this contract's models
  // lump under the target default namespace (`public`).
  type FOT = ExtractFieldOutputTypes<typeof enumContract>['public'];

  it('non-nullable enum field is the value union (not string)', () => {
    expectTypeOf<FOT['User']['role']>().toEqualTypeOf<'user' | 'admin'>();
  });

  it('non-nullable enum field is not string', () => {
    expectTypeOf<FOT['User']['role']>().not.toEqualTypeOf<string>();
  });

  it('nullable enum field is value union | null', () => {
    expectTypeOf<FOT['User']['status']>().toEqualTypeOf<'active' | 'inactive' | null>();
  });

  it('nullable enum field is not string | null', () => {
    expectTypeOf<FOT['User']['status']>().not.toEqualTypeOf<string | null>();
  });

  it('non-text (int-backed) enum field narrows to its int value union', () => {
    expectTypeOf<FOT['User']['priority']>().toEqualTypeOf<1 | 10>();
  });
});

// ---------------------------------------------------------------------------
// Literal-propagation hop 2: FieldInputTypes carries the value union for writes
// ---------------------------------------------------------------------------

describe('FieldInputTypes: enum field write input narrows to value union', () => {
  type FIT = ExtractFieldInputTypes<typeof enumContract>['public'];

  it('non-nullable enum field input is the value union', () => {
    expectTypeOf<FIT['User']['role']>().toEqualTypeOf<'user' | 'admin'>();
  });

  it('nullable enum field input is value union | null', () => {
    expectTypeOf<FIT['User']['status']>().toEqualTypeOf<'active' | 'inactive' | null>();
  });

  it('non-text (int-backed) enum field input narrows to its int value union', () => {
    expectTypeOf<FIT['User']['priority']>().toEqualTypeOf<1 | 10>();
  });
});
