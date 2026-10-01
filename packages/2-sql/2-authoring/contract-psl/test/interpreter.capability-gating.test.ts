import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { interpretPslDocumentToSqlContract } from '../src/interpreter';
import { fixtureDataTypeSupport } from './fixture-data-types';
import {
  createBuiltinLikeControlMutationDefaults,
  modelsOf,
  postgresScalarTypeDescriptors,
  postgresTarget,
  sqliteScalarColumnDescriptors,
  sqliteTarget,
  symbolTableInputFromParseArgs,
} from './fixtures';

const builtinControlMutationDefaults = createBuiltinLikeControlMutationDefaults();

const postgresCapabilities = { sql: { scalarList: true } } as const;
const sqliteCapabilities = { sql: {} } as const;

const listSchema = `model User {
  id Int @id
  tags String[]
}`;

describe('interpretPslDocumentToSqlContract scalar-list capability gating', () => {
  it('rejects a scalar list field against a target whose adapter lacks the scalarList capability', () => {
    const document = symbolTableInputFromParseArgs({
      schema: listSchema,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      target: sqliteTarget,
      scalarColumnDescriptors: sqliteScalarColumnDescriptors,
      composedExtensionContracts: new Map(),
      createNamespace: createTestSqlNamespace,
      dataTypeLookup: fixtureDataTypeSupport.lookup,
      capabilities: sqliteCapabilities,
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_SCALAR_LIST_UNSUPPORTED_TARGET',
          message:
            'Field "User.tags" is a scalar list, but target "sqlite" does not support scalar lists (the adapter does not report the "scalarList" capability). Remove the list or author it against a target that supports scalar lists.',
        }),
      ]),
    );
  });

  it('authors a scalar list field cleanly against a target whose adapter reports the scalarList capability', () => {
    const document = symbolTableInputFromParseArgs({
      schema: listSchema,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      target: postgresTarget,
      scalarColumnDescriptors: postgresScalarTypeDescriptors,
      composedExtensionContracts: new Map(),
      createNamespace: createTestSqlNamespace,
      dataTypeLookup: fixtureDataTypeSupport.lookup,
      capabilities: postgresCapabilities,
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(modelsOf(result.value)).toMatchObject({
      User: {
        fields: {
          tags: {
            nullable: false,
            type: { kind: 'scalar', codecId: 'pg/text@1' },
            many: true,
          },
        },
      },
    });
  });

  it('rejects a scalar list against an empty capability matrix (fail-closed)', () => {
    const document = symbolTableInputFromParseArgs({
      schema: listSchema,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      target: postgresTarget,
      scalarColumnDescriptors: postgresScalarTypeDescriptors,
      composedExtensionContracts: new Map(),
      createNamespace: createTestSqlNamespace,
      dataTypeLookup: fixtureDataTypeSupport.lookup,
      capabilities: {},
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'PSL_SCALAR_LIST_UNSUPPORTED_TARGET' }),
      ]),
    );
  });
});
