import type { AuthoringTypeNamespace } from '@internal/framework-components/authoring';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { fixtureDataTypeSupport } from './fixture-data-types';
import {
  createBuiltinLikeControlMutationDefaults,
  interpretSqlContract,
  modelsOf,
  postgresCodecLookup,
  postgresNativeScalarTypeDescriptors,
  postgresScalarAuthoringTypes,
  postgresScalarTypeDescriptors,
  postgresTarget,
  testEnumEntityContributions,
  testEnumPslBlockDescriptor,
} from './fixtures';

const numeric = {
  kind: 'scalar',
  codecId: 'pg/numeric@1',
  typeParams: { precision: 65, scale: 30 },
} as const;

const varCharishTypes = {
  ...postgresScalarAuthoringTypes,
  VarCharish: {
    kind: 'typeConstructor',
    args: [{ kind: 'number', name: 'length', integer: true, minimum: 1 }],
    output: {
      codecId: 'sql/varchar@1',
      nativeType: 'character varying',
      typeParams: { length: { kind: 'arg', index: 0 } },
    },
  },
} satisfies AuthoringTypeNamespace;

describe('interpretPslDocumentToSqlContract a list field equals the single field of its type, plus many', () => {
  it('gives a list field the type parameters of the single field, from a type constructor the stack adds', () => {
    const result = interpretSqlContract(
      'model Doc {\n  id Int @id\n  one VarCharish(12)\n  many VarCharish(12)[]\n}\n',
      {
        target: postgresTarget,
        scalarColumnDescriptors: postgresNativeScalarTypeDescriptors,
        authoringContributions: {
          type: varCharishTypes,
          dataTypes: fixtureDataTypeSupport.entries,
        },
        dataTypeLookup: fixtureDataTypeSupport.lookup,
        composedExtensionContracts: new Map(),
        createNamespace: createTestSqlNamespace,
        capabilities: { sql: { scalarList: true } },
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const fields = modelsOf(result.value)['Doc']?.fields;
    const varchar = {
      kind: 'scalar',
      codecId: 'sql/varchar@1',
      typeParams: { length: 12 },
    } as const;
    expect({ one: fields?.['one'], many: fields?.['many'] }).toEqual({
      one: { nullable: false, type: varchar, many: false },
      many: { nullable: false, type: varchar, many: { elementNullable: false } },
    });
  });

  it('keeps type parameters on scalar list fields of a model', () => {
    const result = interpretSqlContract(
      `// use prisma-8
namespace public {
  model Money {
    id    Int               @id
    one   Numeric(65, 30)
    many  Numeric(65, 30)[] @noCheck(elementNotNull)
    label VarChar(32)
    tags  VarChar(32)[]     @noCheck(elementNotNull)
  }
}
`,
      {
        target: postgresTarget,
        scalarColumnDescriptors: postgresNativeScalarTypeDescriptors,
        authoringContributions: {
          type: postgresScalarAuthoringTypes,
          dataTypes: fixtureDataTypeSupport.entries,
        },
        dataTypeLookup: fixtureDataTypeSupport.lookup,
        composedExtensionContracts: new Map(),
        createNamespace: createTestSqlNamespace,
        capabilities: { sql: { scalarList: true } },
        controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const fields = result.value.domain.namespaces['public']?.models['Money']?.fields;
    const varchar = {
      kind: 'scalar',
      codecId: 'sql/varchar@1',
      typeParams: { length: 32 },
    } as const;
    expect({
      one: fields?.['one'],
      many: fields?.['many'],
      label: fields?.['label'],
      tags: fields?.['tags'],
    }).toEqual({
      one: { nullable: false, type: numeric, many: false },
      many: { nullable: false, type: numeric, many: { elementNullable: false } },
      label: { nullable: false, type: varchar, many: false },
      tags: { nullable: false, type: varchar, many: { elementNullable: false } },
    });
  });

  it('keeps type parameters on composite type members, single and list', () => {
    const result = interpretSqlContract(
      `type Price {
  one  Numeric(65, 30)
  many Numeric(65, 30)[]
}

model Product {
  id    Int   @id
  price Price
}`,
      {
        target: postgresTarget,
        scalarColumnDescriptors: postgresScalarTypeDescriptors,
        authoringContributions: {
          type: postgresScalarAuthoringTypes,
          valueObjectStorageType: 'Jsonb',
        },
        dataTypeLookup: fixtureDataTypeSupport.lookup,
        composedExtensionContracts: new Map(),
        createNamespace: createTestSqlNamespace,
        capabilities: { sql: { scalarList: true } },
        controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.domain.namespaces['public']?.valueObjects?.['Price']?.fields).toEqual({
      one: { nullable: false, type: numeric, many: false },
      many: { nullable: false, type: numeric, many: { elementNullable: false } },
    });
  });

  it('keeps the valueSet on enum list fields of a model, like the single field', () => {
    const pslBlockDescriptors = { enum: testEnumPslBlockDescriptor };
    const result = interpretSqlContract(
      `enum Plan {
  @@type("pg/text@1")
  FREE = "FREE"
  PAID = "PAID"
}

model User {
  id    Int    @id
  plan  Plan
  plans Plan[]
}`,
      {
        target: postgresTarget,
        scalarColumnDescriptors: postgresScalarTypeDescriptors,
        authoringContributions: {
          entityTypes: testEnumEntityContributions,
          pslBlockDescriptors,
          dataTypes: fixtureDataTypeSupport.entries,
        },
        dataTypeLookup: fixtureDataTypeSupport.lookup,
        codecLookup: postgresCodecLookup,
        composedExtensionContracts: new Map(),
        createNamespace: createTestSqlNamespace,
        capabilities: { sql: { scalarList: true } },
        controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const fields = result.value.domain.namespaces['public']?.models['User']?.fields;
    const plan = {
      many: false,
      nullable: false,
      type: { kind: 'scalar', codecId: 'pg/text@1' },
      valueSet: { plane: 'domain', entityKind: 'enum', namespaceId: 'public', entityName: 'Plan' },
    };
    expect({ plan: fields?.['plan'], plans: fields?.['plans'] }).toEqual({
      plan,
      plans: { ...plan, many: { elementNullable: false } },
    });
  });
});
