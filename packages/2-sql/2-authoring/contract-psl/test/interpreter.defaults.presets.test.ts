import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { fixtureDataTypeSupport } from './fixture-data-types';
import { interpretSqlContract, sqliteScalarColumnDescriptors, sqliteTarget } from './fixtures';
import { sqlStorageFromSuccessfulSqlInterpretation } from './interpret-sql-contract-storage';
import {
  builtinControlMutationDefaults,
  interpretPostgresSchema,
  postgresTemporalContributions,
  sqliteTemporalContributions,
} from './interpreter-defaults-support';
import { unboundTables } from './unbound-tables';

describe('interpretPslDocumentToSqlContract field-preset default lowering', () => {
  it('lowers boolean literal defaults into the storage contract', () => {
    const result = interpretPostgresSchema(
      `model Flags {
  id Int @id
  enabled Boolean @default(true)
  disabled Boolean @default(false)
}`,
      {
        controlMutationDefaults: builtinControlMutationDefaults,
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
    expect(unboundTables(storage)['Flags']?.columns['enabled']?.default).toEqual({
      kind: 'literal',
      value: true,
    });
    expect(unboundTables(storage)['Flags']?.columns['disabled']?.default).toEqual({
      kind: 'literal',
      value: false,
    });
  });

  it('lowers temporal.updatedAt() to create and update execution defaults', () => {
    const result = interpretPostgresSchema(
      `model Timestamped {
  id Int @id
  createdAt DateTime @default(now())
  updatedAt temporal.updatedAt()
}`,
      {
        controlMutationDefaults: builtinControlMutationDefaults,
        authoringContributions: postgresTemporalContributions,
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
    expect(unboundTables(storage)['Timestamped']?.columns['createdAt']?.default).toEqual({
      kind: 'function',
      expression: 'now()',
    });
    expect(result.value.execution?.mutations.defaults).toEqual([
      {
        ref: { namespace: 'public', entry: 'Timestamped', field: 'updatedAt' },
        onCreate: { kind: 'generator', id: 'timestampNow' },
        onUpdate: { kind: 'generator', id: 'timestampNow' },
      },
    ]);
  });

  it('lowers SQLite temporal.updatedAt() to SQLite timestamp codecs', () => {
    const result = interpretSqlContract(
      `model Timestamped {
  id Int @id
  createdAt DateTime @default(now())
  updatedAt temporal.updatedAt()
}`,
      {
        target: sqliteTarget,
        scalarColumnDescriptors: sqliteScalarColumnDescriptors,
        composedExtensionContracts: new Map(),
        controlMutationDefaults: builtinControlMutationDefaults,
        authoringContributions: sqliteTemporalContributions,
        createNamespace: createTestSqlNamespace,
        dataTypeLookup: fixtureDataTypeSupport.lookup,
        capabilities: { sql: { scalarList: true } },
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
    expect(unboundTables(storage)['Timestamped']?.columns['updatedAt']).toMatchObject({
      codecId: 'sqlite/datetime@1',
      nativeType: 'text',
      nullable: false,
    });
    expect(result.value.execution?.mutations.defaults).toEqual([
      {
        ref: { namespace: '__unbound__', entry: 'Timestamped', field: 'updatedAt' },
        onCreate: { kind: 'generator', id: 'timestampNow' },
        onUpdate: { kind: 'generator', id: 'timestampNow' },
      },
    ]);
  });

  it('emits a migration hint when @updatedAt is used (after attribute removal)', () => {
    const result = interpretPostgresSchema(
      `model Stale {
  id Int @id
  updatedAt DateTime @updatedAt
}`,
      {
        controlMutationDefaults: builtinControlMutationDefaults,
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_UNSUPPORTED_FIELD_ATTRIBUTE',
          sourceId: 'schema.prisma',
          message: expect.stringContaining('temporal.updatedAt()'),
        }),
      ]),
    );
  });

  it('suppresses the @updatedAt migration hint when the field already declares a temporal preset', () => {
    // `temporal.updatedAt() @updatedAt` is a half-migrated field. The
    // attribute is unsupported (not registered in `sqlAttributeSpecs.field`),
    // so the diagnostic still fires — but we don't tell users to do what
    // they already did. The migration hint is suppressed; only the bare
    // unsupported-attribute message is emitted.

    const result = interpretPostgresSchema(
      `model Migrated {
  id Int @id
  updatedAt temporal.updatedAt() @updatedAt
}`,
      {
        controlMutationDefaults: builtinControlMutationDefaults,
        authoringContributions: postgresTemporalContributions,
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;

    const updatedAtDiagnostic = result.failure.diagnostics.find(
      (diagnostic) =>
        diagnostic.code === 'PSL_UNSUPPORTED_FIELD_ATTRIBUTE' &&
        diagnostic.message.includes('@updatedAt'),
    );
    expect(updatedAtDiagnostic).toBeDefined();
    expect(updatedAtDiagnostic?.message).not.toContain('temporal.updatedAt()');
  });

  it('resolves a synthetic field preset through the field-preset dispatch path (genericness)', () => {
    // Registers a synthetic preset under `temporal.exampleField` to confirm
    // that PSL's field-preset dispatch is generic — it walks
    // `authoringContributions.field` for any registered preset, not just the
    // real `temporal.{createdAt,updatedAt}` pair.

    const result = interpretPostgresSchema(
      `model Synthetic {
  id Int @id
  example temporal.exampleField()
}`,
      {
        controlMutationDefaults: builtinControlMutationDefaults,
        authoringContributions: {
          field: {
            temporal: {
              exampleField: {
                kind: 'fieldPreset',
                output: {
                  codecId: 'pg/text@1',
                  nativeType: 'text',
                  default: { kind: 'function', expression: "'synthetic-default'" },
                },
              },
            },
          },
        },
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.storage).toMatchObject({
      namespaces: {
        public: {
          entries: {
            table: {
              Synthetic: {
                columns: {
                  example: {
                    codecId: 'pg/text@1',
                    nativeType: 'text',
                    nullable: false,
                    default: {
                      kind: 'function',
                      expression: "'synthetic-default'",
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    // The synthetic preset declares a storage default only — no execution
    // mutation default should be emitted for the `example` column.
    const defaults = result.value.execution?.mutations.defaults ?? [];
    expect(defaults.find((entry) => entry.ref.field === 'example')).toBeUndefined();
  });

  it('uses nullable from field presets when lowering storage columns', () => {
    const result = interpretPostgresSchema(
      `model Synthetic {
  id Int @id
  maybe temporal.nullableField()
}`,
      {
        controlMutationDefaults: builtinControlMutationDefaults,
        authoringContributions: {
          field: {
            temporal: {
              nullableField: {
                kind: 'fieldPreset',
                output: {
                  codecId: 'pg/text@1',
                  nativeType: 'text',
                  nullable: true,
                },
              },
            },
          },
        },
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.storage).toMatchObject({
      namespaces: {
        public: {
          entries: {
            table: {
              Synthetic: {
                columns: {
                  maybe: {
                    codecId: 'pg/text@1',
                    nativeType: 'text',
                    nullable: true,
                  },
                },
              },
            },
          },
        },
      },
    });
  });

  it('resolves a type constructor sharing a field-preset namespace', () => {
    const result = interpretPostgresSchema(
      `model Synthetic {
  id Int @id
  example audit.Custom()
}`,
      {
        controlMutationDefaults: builtinControlMutationDefaults,
        authoringContributions: {
          field: {
            audit: {
              createdAt: {
                kind: 'fieldPreset',
                output: {
                  codecId: 'pg/timestamptz-temporal@1',
                  nativeType: 'timestamptz',
                },
              },
            },
          },
          type: {
            audit: {
              Custom: {
                kind: 'typeConstructor',
                output: {
                  codecId: 'pg/text@1',
                  nativeType: 'text',
                },
              },
            },
          },
        },
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.storage).toMatchObject({
      namespaces: {
        public: {
          entries: {
            table: {
              Synthetic: {
                columns: {
                  example: {
                    codecId: 'pg/text@1',
                    nativeType: 'text',
                  },
                },
              },
            },
          },
        },
      },
    });
  });
});
