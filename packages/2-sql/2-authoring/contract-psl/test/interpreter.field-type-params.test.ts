import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { interpretPslDocumentToSqlContract } from '../src/interpreter';
import { fixtureDataTypeSupport } from './fixture-data-types';
import {
  createBuiltinLikeControlMutationDefaults,
  postgresCodecLookup,
  postgresNativeScalarTypeDescriptors,
  postgresScalarAuthoringTypes,
  postgresScalarTypeDescriptors,
  postgresTarget,
  symbolTableInputFromParseArgs,
  testEnumEntityContributions,
  testEnumPslBlockDescriptor,
} from './fixtures';

const numeric = {
  kind: 'scalar',
  codecId: 'pg/numeric@1',
  typeParams: { precision: 65, scale: 30 },
} as const;

describe('interpretPslDocumentToSqlContract type parameters on domain fields', () => {
  it('keeps type parameters on scalar list fields of a model', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `// use prisma-8
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
      sourceId: 'schema.prisma',
    });
    const result = interpretPslDocumentToSqlContract({
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
      ...document,
      controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
    });

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
      one: { nullable: false, type: numeric },
      many: { nullable: false, type: numeric, many: true },
      label: { nullable: false, type: varchar },
      tags: { nullable: false, type: varchar, many: true },
    });
  });

  it('keeps type parameters on composite type members, single and list', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `type Price {
  one  Numeric(65, 30)
  many Numeric(65, 30)[]
}

model Product {
  id    Int   @id
  price Price
}`,
      sourceId: 'schema.prisma',
    });
    const result = interpretPslDocumentToSqlContract({
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
      ...document,
      controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.domain.namespaces['public']?.valueObjects?.['Price']?.fields).toEqual({
      one: { nullable: false, type: numeric },
      many: { nullable: false, type: numeric, many: true },
    });
  });

  it('keeps the valueSet on enum list fields of a model, like the single field', () => {
    const pslBlockDescriptors = { enum: testEnumPslBlockDescriptor };
    const document = symbolTableInputFromParseArgs({
      schema: `enum Plan {
  @@type("pg/text@1")
  FREE = "FREE"
  PAID = "PAID"
}

model User {
  id    Int    @id
  plan  Plan
  plans Plan[]
}`,
      sourceId: 'schema.prisma',
      pslBlockDescriptors,
    });
    const result = interpretPslDocumentToSqlContract({
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
      ...document,
      controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const fields = result.value.domain.namespaces['public']?.models['User']?.fields;
    const plan = {
      nullable: false,
      type: { kind: 'scalar', codecId: 'pg/text@1' },
      valueSet: { plane: 'domain', entityKind: 'enum', namespaceId: 'public', entityName: 'Plan' },
    };
    expect({ plan: fields?.['plan'], plans: fields?.['plans'] }).toEqual({
      plan,
      plans: { ...plan, many: true },
    });
  });
});
