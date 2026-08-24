import type {
  AuthoringContributions,
  AuthoringTypeNamespace,
} from '@internal/framework-components/authoring';
import { collectScalarTypeConstructors } from '@internal/framework-components/authoring';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import {
  type InterpretPslDocumentToSqlContractInput,
  interpretPslDocumentToSqlContract as interpretPslDocumentToSqlContractInternal,
} from '../src/interpreter';
import {
  createBuiltinLikeControlMutationDefaults,
  postgresNativeScalarTypeDescriptors,
  postgresScalarAuthoringTypes,
  postgresScalarTypeDescriptors,
  postgresTarget,
  sqliteScalarColumnDescriptors,
  sqliteTarget,
  symbolTableInputFromParseArgs,
  temporalCodecPresetMirrors,
  temporalConvenienceMirrors,
} from './fixtures';
import { sqlStorageFromSuccessfulSqlInterpretation } from './interpret-sql-contract-storage';
import { unboundTables } from './unbound-tables';

describe('interpretPslDocumentToSqlContract default lowering', () => {
  const builtinControlMutationDefaults = createBuiltinLikeControlMutationDefaults();
  const interpretPslDocumentToSqlContract = (
    input: Omit<
      InterpretPslDocumentToSqlContractInput,
      | 'target'
      | 'scalarColumnDescriptors'
      | 'composedExtensionContracts'
      | 'createNamespace'
      | 'capabilities'
    > &
      Partial<
        Pick<
          InterpretPslDocumentToSqlContractInput,
          'composedExtensionContracts' | 'scalarColumnDescriptors'
        >
      >,
  ) => {
    const { scalarColumnDescriptors = postgresNativeScalarTypeDescriptors, ...interpreterInput } =
      input;
    return interpretPslDocumentToSqlContractInternal({
      target: postgresTarget,
      scalarColumnDescriptors,
      composedExtensionContracts: new Map(),
      createNamespace: createTestSqlNamespace,
      capabilities: { sql: { scalarList: true } },
      ...interpreterInput,
    });
  };
  it('lowers supported default functions into execution and storage contract shapes', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model Defaults {
  id Int @id
  idCuid2 String @default(cuid(2))
  idUuidV4 String @default(uuid())
  idUuidV7 String @default(uuid(7))
  idUlid String @default(ulid())
  idNanoidDefault String @default(nanoid())
  idNanoidSized String @default(nanoid(16))
  dbExpr String @default(dbgenerated("gen_random_uuid()"))
  createdAt DateTime @default(now())
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.execution).toMatchObject({
      mutations: {
        defaults: [
          {
            ref: { namespace: 'public', table: 'defaults', column: 'idCuid2' },
            onCreate: { kind: 'generator', id: 'cuid2' },
          },
          {
            ref: { namespace: 'public', table: 'defaults', column: 'idNanoidDefault' },
            onCreate: { kind: 'generator', id: 'nanoid' },
          },
          {
            ref: { namespace: 'public', table: 'defaults', column: 'idNanoidSized' },
            onCreate: { kind: 'generator', id: 'nanoid', params: { size: 16 } },
          },
          {
            ref: { namespace: 'public', table: 'defaults', column: 'idUlid' },
            onCreate: { kind: 'generator', id: 'ulid' },
          },
          {
            ref: { namespace: 'public', table: 'defaults', column: 'idUuidV4' },
            onCreate: { kind: 'generator', id: 'uuidv4' },
          },
          {
            ref: { namespace: 'public', table: 'defaults', column: 'idUuidV7' },
            onCreate: { kind: 'generator', id: 'uuidv7' },
          },
        ],
      },
    });
    expect(result.value.storage).toMatchObject({
      namespaces: {
        public: {
          entries: {
            table: {
              defaults: {
                columns: {
                  // Generator defaults never mutate storage: the String type
                  // position alone decides the column type (pg: text).
                  idUuidV4: {
                    codecId: 'pg/text@1',
                    nativeType: 'text',
                  },
                  idNanoidDefault: {
                    codecId: 'pg/text@1',
                    nativeType: 'text',
                  },
                  idNanoidSized: {
                    codecId: 'pg/text@1',
                    nativeType: 'text',
                  },
                  dbExpr: {
                    default: {
                      kind: 'function',
                      expression: 'gen_random_uuid()',
                    },
                  },
                  createdAt: {
                    default: {
                      kind: 'function',
                      expression: 'now()',
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
  });

  it('accepts uuid() and uuid(7) defaults on bare Uuid columns, preserving native uuid storage type', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `types {
  UuidNativeId = Uuid
}

model UuidNative {
  idV4 UuidNativeId @id @default(uuid())
  idV7 UuidNativeId @default(uuid(7))
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.execution).toMatchObject({
      mutations: {
        defaults: expect.arrayContaining([
          {
            ref: { namespace: 'public', table: 'uuidNative', column: 'idV4' },
            onCreate: { kind: 'generator', id: 'uuidv4' },
          },
          {
            ref: { namespace: 'public', table: 'uuidNative', column: 'idV7' },
            onCreate: { kind: 'generator', id: 'uuidv7' },
          },
        ]),
      },
    });

    const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
    const uuidNativeTable = storage.namespaces['public']?.entries.table?.['uuidNative'];
    expect(uuidNativeTable?.columns['idV4']).toMatchObject({
      codecId: 'pg/uuid@1',
      nativeType: 'uuid',
    });
    expect(uuidNativeTable?.columns['idV7']).toMatchObject({
      codecId: 'pg/uuid@1',
      nativeType: 'uuid',
    });
  });

  it('accepts uuid() default on a named Uuid type field (e.g. id Uuid @id @default(uuid())), preserving native uuid storage type', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `types {
  Uuid = Uuid
}

model Profile {
  id Uuid @id @default(uuid())
  name String
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.execution).toMatchObject({
      mutations: {
        defaults: [
          {
            ref: { namespace: 'public', table: 'profile', column: 'id' },
            onCreate: { kind: 'generator', id: 'uuidv4' },
          },
        ],
      },
    });

    const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
    const profileTable = storage.namespaces['public']?.entries.table?.['profile'];
    expect(profileTable?.columns['id']).toMatchObject({
      codecId: 'pg/uuid@1',
      nativeType: 'uuid',
    });
  });

  it('rejects non-uuid generators on bare Uuid columns with PSL_INVALID_DEFAULT_APPLICABILITY', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `types {
  UuidNativeId = Uuid
}

model UuidNativeBad {
  id UuidNativeId @id @default(nanoid())
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_DEFAULT_APPLICABILITY',
          sourceId: 'schema.prisma',
          message: expect.stringContaining('nanoid'),
        }),
      ]),
    );
  });

  it('returns diagnostics for unsupported default functions and invalid arguments', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model InvalidDefaults {
  id Int @id
  cuidValue String @default(cuid())
  badUuid String @default(uuid(5))
  badNanoid String @default(nanoid(1))
  emptyDbExpr String @default(dbgenerated(""))
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
          sourceId: 'schema.prisma',
        }),
        expect.objectContaining({
          code: 'PSL_INVALID_DEFAULT_FUNCTION_ARGUMENT',
          sourceId: 'schema.prisma',
          message: expect.stringContaining('dbgenerated'),
        }),
      ]),
    );
  });

  it('returns diagnostics for optional fields with execution defaults', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model OptionalDefaults {
  id Int @id
  token String? @default(nanoid())
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_DEFAULT_FUNCTION_ARGUMENT',
          sourceId: 'schema.prisma',
          message: expect.stringContaining(
            'cannot be optional when using execution default "nanoid"',
          ),
        }),
      ]),
    );
  });

  it('preserves raw dbgenerated defaults for timestamp and json columns', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model Defaults {
  id Int @id
  touchedAt DateTime @default(dbgenerated("clock_timestamp()"))
  payload Jsonb @default(dbgenerated("'{}'::jsonb"))
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.storage).toMatchObject({
      namespaces: {
        public: {
          entries: {
            table: {
              defaults: {
                columns: {
                  touchedAt: {
                    default: {
                      kind: 'function',
                      expression: 'clock_timestamp()',
                    },
                  },
                  payload: {
                    default: {
                      kind: 'function',
                      expression: "'{}'::jsonb",
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
  });

  // The temporal preset registry inline test fixtures use to exercise the
  // PSL-side preset surface for Postgres + SQLite. Real targets ship the
  // same shapes via `target.authoring.field.temporal.*`.
  //
  // Every entry comes from the mirrors in fixtures.ts, which family-sql's
  // temporal-codec-presets.test.ts asserts deep-equal the real factory output
  // — so a factory change fails there rather than silently leaving these tests
  // passing against a preset that no longer ships.
  const postgresTemporalContributions = {
    field: {
      temporal: {
        ...temporalConvenienceMirrors.postgres,
        timestamp: temporalCodecPresetMirrors.pgTimestamp,
        timestamptz: temporalCodecPresetMirrors.pgTimestamptz,
      },
    },
  } as const;

  const sqliteTemporalContributions = {
    field: {
      temporal: {
        ...temporalConvenienceMirrors.sqlite,
        datetime: temporalCodecPresetMirrors.sqliteDatetime,
      },
    },
  } as const;

  it('lowers boolean literal defaults into the storage contract', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model Flags {
  id Int @id
  enabled Boolean @default(true)
  disabled Boolean @default(false)
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
    expect(unboundTables(storage)['flags']?.columns['enabled']?.default).toEqual({
      kind: 'literal',
      value: true,
    });
    expect(unboundTables(storage)['flags']?.columns['disabled']?.default).toEqual({
      kind: 'literal',
      value: false,
    });
  });

  it('lowers temporal.updatedAt() to create and update execution defaults', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model Timestamped {
  id Int @id
  createdAt DateTime @default(now())
  updatedAt temporal.updatedAt()
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
      authoringContributions: postgresTemporalContributions,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
    expect(unboundTables(storage)['timestamped']?.columns['createdAt']?.default).toEqual({
      kind: 'function',
      expression: 'now()',
    });
    expect(result.value.execution?.mutations.defaults).toEqual([
      {
        ref: { namespace: 'public', table: 'timestamped', column: 'updatedAt' },
        onCreate: { kind: 'generator', id: 'timestampNow' },
        onUpdate: { kind: 'generator', id: 'timestampNow' },
      },
    ]);
  });

  it('lowers SQLite temporal.updatedAt() to SQLite timestamp codecs', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model Timestamped {
  id Int @id
  createdAt DateTime @default(now())
  updatedAt temporal.updatedAt()
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContractInternal({
      ...document,
      target: sqliteTarget,
      scalarColumnDescriptors: sqliteScalarColumnDescriptors,
      composedExtensionContracts: new Map(),
      controlMutationDefaults: builtinControlMutationDefaults,
      authoringContributions: sqliteTemporalContributions,
      createNamespace: createTestSqlNamespace,
      capabilities: { sql: { scalarList: true } },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
    expect(unboundTables(storage)['timestamped']?.columns['updatedAt']).toMatchObject({
      codecId: 'sqlite/datetime@1',
      nativeType: 'text',
      nullable: false,
    });
    expect(result.value.execution?.mutations.defaults).toEqual([
      {
        ref: { namespace: '__unbound__', table: 'timestamped', column: 'updatedAt' },
        onCreate: { kind: 'generator', id: 'timestampNow' },
        onUpdate: { kind: 'generator', id: 'timestampNow' },
      },
    ]);
  });

  it('emits a migration hint when @updatedAt is used (after attribute removal)', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model Stale {
  id Int @id
  updatedAt DateTime @updatedAt
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

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
    // attribute is unsupported (no longer in BUILTIN_FIELD_ATTRIBUTE_NAMES),
    // so the diagnostic still fires — but we don't tell users to do what
    // they already did. The migration hint is suppressed; only the bare
    // unsupported-attribute message is emitted.
    const document = symbolTableInputFromParseArgs({
      schema: `model Migrated {
  id Int @id
  updatedAt temporal.updatedAt() @updatedAt
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
      authoringContributions: postgresTemporalContributions,
    });

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
    const document = symbolTableInputFromParseArgs({
      schema: `model Synthetic {
  id Int @id
  example temporal.exampleField()
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
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
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.storage).toMatchObject({
      namespaces: {
        public: {
          entries: {
            table: {
              synthetic: {
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
    expect(defaults.find((entry) => entry.ref.column === 'example')).toBeUndefined();
  });

  it('uses nullable from field presets when lowering storage columns', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model Synthetic {
  id Int @id
  maybe temporal.nullableField()
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
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
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.storage).toMatchObject({
      namespaces: {
        public: {
          entries: {
            table: {
              synthetic: {
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
    const document = symbolTableInputFromParseArgs({
      schema: `model Synthetic {
  id Int @id
  example audit.Custom()
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
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
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.storage).toMatchObject({
      namespaces: {
        public: {
          entries: {
            table: {
              synthetic: {
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

  // Field-preset misuse cases. The preset is a complete field declaration —
  // optional (?), list ([]), @default(...), @id, @updatedAt all contradict
  // that and produce hard errors per spec FR7.
  describe('field-preset misuse', () => {
    const syntheticPresetContributions = {
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
    } as const;

    it('rejects optional field-preset call with PSL_PRESET_NOT_OPTIONAL', () => {
      const document = symbolTableInputFromParseArgs({
        schema: `model Bad {
  id Int @id
  example temporal.exampleField()?
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        ...document,
        controlMutationDefaults: builtinControlMutationDefaults,
        authoringContributions: syntheticPresetContributions,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_PRESET_NOT_OPTIONAL',
            sourceId: 'schema.prisma',
          }),
        ]),
      );
    });

    it('rejects field-preset call combined with @default(...) with PSL_PRESET_AND_DEFAULT_CONFLICT', () => {
      const document = symbolTableInputFromParseArgs({
        schema: `model Bad {
  id Int @id
  example temporal.exampleField() @default(now())
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        ...document,
        controlMutationDefaults: builtinControlMutationDefaults,
        authoringContributions: syntheticPresetContributions,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_PRESET_AND_DEFAULT_CONFLICT',
            sourceId: 'schema.prisma',
          }),
        ]),
      );
    });

    it('rejects field-preset call combined with @id when preset does not contribute id', () => {
      const document = symbolTableInputFromParseArgs({
        schema: `model Bad {
  id Int @id
  example temporal.exampleField() @id
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        ...document,
        controlMutationDefaults: builtinControlMutationDefaults,
        authoringContributions: syntheticPresetContributions,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_PRESET_AND_ID_CONFLICT',
            sourceId: 'schema.prisma',
          }),
        ]),
      );
    });

    it('rejects an unknown extension namespace in field-position with PSL_EXTENSION_NAMESPACE_NOT_COMPOSED (AC5c)', () => {
      const document = symbolTableInputFromParseArgs({
        schema: `model Bad {
  id Int @id
  ts weather.updatedAt()
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        ...document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_EXTENSION_NAMESPACE_NOT_COMPOSED',
            sourceId: 'schema.prisma',
            data: { namespace: 'weather', suggestedPack: 'weather' },
          }),
        ]),
      );
    });

    it('rejects extra positional argument to a zero-arg preset (AC5a)', () => {
      const document = symbolTableInputFromParseArgs({
        schema: `model Bad {
  id Int @id
  example temporal.exampleField(123)
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        ...document,
        controlMutationDefaults: builtinControlMutationDefaults,
        authoringContributions: syntheticPresetContributions,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
            sourceId: 'schema.prisma',
            message: expect.stringContaining('temporal.exampleField'),
          }),
        ]),
      );
    });

    it('rejects list-of preset call with PSL_PRESET_NOT_LIST (AC5f)', () => {
      const document = symbolTableInputFromParseArgs({
        schema: `model Bad {
  id Int @id
  example temporal.exampleField()[]
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        ...document,
        controlMutationDefaults: builtinControlMutationDefaults,
        authoringContributions: syntheticPresetContributions,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_PRESET_NOT_LIST',
            sourceId: 'schema.prisma',
          }),
        ]),
      );
    });

    it('rejects @default(temporal.updatedAt()) as invalid attribute syntax (AC5g)', () => {
      // A namespaced callee fails the funcCall spec before reaching the registry, so the rejection
      // is a syntax error rather than a generator-applicability error.
      const document = symbolTableInputFromParseArgs({
        schema: `model Bad {
  id Int @id
  ts DateTime @default(temporal.updatedAt())
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        ...document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
            sourceId: 'schema.prisma',
          }),
        ]),
      );
    });

    it('rejects two type-constructor calls on the same field at parse time (AC5i)', () => {
      // PSL grammar permits at most one type-constructor call per field; a
      // second one is a parser-level reject. This test locks in the
      // failure mode so a future parser refactor can't silently accept the
      // ambiguous form and let the interpreter pick one.
      const document = symbolTableInputFromParseArgs({
        schema: `model Bad {
  id Int @id
  example temporal.updatedAt() temporal.createdAt()
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        ...document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics.length).toBeGreaterThan(0);
    });

    it('rejects an unknown preset name in a registered field namespace with PSL_UNKNOWN_FIELD_PRESET', () => {
      const document = symbolTableInputFromParseArgs({
        schema: `model Bad {
  id Int @id
  example audit.foo()
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        ...document,
        controlMutationDefaults: builtinControlMutationDefaults,
        authoringContributions: { field: { audit: {} }, type: {} },
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_UNKNOWN_FIELD_PRESET',
            sourceId: 'schema.prisma',
            message: expect.stringContaining('audit.foo'),
            data: { namespace: 'audit', helperPath: 'audit.foo' },
          }),
        ]),
      );
    });
  });

  // Whole column shapes and whole execution-defaults lists are asserted here,
  // not spot fields: which keys are absent is as much a part of the lowering
  // contract as which are present. `temporal.timestamp()` must omit
  // `typeParams` entirely, and a preset with no phase token must omit
  // `executionDefaults` entirely rather than emit an empty object.
  describe('temporal per-codec preset lowering', () => {
    const interpretTemporal = (schema: string) => {
      const document = symbolTableInputFromParseArgs({ schema, sourceId: 'schema.prisma' });
      return interpretPslDocumentToSqlContract({
        ...document,
        scalarColumnDescriptors: postgresScalarTypeDescriptors,
        controlMutationDefaults: builtinControlMutationDefaults,
        authoringContributions: postgresTemporalContributions,
      });
    };

    const columnAndDefaults = (schema: string) => {
      const result = interpretTemporal(schema);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('interpretation failed');
      const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
      return {
        column: unboundTables(storage)['t']?.columns['stamped'],
        defaults: result.value.execution?.mutations.defaults ?? [],
      };
    };

    const model = (field: string) => `model T {
  id Int @id
  stamped ${field}
}`;

    const pgTimestampPrecision3 = {
      nativeType: 'timestamp',
      codecId: 'pg/timestamp-temporal@1',
      nullable: false,
      typeParams: { precision: 3 },
    };
    const stampedRef = { namespace: 'public', table: 't', column: 'stamped' };
    const nowPhase = { kind: 'generator', id: 'timestampNow' };

    it('timestamp(3, onCreate: now, onUpdate: now) yields precision 3 and both phases', () => {
      const { column, defaults } = columnAndDefaults(
        model('temporal.timestamp(3, onCreate: now, onUpdate: now)'),
      );
      expect(column).toEqual(pgTimestampPrecision3);
      expect(defaults).toEqual([{ ref: stampedRef, onCreate: nowPhase, onUpdate: nowPhase }]);
    });

    it('timestamp(3) yields precision 3 and no execution defaults at all', () => {
      const { column, defaults } = columnAndDefaults(model('temporal.timestamp(3)'));
      expect(column).toEqual(pgTimestampPrecision3);
      expect(defaults).toEqual([]);
    });

    it('timestamp() omits the typeParams key entirely and has no execution defaults', () => {
      const { column, defaults } = columnAndDefaults(model('temporal.timestamp()'));
      expect(column).toEqual({
        nativeType: 'timestamp',
        codecId: 'pg/timestamp-temporal@1',
        nullable: false,
      });
      expect(column).not.toHaveProperty('typeParams');
      expect(defaults).toEqual([]);
    });

    it('timestamptz(onCreate: now, onUpdate: now) yields both phases and no typeParams', () => {
      const { column, defaults } = columnAndDefaults(
        model('temporal.timestamptz(onCreate: now, onUpdate: now)'),
      );
      expect(column).toEqual({
        nativeType: 'timestamptz',
        codecId: 'pg/timestamptz-temporal@1',
        nullable: false,
      });
      expect(defaults).toEqual([{ ref: stampedRef, onCreate: nowPhase, onUpdate: nowPhase }]);
    });

    it('timestamptz(onUpdate: now) yields the onUpdate phase only', () => {
      const { column, defaults } = columnAndDefaults(model('temporal.timestamptz(onUpdate: now)'));
      expect(column).toEqual({
        nativeType: 'timestamptz',
        codecId: 'pg/timestamptz-temporal@1',
        nullable: false,
      });
      expect(defaults).toEqual([{ ref: stampedRef, onUpdate: nowPhase }]);
    });

    it('updatedAt() is byte-identical to timestamptz(onCreate: now, onUpdate: now)', () => {
      const convenience = columnAndDefaults(model('temporal.updatedAt()'));
      const full = columnAndDefaults(model('temporal.timestamptz(onCreate: now, onUpdate: now)'));
      expect(convenience).toEqual(full);
    });

    it('accepts precision named as well as positional, lowering identically', () => {
      expect(columnAndDefaults(model('temporal.timestamp(precision: 3)'))).toEqual(
        columnAndDefaults(model('temporal.timestamp(3)')),
      );
      expect(
        columnAndDefaults(model('temporal.timestamp(precision: 3, onCreate: now, onUpdate: now)')),
      ).toEqual(columnAndDefaults(model('temporal.timestamp(3, onCreate: now, onUpdate: now)')));
    });

    it('lowers sqlite temporal.datetime(onCreate: now, onUpdate: now) to the sqlite codec', () => {
      const document = symbolTableInputFromParseArgs({
        schema: model('temporal.datetime(onCreate: now, onUpdate: now)'),
        sourceId: 'schema.prisma',
      });
      const result = interpretPslDocumentToSqlContractInternal({
        ...document,
        target: sqliteTarget,
        scalarColumnDescriptors: sqliteScalarColumnDescriptors,
        composedExtensionContracts: new Map(),
        controlMutationDefaults: builtinControlMutationDefaults,
        authoringContributions: sqliteTemporalContributions,
        createNamespace: createTestSqlNamespace,
        capabilities: { sql: { scalarList: true } },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
      expect(unboundTables(storage)['t']?.columns['stamped']).toEqual({
        nativeType: 'text',
        codecId: 'sqlite/datetime@1',
        nullable: false,
      });
      expect(result.value.execution?.mutations.defaults).toEqual([
        {
          ref: { namespace: '__unbound__', table: 't', column: 'stamped' },
          onCreate: nowPhase,
          onUpdate: nowPhase,
        },
      ]);
    });

    // Every bad-argument spelling reports through the existing
    // PSL_INVALID_ATTRIBUTE_ARGUMENT plumbing; the option kind introduces no
    // diagnostic code of its own.
    it.each([
      {
        name: 'an option value outside the descriptor values',
        field: 'temporal.timestamp(onCreate: later)',
        message: /must be one of: now/,
      },
      {
        name: 'a quoted option value (one spelling only)',
        field: 'temporal.timestamp(onCreate: "now")',
        message: /cannot parse named argument "onCreate" for descriptor kind "option"/,
      },
      {
        name: 'a duplicate named argument',
        field: 'temporal.timestamp(precision: 3, precision: 4)',
        message: /received duplicate value for argument "precision"/,
      },
      {
        name: 'a positional argument the same named argument also supplies',
        field: 'temporal.timestamp(3, precision: 4)',
        message: /received duplicate value for argument "precision"/,
      },
      {
        name: 'an unknown named argument',
        field: 'temporal.timestamp(frequency: now)',
        message: /received unknown named argument "frequency"/,
      },
    ])('rejects $name', ({ field, message }) => {
      const result = interpretTemporal(model(field));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
            message: expect.stringMatching(message),
          }),
        ]),
      );
    });
  });
  describe('generator defaults never mutate storage — the type position is the only storage decider', () => {
    // Mirrors the adapter contribution shape, with the scalar view derived
    // the same way the provider derives it (collectScalarTypeConstructors).
    const authoringTypes = {
      ...postgresScalarAuthoringTypes,
      Uuid: { kind: 'typeConstructor', output: { codecId: 'pg/uuid@1', nativeType: 'uuid' } },
      Char: {
        kind: 'typeConstructor',
        args: [{ kind: 'number', name: 'length', integer: true, minimum: 1, optional: true }],
        output: {
          codecId: 'sql/char@1',
          nativeType: 'character',
          typeParams: { length: { kind: 'arg', index: 0 } },
        },
      },
    } satisfies AuthoringTypeNamespace;
    const authoringContributions = {
      entityTypes: {},
      field: {},
      pslBlockDescriptors: {},
      modelAttributes: {},
      type: authoringTypes,
    } satisfies AuthoringContributions;

    const interpret = (schema: string) =>
      interpretPslDocumentToSqlContractInternal({
        ...symbolTableInputFromParseArgs({ schema, sourceId: 'schema.prisma' }),
        target: postgresTarget,
        scalarColumnDescriptors: collectScalarTypeConstructors(authoringTypes),
        authoringContributions,
        composedExtensionContracts: new Map(),
        controlMutationDefaults: builtinControlMutationDefaults,
        createNamespace: createTestSqlNamespace,
        capabilities: { sql: { scalarList: true } },
      });

    it('keeps pg/uuid@1 for a bare native scalar field under @default(uuid())', () => {
      const result = interpret(`model F {
  id Uuid @id @default(uuid())
}`);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
      expect(storage.namespaces['public']?.entries.table?.['f']?.columns['id']).toEqual({
        codecId: 'pg/uuid@1',
        nativeType: 'uuid',
        nullable: false,
      });
      expect(result.value.execution?.mutations.defaults).toEqual([
        {
          ref: { namespace: 'public', table: 'f', column: 'id' },
          onCreate: { kind: 'generator', id: 'uuidv4' },
        },
      ]);
    });

    it('keeps pg/uuid@1 for a named type aliasing the native scalar under @default(uuid())', () => {
      const result = interpret(`types {
  TUuid = Uuid
}

model E {
  id TUuid @id @default(uuid())
}`);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
      expect(storage.namespaces['public']?.entries.table?.['e']?.columns['id']).toEqual({
        codecId: 'pg/uuid@1',
        nativeType: 'uuid',
        nullable: false,
        typeRef: 'TUuid',
      });
    });

    it('keeps explicit char storage for a constructor-form field under a non-uuid generator default', () => {
      const result = interpret(`model M {
  id Char(30) @id @default(cuid(2))
}`);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
      expect(storage.namespaces['public']?.entries.table?.['m']?.columns['id']).toEqual({
        codecId: 'sql/char@1',
        nativeType: 'character',
        nullable: false,
        typeParams: { length: 30 },
      });
      expect(result.value.execution?.mutations.defaults).toEqual([
        {
          ref: { namespace: 'public', table: 'm', column: 'id' },
          onCreate: { kind: 'generator', id: 'cuid2' },
        },
      ]);
    });

    it('keeps the target String storage (text) for String under @default(uuid()) and emits the uuidv4 execution default', () => {
      const result = interpret(`model L {
  id String @id @default(uuid())
}`);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
      expect(storage.namespaces['public']?.entries.table?.['l']?.columns['id']).toEqual({
        codecId: 'pg/text@1',
        nativeType: 'text',
        nullable: false,
      });
      expect(result.value.execution?.mutations.defaults).toEqual([
        {
          ref: { namespace: 'public', table: 'l', column: 'id' },
          onCreate: { kind: 'generator', id: 'uuidv4' },
        },
      ]);
    });

    it('lowers the zero-arg call form String() identically to bare String under @default(uuid())', () => {
      const result = interpret(`model P {
  id String() @id @default(uuid())
}`);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
      expect(storage.namespaces['public']?.entries.table?.['p']?.columns['id']).toEqual({
        codecId: 'pg/text@1',
        nativeType: 'text',
        nullable: false,
      });
    });

    it('keeps text storage for nanoid and cuid generator defaults on String fields', () => {
      const result = interpret(`model N {
  id String @id @default(nanoid())
  sized String @default(nanoid(16))
  ref String @default(cuid(2))
}`);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
      const columns = storage.namespaces['public']?.entries.table?.['n']?.columns;
      expect(columns?.['id']).toEqual({
        codecId: 'pg/text@1',
        nativeType: 'text',
        nullable: false,
      });
      expect(columns?.['sized']).toEqual({
        codecId: 'pg/text@1',
        nativeType: 'text',
        nullable: false,
      });
      expect(columns?.['ref']).toEqual({
        codecId: 'pg/text@1',
        nativeType: 'text',
        nullable: false,
      });
      expect(result.value.execution?.mutations.defaults).toEqual(
        expect.arrayContaining([
          {
            ref: { namespace: 'public', table: 'n', column: 'sized' },
            onCreate: { kind: 'generator', id: 'nanoid', params: { size: 16 } },
          },
        ]),
      );
    });

    it('keeps text storage for a named type aliasing String under @default(uuid())', () => {
      const result = interpret(`types {
  TId = String
}

model T {
  id TId @id @default(uuid())
}`);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
      expect(storage.namespaces['public']?.entries.table?.['t']?.columns['id']).toEqual({
        codecId: 'pg/text@1',
        nativeType: 'text',
        nullable: false,
        typeRef: 'TId',
      });
    });

    it('diagnoses a generator on a codec outside its applicableCodecIds (Int @default(uuid()))', () => {
      const result = interpret(`model B {
  id Int @id @default(uuid())
}`);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_INVALID_DEFAULT_APPLICABILITY',
            sourceId: 'schema.prisma',
            message: expect.stringContaining('uuidv4'),
          }),
        ]),
      );
    });
  });
});
