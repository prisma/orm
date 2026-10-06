import type { Contract } from '@internal/contract/types';
import type { FamilyPackRef, TargetPackRef } from '@internal/framework-components/components';
import type {
  ExtractFieldInputTypes,
  ExtractFieldOutputTypes,
  SqlStorage,
} from '@internal/sql-contract/types';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { testTypeLookups } from '../../../1-core/contract/test/test-type-lookups';
import { defineContract, field, model } from '../src/contract-builder';
import { enumType, member } from '../src/enum-type';

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

const Role = enumType('Role', pgText, member('User', 'user'), member('Admin', 'admin'));
const Status = enumType(
  'Status',
  pgText,
  member('Active', 'active'),
  member('Inactive', 'inactive'),
);
const Priority = enumType('Priority', pgInt, member('Low', 1), member('High', 10));

// Factory form: enums are returned from the factory callback (the path the demo
// uses), not declared on the scaffold definition.
const factoryContract = defineContract(
  {
    ...testTypeLookups,
    family: sqlFamilyPack,
    target: postgresTargetPack,
    createNamespace: createTestSqlNamespace,
  },
  () => ({
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
  }),
);

// Definition form, identical enums + model, for parity comparison.
const definitionContract = defineContract({
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

describe('factory-form enums narrow field reads to the value union', () => {
  // Field-type maps are nested by namespace coordinate; this contract's models
  // lump under the target default namespace (`public`).
  type FOT = ExtractFieldOutputTypes<typeof factoryContract>['public'];

  it('non-nullable enum field is the value union (not string)', () => {
    expectTypeOf<FOT['User']['role']>().toEqualTypeOf<'user' | 'admin'>();
    expectTypeOf<FOT['User']['role']>().not.toEqualTypeOf<string>();
  });

  it('nullable enum field is value union | null', () => {
    expectTypeOf<FOT['User']['status']>().toEqualTypeOf<'active' | 'inactive' | null>();
  });

  it('int-backed enum field narrows to its int value union', () => {
    expectTypeOf<FOT['User']['priority']>().toEqualTypeOf<1 | 10>();
  });
});

describe('factory-form enums narrow field writes to the value union', () => {
  type FIT = ExtractFieldInputTypes<typeof factoryContract>['public'];

  it('non-nullable enum field input is the value union', () => {
    expectTypeOf<FIT['User']['role']>().toEqualTypeOf<'user' | 'admin'>();
  });
});

describe('factory-form db.enums matches the definition form', () => {
  type FactoryAccessors = typeof factoryContract extends { enumAccessors: infer A } ? A : never;
  type DefinitionAccessors = typeof definitionContract extends { enumAccessors: infer A }
    ? A
    : never;

  it('exposes the same enumAccessors shape as the definition form', () => {
    expectTypeOf<FactoryAccessors>().toEqualTypeOf<DefinitionAccessors>();
  });

  it('keeps the literal declaration-ordered value tuple', () => {
    type Values = FactoryAccessors extends { Priority: { values: infer V } } ? V : never;
    expectTypeOf<Values>().toEqualTypeOf<readonly [1, 10]>();
  });

  it('int-enum accessors accept the int value union', () => {
    type PriorityAccessor = FactoryAccessors extends { Priority: infer A } ? A : never;
    expectTypeOf<PriorityAccessor>().toHaveProperty('has');
    expectTypeOf<PriorityAccessor>().toHaveProperty('has').parameter(0).toEqualTypeOf<1 | 10>();
    expectTypeOf<PriorityAccessor>().toHaveProperty('nameOf').parameter(0).toEqualTypeOf<1 | 10>();
    expectTypeOf<PriorityAccessor>()
      .toHaveProperty('ordinalOf')
      .parameter(0)
      .toEqualTypeOf<1 | 10>();
  });
});

// A contract that authors one enum on the scaffold definition and another in
// the factory callback. The factory-form type advertises a merge of both, so
// the runtime must surface both — not overwrite the scaffold-authored one.
const mixedContract = defineContract(
  {
    ...testTypeLookups,
    family: sqlFamilyPack,
    target: postgresTargetPack,
    createNamespace: createTestSqlNamespace,
    enums: { Role },
  },
  () => ({
    enums: { Priority },
    models: {
      User: model('User', {
        fields: {
          role: field.namedType(Role),
          priority: field.namedType(Priority),
        },
      }),
    },
  }),
);

describe('factory form merges scaffold-authored and factory-authored enums', () => {
  it('surfaces both enums in the runtime contract', () => {
    const domainNs = (mixedContract as Contract<SqlStorage>).domain.namespaces['public'];
    expect(domainNs?.enum?.['Role']).toBeDefined();
    expect(domainNs?.enum?.['Priority']).toBeDefined();
  });

  it('advertises both enums in the enumAccessors type', () => {
    type MixedAccessors = typeof mixedContract extends { enumAccessors: infer A } ? A : never;
    expectTypeOf<MixedAccessors>().toHaveProperty('Role');
    expectTypeOf<MixedAccessors>().toHaveProperty('Priority');
  });
});
