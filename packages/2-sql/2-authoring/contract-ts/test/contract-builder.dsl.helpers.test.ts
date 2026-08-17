import type { AuthoringFieldNamespace } from '@internal/framework-components/authoring';
import type {
  ExtensionPackRef,
  FamilyPackRef,
  TargetPackRef,
} from '@internal/framework-components/components';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { defineContract, rel } from '../src/contract-builder';
import { modelsOf } from './contract-test-helpers';
import { documentScopedTypes } from './cross-ref-helpers';
import { nanoidIdPresetMirror, nanoidPresetMirror } from './nanoid-preset-mirror';
import { sqlTimestampPresetMirror } from './temporal-preset-mirror';
import { unboundTables } from './unbound-tables';

type PortableSqlCodecTypes = {
  readonly 'app/test-enum@1': { output: string };
  readonly 'sql/char@1': { output: string };
  readonly 'sql/text@1': { output: string };
  readonly 'test/timestamp@1': { output: string };
};

const sqlFamilyPack = {
  kind: 'family',
  id: 'sql',
  familyId: 'sql',
  version: '0.0.1',
  authoring: {
    field: {
      text: {
        kind: 'fieldPreset',
        output: { codecId: 'sql/text@1', nativeType: 'text' },
      },
      portableTimestamp: {
        kind: 'fieldPreset',
        output: { codecId: 'test/timestamp@1', nativeType: 'timestamp' },
      },
      temporal: {
        // createdAt/updatedAt here are independent portable fixtures, NOT
        // mirrors of family-sql's `temporalAuthoringPresets` — that factory
        // hardcodes `now()` over a target codec, while these use the invented
        // portable `sql/timestamp@1` with `CURRENT_TIMESTAMP`. There is nothing
        // to anchor them to, by design. Only `timestamp` below mirrors a real
        // factory, and it is anchored.
        createdAt: {
          kind: 'fieldPreset',
          output: {
            codecId: 'test/timestamp@1',
            nativeType: 'timestamp',
            default: { kind: 'function', expression: 'CURRENT_TIMESTAMP' },
          },
        },
        updatedAt: {
          kind: 'fieldPreset',
          output: {
            codecId: 'test/timestamp@1',
            nativeType: 'timestamp',
            executionDefaults: {
              onCreate: { kind: 'generator', id: 'timestampNow' },
              onUpdate: { kind: 'generator', id: 'timestampNow' },
            },
          },
        },
        // From test/temporal-preset-mirror.ts, which family-sql's
        // temporal-codec-presets.test.ts asserts deep-equals the real factory
        // output — so a factory change cannot leave these tests passing
        // against a preset that no longer ships.
        timestamp: sqlTimestampPresetMirror,
      },
      uuidString: {
        kind: 'fieldPreset',
        output: {
          codecId: 'sql/char@1',
          nativeType: 'character',
          typeParams: { length: 36 },
        },
      },
      nanoid: nanoidPresetMirror,
      id: {
        uuidv4String: {
          kind: 'fieldPreset',
          output: {
            codecId: 'sql/char@1',
            nativeType: 'character',
            typeParams: { length: 36 },
            executionDefaults: { onCreate: { kind: 'generator', id: 'uuidv4' } },
            id: true,
          },
        },
        uuidv7String: {
          kind: 'fieldPreset',
          output: {
            codecId: 'sql/char@1',
            nativeType: 'character',
            typeParams: { length: 36 },
            executionDefaults: { onCreate: { kind: 'generator', id: 'uuidv7' } },
            id: true,
          },
        },
        nanoid: nanoidIdPresetMirror,
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
  authoring: {
    type: {
      enum: {
        kind: 'typeConstructor',
        args: [{ kind: 'string' }, { kind: 'stringArray' }],
        output: {
          codecId: 'app/test-enum@1',
          nativeType: 'enum',
          typeParams: {
            name: { kind: 'arg', index: 0 },
            values: { kind: 'arg', index: 1 },
          },
        },
      },
    },
  },
} as const satisfies TargetPackRef<'sql', 'postgres'> & {
  readonly __codecTypes?: PortableSqlCodecTypes;
};

const pgvectorExtensionPack = {
  kind: 'extension',
  id: 'pgvector',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  authoring: {
    type: {
      pgvector: {
        Vector: {
          kind: 'typeConstructor',
          args: [{ kind: 'number', name: 'length', integer: true, minimum: 1, maximum: 2000 }],
          output: {
            codecId: 'pg/vector@1',
            nativeType: 'vector',
            typeParams: {
              length: { kind: 'arg', index: 0 },
            },
          },
        },
      },
    },
  },
} as const satisfies ExtensionPackRef<'sql', 'postgres'>;

const roleTypes = {
  Role: {
    kind: 'codec-instance',
    codecId: 'app/test-enum@1',
    nativeType: 'role',
    typeParams: { values: ['USER', 'ADMIN'] },
  },
} as const;

function expectTypedFallbackWarnings(run: () => void, expectedFragments: readonly string[]): void {
  const emitWarning = vi.spyOn(process, 'emitWarning').mockImplementation(() => {});

  try {
    run();

    for (const fragment of expectedFragments) {
      expect(emitWarning).toHaveBeenCalledWith(
        expect.stringContaining(fragment),
        expect.objectContaining({
          code: 'PN_CONTRACT_TYPED_FALLBACK_AVAILABLE',
        }),
      );
    }
  } finally {
    emitWarning.mockRestore();
  }
}

function expectNoTypedFallbackWarnings(run: () => void): void {
  const emitWarning = vi.spyOn(process, 'emitWarning').mockImplementation(() => {});

  try {
    run();
    expect(emitWarning).not.toHaveBeenCalled();
  } finally {
    emitWarning.mockRestore();
  }
}

describe('contract DSL helper vocabulary', () => {
  it('lowers portable scalar helpers and explicit uuidv4 primary keys via factory callback', () => {
    const contract = defineContract(
      {
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
      },
      ({ field, model }) => ({
        models: {
          AuditEntry: model('AuditEntry', {
            fields: {
              id: field.id.uuidv4String({ name: 'audit_entry_pkey' }),
              actorId: field.uuidString().column('actor_id'),
              shortCode: field.nanoid({ size: 16 }).column('short_code'),
              email: field.text().unique({ name: 'audit_entry_email_key' }),
              createdAt: field.temporal.createdAt().column('created_at'),
              updatedAt: field.temporal.updatedAt().column('updated_at'),
              reviewedAt: field.portableTimestamp().optional().column('reviewed_at'),
            },
          }).sql({
            table: 'audit_entry',
          }),
        },
      }),
    );

    expect(unboundTables(contract.storage)['audit_entry']!.primaryKey).toEqual({
      columns: ['id'],
      name: 'audit_entry_pkey',
    });
    expect(unboundTables(contract.storage)['audit_entry']!.uniques).toEqual([
      {
        columns: ['email'],
        name: 'audit_entry_email_key',
      },
    ]);
    expect(unboundTables(contract.storage)['audit_entry']!.columns['id']).toMatchObject({
      codecId: 'sql/char@1',
      nativeType: 'character',
      nullable: false,
      typeParams: { length: 36 },
    });
    expect(unboundTables(contract.storage)['audit_entry']!.columns['email']).toMatchObject({
      codecId: 'sql/text@1',
      nativeType: 'text',
      nullable: false,
    });
    expect(unboundTables(contract.storage)['audit_entry']!.columns['short_code']).toMatchObject({
      codecId: 'sql/char@1',
      nativeType: 'character',
      nullable: false,
      typeParams: { length: 16 },
    });
    expect(unboundTables(contract.storage)['audit_entry']!.columns['created_at']).toMatchObject({
      codecId: 'test/timestamp@1',
      nativeType: 'timestamp',
      nullable: false,
      default: {
        kind: 'function',
        expression: 'CURRENT_TIMESTAMP',
      },
    });
    expect(unboundTables(contract.storage)['audit_entry']!.columns['reviewed_at']).toMatchObject({
      codecId: 'test/timestamp@1',
      nativeType: 'timestamp',
      nullable: true,
    });
    expect(contract.execution?.mutations.defaults).toEqual([
      {
        ref: { namespace: 'public', table: 'audit_entry', column: 'id' },
        onCreate: { kind: 'generator', id: 'uuidv4' },
      },
      {
        ref: { namespace: 'public', table: 'audit_entry', column: 'updated_at' },
        onCreate: { kind: 'generator', id: 'timestampNow' },
        onUpdate: { kind: 'generator', id: 'timestampNow' },
      },
    ]);
    expect(
      (modelsOf(contract) as Record<string, { storage: { fields: Record<string, unknown> } }>)[
        'AuditEntry'
      ]!.storage.fields['actorId'],
    ).toEqual({ column: 'actor_id' });
  });

  it('preserves literal codec ids for composed field helpers', () => {
    defineContract(
      {
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
      },
      ({ field }) => {
        const textState = field.text().build();
        const timestampState = field.portableTimestamp().build();
        const updatedAtState = field.temporal.updatedAt().build();
        const uuidState = field.uuidString().build();
        const nanoidState = field.nanoid({ size: 16 }).build();
        const uuidV4IdState = field.id.uuidv4String().build();
        const uuidV7IdState = field.id.uuidv7String().build();
        const nanoidIdState = field.id.nanoid({ size: 16 }).build();

        expectTypeOf(textState.descriptor?.codecId).toEqualTypeOf<'sql/text@1' | undefined>();
        expectTypeOf(timestampState.descriptor?.codecId).toEqualTypeOf<
          'test/timestamp@1' | undefined
        >();
        expectTypeOf(updatedAtState.descriptor?.codecId).toEqualTypeOf<
          'test/timestamp@1' | undefined
        >();
        expectTypeOf(uuidState.descriptor?.codecId).toEqualTypeOf<'sql/char@1' | undefined>();
        expectTypeOf(nanoidState.descriptor?.codecId).toEqualTypeOf<'sql/char@1' | undefined>();
        expectTypeOf(uuidV4IdState.descriptor?.codecId).toEqualTypeOf<'sql/char@1' | undefined>();
        expectTypeOf(uuidV7IdState.descriptor?.codecId).toEqualTypeOf<'sql/char@1' | undefined>();
        expectTypeOf(nanoidIdState.descriptor?.codecId).toEqualTypeOf<'sql/char@1' | undefined>();

        expect(uuidState.descriptor?.typeParams).toEqual({ length: 36 });
        expect(nanoidState.descriptor?.typeParams).toEqual({ length: 16 });
        expect(updatedAtState.executionDefaults).toEqual({
          onCreate: { kind: 'generator', id: 'timestampNow' },
          onUpdate: { kind: 'generator', id: 'timestampNow' },
        });
        expect(uuidV4IdState.executionDefaults).toEqual({
          onCreate: { kind: 'generator', id: 'uuidv4' },
        });
        expect(uuidV7IdState.executionDefaults).toEqual({
          onCreate: { kind: 'generator', id: 'uuidv7' },
        });
        expect(nanoidIdState.executionDefaults).toEqual({
          onCreate: {
            kind: 'generator',
            id: 'nanoid',
            params: { size: 16 },
          },
        });
        expect(uuidV4IdState.id).toEqual({});
        expect(uuidV7IdState.id).toEqual({});
        expect(nanoidIdState.id).toEqual({});

        return { models: {} };
      },
    );
  });

  it('supports trailing inline primary-key names on generated id helpers', () => {
    const contract = defineContract(
      {
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
      },
      ({ field, model }) => ({
        models: {
          ShortLink: model('ShortLink', {
            fields: {
              id: field.id.nanoid({ size: 16 }, { name: 'short_link_pkey' }),
              destination: field.text(),
            },
          }).sql({
            table: 'short_link',
          }),
        },
      }),
    );

    expect(unboundTables(contract.storage)['short_link']!.primaryKey).toEqual({
      columns: ['id'],
      name: 'short_link_pkey',
    });
    expect(unboundTables(contract.storage)['short_link']!.columns['id']).toMatchObject({
      codecId: 'sql/char@1',
      nativeType: 'character',
      typeParams: { length: 16 },
    });
    expect(contract.execution?.mutations.defaults).toEqual([
      {
        ref: { namespace: 'public', table: 'short_link', column: 'id' },
        onCreate: { kind: 'generator', id: 'nanoid', params: { size: 16 } },
      },
    ]);
  });

  it('accepts named storage type refs from the local types object', () => {
    const contract = defineContract(
      {
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
      },
      ({ field, model }) => ({
        types: roleTypes,
        models: {
          User: model('User', {
            fields: {
              role: field.namedType(roleTypes.Role),
            },
          }).sql({
            table: 'app_user',
          }),
        },
      }),
    );

    expect(unboundTables(contract.storage)['app_user']!.columns['role']).toMatchObject({
      codecId: 'app/test-enum@1',
      nativeType: 'role',
      nullable: false,
      typeRef: 'Role',
    });
  });

  it.each([
    {
      name: 'a string named type ref',
      run: () =>
        defineContract(
          {
            family: sqlFamilyPack,
            target: postgresTargetPack,
            createNamespace: createTestSqlNamespace,
          },
          ({ field, model }) => ({
            types: roleTypes,
            models: {
              User: model('User', {
                fields: {
                  role: field.namedType('Role'),
                },
              }).sql({
                table: 'app_user',
              }),
            },
          }),
        ),
      expectedFragments: [`field.namedType('Role')`],
    },
    {
      name: 'a string relation target',
      run: () =>
        defineContract(
          {
            family: sqlFamilyPack,
            target: postgresTargetPack,
            createNamespace: createTestSqlNamespace,
          },
          ({ field, model }) => {
            const User = model('User', {
              fields: {
                id: field.id.uuidv7String(),
              },
            }).sql({
              table: 'app_user',
            });

            return {
              models: {
                User,
                Post: model('Post', {
                  fields: {
                    id: field.id.uuidv7String(),
                    userId: field.uuidString(),
                  },
                  relations: {
                    user: rel.belongsTo('User', { from: 'userId', to: 'id' }),
                  },
                }).sql({
                  table: 'blog_post',
                }),
              },
            };
          },
        ),
      expectedFragments: [
        `rel.belongsTo('User', { from: 'userId', to: 'id' })`,
        `Use rel.belongsTo(User, { from: 'userId', to: 'id' })`,
      ],
    },
    {
      name: 'constraints.ref fallback',
      run: () =>
        defineContract(
          {
            family: sqlFamilyPack,
            target: postgresTargetPack,
            createNamespace: createTestSqlNamespace,
          },
          ({ field, model }) => {
            const User = model('User', {
              fields: {
                id: field.id.uuidv7String(),
              },
            }).sql({
              table: 'app_user',
            });

            return {
              models: {
                User,
                Post: model('Post', {
                  fields: {
                    id: field.id.uuidv7String(),
                    userId: field.uuidString(),
                  },
                }).sql(({ cols, constraints }) => ({
                  table: 'blog_post',
                  foreignKeys: [constraints.foreignKey(cols.userId, constraints.ref('User', 'id'))],
                })),
              },
            };
          },
        ),
      expectedFragments: [`constraints.ref('User', 'id')`, 'Use User.refs.id'],
    },
  ])('emits typed fallback guidance for $name', ({ run, expectedFragments }) => {
    expectTypedFallbackWarnings(run, expectedFragments);
  });

  it('does not warn when named storage types use the local types object directly', () => {
    expectNoTypedFallbackWarnings(() =>
      defineContract(
        {
          family: sqlFamilyPack,
          target: postgresTargetPack,
          createNamespace: createTestSqlNamespace,
        },
        ({ field, model }) => ({
          types: roleTypes,
          models: {
            User: model('User', {
              fields: {
                role: field.namedType(roleTypes.Role),
              },
            }).sql({
              table: 'app_user',
            }),
          },
        }),
      ),
    );
  });

  it('supports integrated contract callbacks with target-owned type helpers', () => {
    const contract = defineContract(
      {
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
      },
      ({ type, field, model }) => {
        const types = {
          Role: type.enum('role', ['USER', 'ADMIN'] as const),
        } as const;

        return {
          types,
          models: {
            User: model('User', {
              fields: {
                role: field.namedType(types.Role),
              },
            }).sql({
              table: 'app_user',
            }),
          },
        };
      },
    );

    expect(documentScopedTypes(contract)?.['Role']).toEqual({
      kind: 'codec-instance',
      codecId: 'app/test-enum@1',
      nativeType: 'enum',
      typeParams: { name: 'role', values: ['USER', 'ADMIN'] },
    });
    expect(unboundTables(contract.storage)['app_user']!.columns['role']).toMatchObject({
      codecId: 'app/test-enum@1',
      nativeType: 'enum',
      typeRef: 'Role',
    });
  });

  it('supports integrated contract callbacks with family-owned field presets', () => {
    const contract = defineContract(
      {
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
      },
      ({ field, model }) => ({
        models: {
          AuditEntry: model('AuditEntry', {
            fields: {
              id: field.id.uuidv7String().sql({ id: { name: 'audit_entry_pkey' } }),
              actorId: field.uuidString().sql({ column: 'actor_id' }),
              email: field
                .text()
                .unique()
                .sql({ unique: { name: 'audit_entry_email_key' } }),
              createdAt: field.temporal.createdAt().sql({ column: 'created_at' }),
            },
          }).sql({
            table: 'audit_entry',
          }),
        },
      }),
    );

    expect(unboundTables(contract.storage)['audit_entry']!.primaryKey).toEqual({
      columns: ['id'],
      name: 'audit_entry_pkey',
    });
    expect(unboundTables(contract.storage)['audit_entry']!.uniques).toEqual([
      {
        columns: ['email'],
        name: 'audit_entry_email_key',
      },
    ]);
    expect(unboundTables(contract.storage)['audit_entry']!.columns['actor_id']).toMatchObject({
      codecId: 'sql/char@1',
      nativeType: 'character',
      typeParams: { length: 36 },
    });
    expect(unboundTables(contract.storage)['audit_entry']!.columns['created_at']!.default).toEqual({
      kind: 'function',
      expression: 'CURRENT_TIMESTAMP',
    });
  });

  it('supports integrated contract callbacks with extension-owned type helpers', () => {
    const contract = defineContract(
      {
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        extensions: {
          pgvector: pgvectorExtensionPack,
        },
      },
      ({ type, field, model }) => {
        const types = {
          Embedding1536: type.pgvector.Vector(1536),
        } as const;

        return {
          types,
          models: {
            Document: model('Document', {
              fields: {
                embedding: field.namedType(types.Embedding1536),
              },
            }).sql({
              table: 'document',
            }),
          },
        };
      },
    );

    expect(documentScopedTypes(contract)?.['Embedding1536']).toEqual({
      kind: 'codec-instance',
      codecId: 'pg/vector@1',
      nativeType: 'vector',
      typeParams: { length: 1536 },
    });
    expect(unboundTables(contract.storage)['document']!.columns['embedding']).toMatchObject({
      codecId: 'pg/vector@1',
      nativeType: 'vector',
      typeRef: 'Embedding1536',
    });
  });

  it.each([
    {
      name: 'type helper names',
      conflictingPack: {
        kind: 'extension',
        id: 'conflicting-pack',
        familyId: 'sql',
        targetId: 'postgres',
        version: '0.0.1',
        authoring: {
          type: {
            enum: {
              kind: 'typeConstructor',
              args: [{ kind: 'string' }, { kind: 'stringArray' }],
              output: {
                codecId: 'conflict/enum@1',
                nativeType: 'enum',
                typeParams: {
                  name: { kind: 'arg', index: 0 },
                  values: { kind: 'arg', index: 1 },
                },
              },
            },
          },
        },
      } as const satisfies ExtensionPackRef<'sql', 'postgres'>,
      error: /Duplicate authoring type helper "enum"/,
    },
    {
      name: 'field helper names',
      conflictingPack: {
        kind: 'extension',
        id: 'conflicting-pack',
        familyId: 'sql',
        targetId: 'postgres',
        version: '0.0.1',
        authoring: {
          field: {
            text: {
              kind: 'fieldPreset',
              output: {
                codecId: 'conflict/text@1',
                nativeType: 'text',
              },
            },
          },
        },
      } as const satisfies ExtensionPackRef<'sql', 'postgres'>,
      error: /Duplicate authoring field helper "text"/,
    },
  ])('rejects duplicate authoring $name across composed packs', ({ conflictingPack, error }) => {
    expect(() =>
      defineContract(
        {
          family: sqlFamilyPack,
          target: postgresTargetPack,
          createNamespace: createTestSqlNamespace,
          extensions: {
            conflictingPack,
          },
        },
        () => ({
          models: {},
        }),
      ),
    ).toThrow(error);
  });

  it('rejects dangerous authoring field helper path segments across composed packs', () => {
    const maliciousFieldNamespace = JSON.parse(`
      {
        "__proto__": {
          "polluted": {
            "kind": "fieldPreset",
            "output": {
              "codecId": "conflict/text@1",
              "nativeType": "text"
            }
          }
        }
      }
    `) as AuthoringFieldNamespace;

    const maliciousPack = {
      kind: 'extension',
      id: 'malicious-pack',
      familyId: 'sql',
      targetId: 'postgres',
      version: '0.0.1',
      authoring: {
        field: maliciousFieldNamespace,
      },
    } as const satisfies ExtensionPackRef<'sql', 'postgres'>;

    try {
      expect(() =>
        defineContract(
          {
            family: sqlFamilyPack,
            target: postgresTargetPack,
            createNamespace: createTestSqlNamespace,
            extensions: {
              maliciousPack,
            },
          },
          () => ({
            models: {},
          }),
        ),
      ).toThrow(/Invalid authoring field helper "__proto__"/);
    } finally {
      delete (Object.prototype as Record<string, unknown>)['polluted'];
    }
  });

  it('resolves temporal.timestamp precision and phase tokens, incl. zero-arg and undefined-hole calls', () => {
    defineContract(
      {
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
      },
      ({ field }) => {
        const nowPhase = { kind: 'generator', id: 'timestampNow' };
        const fullState = field.temporal.timestamp(3, 'now', 'now').build();
        const zeroArgState = field.temporal.timestamp().build();
        const holeState = field.temporal.timestamp(undefined, undefined, 'now').build();

        expectTypeOf(fullState.descriptor?.codecId).toEqualTypeOf<'test/timestamp@1' | undefined>();

        expect(fullState.descriptor).toEqual({
          codecId: 'test/timestamp@1',
          nativeType: 'timestamp',
          typeParams: { precision: 3 },
        });
        expect(fullState.executionDefaults).toEqual({ onCreate: nowPhase, onUpdate: nowPhase });

        expect(zeroArgState.descriptor).toEqual({
          codecId: 'test/timestamp@1',
          nativeType: 'timestamp',
        });
        expect(zeroArgState.descriptor).not.toHaveProperty('typeParams');
        expect(zeroArgState.executionDefaults).toBeUndefined();

        expect(holeState.descriptor).not.toHaveProperty('typeParams');
        expect(holeState.executionDefaults).toEqual({ onUpdate: nowPhase });

        return { models: {} };
      },
    );
  });

  // A column with precision but deliberately no execution defaults — the
  // documented spelling for "timestamp column, no auto-update behavior".
  it('resolves temporal.timestamp(3) to a precision column with no execution defaults', () => {
    defineContract(
      {
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
      },
      ({ field }) => {
        const state = field.temporal.timestamp(3).build();

        expect(state.descriptor).toEqual({
          codecId: 'test/timestamp@1',
          nativeType: 'timestamp',
          typeParams: { precision: 3 },
        });
        expect(state.executionDefaults).toBeUndefined();

        return { models: {} };
      },
    );
  });

  it('regression: field.nanoid() is legal with zero args, resolving size to its declared default', () => {
    defineContract(
      {
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
      },
      ({ field }) => {
        const state = field.nanoid().build();
        expect(state.descriptor?.typeParams).toEqual({ length: 21 });
        return { models: {} };
      },
    );
  });

  it('regression: field.id.nanoid({size}, {name}) still resolves via the named-constraint overload', () => {
    const contract = defineContract(
      {
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
      },
      ({ field, model }) => ({
        models: {
          ShortLink: model('ShortLink', {
            fields: {
              id: field.id.nanoid({ size: 16 }, { name: 'short_link_pkey' }),
            },
          }).sql({
            table: 'short_link',
          }),
        },
      }),
    );

    expect(unboundTables(contract.storage)['short_link']!.primaryKey).toEqual({
      columns: ['id'],
      name: 'short_link_pkey',
    });
    expect(unboundTables(contract.storage)['short_link']!.columns['id']).toMatchObject({
      typeParams: { length: 16 },
    });
  });
});
