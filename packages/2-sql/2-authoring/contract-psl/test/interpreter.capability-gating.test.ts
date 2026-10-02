import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { fixtureDataTypeSupport } from './fixture-data-types';
import {
  createBuiltinLikeControlMutationDefaults,
  interpretSqlContract,
  modelsOf,
  postgresScalarTypeDescriptors,
  postgresTarget,
  sqliteScalarColumnDescriptors,
  sqliteTarget,
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
    const result = interpretSqlContract(listSchema, {
      target: sqliteTarget,
      scalarColumnDescriptors: sqliteScalarColumnDescriptors,
      composedExtensionContracts: new Map(),
      createNamespace: createTestSqlNamespace,
      dataTypes: fixtureDataTypeSupport,
      capabilities: sqliteCapabilities,
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
    const result = interpretSqlContract(listSchema, {
      target: postgresTarget,
      scalarColumnDescriptors: postgresScalarTypeDescriptors,
      composedExtensionContracts: new Map(),
      createNamespace: createTestSqlNamespace,
      dataTypes: fixtureDataTypeSupport,
      capabilities: postgresCapabilities,
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
            many: { elementNullable: false },
          },
        },
      },
    });
  });

  it('rejects a scalar list against an empty capability matrix (fail-closed)', () => {
    const result = interpretSqlContract(listSchema, {
      target: postgresTarget,
      scalarColumnDescriptors: postgresScalarTypeDescriptors,
      composedExtensionContracts: new Map(),
      createNamespace: createTestSqlNamespace,
      dataTypes: fixtureDataTypeSupport,
      capabilities: {},
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
