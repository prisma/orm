import {
  asNamespaceId,
  type ColumnDefault,
  type Contract,
  profileHash,
  type StorageHashBase,
} from '@internal/contract/types';
import type {
  AnyCodecDescriptor,
  CodecLookupWithDescriptors,
  DataType,
} from '@internal/framework-components/codec';
import { createDataTypeLookup, emptyCodecLookup } from '@internal/framework-components/codec';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { sqlDataType } from '@internal/sql-contract/data-type';
import {
  CheckConstraint,
  Index,
  indexInputFromSerialized,
  type SerializedIndex,
  SqlStorage,
  type StorageColumn,
  type StorageTable,
} from '@internal/sql-contract/types';
import { computeCheckContentHash } from '@internal/sql-schema-ir/naming';
import {
  PrimaryKey,
  SqlCheckConstraintIR,
  SqlColumnIR,
  SqlForeignKeyIR,
  SqlIndexIR,
  SqlSchemaIR,
  SqlUniqueIR,
} from '@internal/sql-schema-ir/types';
import { applicationDomainOf } from '@repo/test-utils';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../1-core/contract/test/test-support';
import type { DefaultRenderer } from '../src/core/migrations/contract-to-schema-ir';
import {
  contractToSchemaIR as contractToSchemaIRImpl,
  detectDestructiveChanges,
} from '../src/core/migrations/contract-to-schema-ir';

const testRenderer: DefaultRenderer = (def: ColumnDefault, _column, { baseTypeName }) => {
  if (def.kind === 'function') return def.expression;
  const { value } = def;
  if (typeof value === 'string') return `'${value.replaceAll("'", "''")}'`;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null) return 'NULL';
  const json = JSON.stringify(value);
  if (baseTypeName === 'json' || baseTypeName === 'jsonb') return `'${json}'::${baseTypeName}`;
  return `'${json}'`;
};

const textType = sqlDataType('test/text', { texts: [{ text: 'text', written: true }] });
const characterType = sqlDataType('test/character', {
  params: type({ 'length?': 'number.integer >= 1' }),
  texts: [
    { text: 'character', written: true },
    { text: 'character({length})', written: true },
  ],
});
const vectorType = sqlDataType('test/vector', {
  params: type({ length: 'number.integer >= 1' }),
  texts: [{ text: 'vector({length})', written: true }],
});
const bareVectorType = sqlDataType('test/bare-vector', {
  texts: [{ text: 'vector', written: true }],
});
const timestamptzType = sqlDataType('test/timestamptz', {
  texts: [{ text: 'timestamptz', written: true }],
});
const numericType = sqlDataType('test/numeric', {
  params: type({ 'precision?': 'number.integer >= 1', 'scale?': 'number.integer' }),
  texts: [
    { text: 'numeric', written: true },
    { text: 'numeric({precision})', written: true },
    { text: 'numeric({precision},{scale})', written: true },
  ],
  normalize: (params) =>
    params.precision !== undefined && params.scale === undefined ? { ...params, scale: 0 } : params,
});
const fixedCharacterType = sqlDataType('test/fixed-character', {
  params: type({ 'length?': 'number.integer >= 1' }),
  texts: [
    { text: 'character', written: true },
    { text: 'character({length})', written: true },
  ],
  normalize: (params) => (params.length === undefined ? { ...params, length: 1 } : params),
});
const enumType = sqlDataType('test/enum', {
  params: type({ typeName: 'string > 0' }),
  claimsKind: 'enum',
  render: ({ typeName }) => `"${typeName}"`,
});

const dataTypeOfCodec: Readonly<Record<string, DataType>> = {
  'pg/text@1': textType,
  'sql/char@1': characterType,
  'pg/vector@1': vectorType,
  'pgvector/vector@1': bareVectorType,
  'pg/timestamptz@1': timestamptzType,
  'pg/numeric@1': numericType,
  'pg/char@1': fixedCharacterType,
  'pg/enum@1': enumType,
};

const testCodecLookup: CodecLookupWithDescriptors = {
  ...emptyCodecLookup,
  descriptorFor: (id) => {
    const dataType = dataTypeOfCodec[id];
    return dataType === undefined
      ? undefined
      : ({ codecId: id, dataType: dataType.id } as AnyCodecDescriptor);
  },
};

function dataTypeOf(codecId: string): string {
  const dataType = testCodecLookup.descriptorFor?.(codecId)?.dataType;
  if (dataType === undefined) throw new Error(`the test codec lookup has no codec ${codecId}`);
  return dataType;
}

const testDataTypes = createDataTypeLookup([
  textType,
  characterType,
  vectorType,
  bareVectorType,
  timestamptzType,
  numericType,
  fixedCharacterType,
  enumType,
]);

function wrap(storage: SqlStorage): Contract<SqlStorage> {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('test'),
    storage,
    domain: applicationDomainOf({ models: {} }),
    roots: {},
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

function col(overrides: Partial<StorageColumn>): StorageColumn {
  const codecId = overrides.codecId ?? 'pg/text@1';
  return {
    codecId,
    dataType: overrides.dataType ?? dataTypeOf(codecId),
    nullable: false,
    ...overrides,
  };
}

function serializedIndex(flat: SerializedIndex): Index {
  return new Index(indexInputFromSerialized(flat));
}

function table(
  overrides: Partial<StorageTable> & { columns: Record<string, StorageColumn> },
): StorageTable {
  return {
    uniques: [],
    indexes: [],
    foreignKeys: [],
    ...overrides,
  };
}

function unboundStorage(
  storageHash: StorageHashBase<string>,
  tables: Record<string, StorageTable>,
): SqlStorage {
  return new SqlStorage({
    storageHash,
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: createTestSqlNamespace({
        id: UNBOUND_NAMESPACE_ID,
        entries: { table: tables },
      }),
    },
  });
}

function contractToSchemaIR(
  contract: Contract<SqlStorage> | null,
  options?: Pick<Parameters<typeof contractToSchemaIRImpl>[1], 'renderDefault' | 'resolveDefault'>,
): SqlSchemaIR {
  return contractToSchemaIRImpl(contract, {
    annotationNamespace: 'pg',
    dataTypeLookup: testDataTypes,
    codecLookup: testCodecLookup,
    ...options,
  });
}

describe('contractToSchemaIR', () => {
  it('converts empty storage to empty schema IR', () => {
    const result = contractToSchemaIR(null, { renderDefault: testRenderer });

    expect(result).toEqual<SqlSchemaIR>(new SqlSchemaIR({ tables: {} }));
  });

  it('converts a single table with columns', () => {
    const storage = new SqlStorage({
      storageHash: 'test' as StorageHashBase<string>,
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: createTestSqlNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              User: table({
                columns: {
                  id: col({}),
                  email: col({ nullable: false }),
                  name: col({ nullable: true }),
                },
              }),
            },
          },
        }),
      },
    });

    const result = contractToSchemaIR(wrap(storage), { renderDefault: testRenderer });

    expect(result.tables['User']).toBeDefined();
    expect(result.tables['User']!.name).toBe('User');

    const columns = result.tables['User']!.columns;
    expect(columns['id']).toEqual(
      new SqlColumnIR({
        name: 'id',
        nativeType: 'text',
        nullable: false,
        resolvedNativeType: 'text',
      }),
    );
    expect(columns['email']).toEqual(
      new SqlColumnIR({
        name: 'email',
        nativeType: 'text',
        nullable: false,
        resolvedNativeType: 'text',
      }),
    );
    expect(columns['name']).toEqual(
      new SqlColumnIR({
        name: 'name',
        nativeType: 'text',
        nullable: true,
        resolvedNativeType: 'text',
      }),
    );
  });

  it('drops codecId, typeParams, and typeRef from columns', () => {
    const storage = new SqlStorage({
      storageHash: 'test' as StorageHashBase<string>,
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: createTestSqlNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              T: table({
                columns: {
                  a: col({
                    codecId: 'pgvector/vector@1',
                    typeParams: { dimensions: 1536 },
                  }),
                  b: col({
                    codecId: 'pgvector/vector@1',
                    typeRef: 'MyVector',
                  }),
                },
              }),
            },
          },
        }),
      },
      types: {
        MyVector: {
          kind: 'codec-instance',
          codecId: 'pgvector/vector@1',
          dataType: 'pgvector/vector',
          typeParams: { dimensions: 1536 },
        },
      },
    });

    const result = contractToSchemaIR(wrap(storage), { renderDefault: testRenderer });
    const columnA = result.tables['T']!.columns['a']!;
    const columnB = result.tables['T']!.columns['b']!;

    expect(columnA).toEqual(
      new SqlColumnIR({
        name: 'a',
        nativeType: 'vector',
        nullable: false,
        resolvedNativeType: 'vector',
      }),
    );
    expect('codecId' in columnA).toBe(false);
    expect('typeParams' in columnA).toBe(false);
    expect('typeRef' in columnA).toBe(false);
    expect(columnB).toEqual(
      new SqlColumnIR({
        name: 'b',
        nativeType: 'vector',
        nullable: false,
        resolvedNativeType: 'vector',
      }),
    );
    expect('codecId' in columnB).toBe(false);
    expect('typeParams' in columnB).toBe(false);
    expect('typeRef' in columnB).toBe(false);
  });

  it('writes each column type from its codec data type and parameters', () => {
    const storage = unboundStorage('test' as StorageHashBase<string>, {
      T: table({
        columns: {
          id: col({ codecId: 'sql/char@1', typeParams: { length: 36 } }),
          code: col({ codecId: 'sql/char@1' }),
          name: col({ codecId: 'pg/text@1' }),
        },
      }),
    });

    const columns = contractToSchemaIR(wrap(storage)).tables['T']!.columns;
    expect({
      id: columns['id']!.nativeType,
      code: columns['code']!.nativeType,
      name: columns['name']!.nativeType,
    }).toEqual({ id: 'character(36)', code: 'character', name: 'text' });
  });

  it('writes each column type with its parameters in normal form, as the catalog reports them', () => {
    const storage = unboundStorage('test' as StorageHashBase<string>, {
      T: table({
        columns: {
          whole: col({ codecId: 'pg/numeric@1', typeParams: { precision: 10 } }),
          scaled: col({ codecId: 'pg/numeric@1', typeParams: { precision: 10, scale: 2 } }),
          bare: col({ codecId: 'pg/char@1' }),
        },
      }),
    });

    const columns = contractToSchemaIR(wrap(storage)).tables['T']!.columns;
    expect(
      Object.fromEntries(
        Object.entries(columns).map(([name, column]) => [
          name,
          { nativeType: column.nativeType, resolvedNativeType: column.resolvedNativeType },
        ]),
      ),
    ).toEqual({
      whole: { nativeType: 'numeric(10,0)', resolvedNativeType: 'numeric(10,0)' },
      scaled: { nativeType: 'numeric(10,2)', resolvedNativeType: 'numeric(10,2)' },
      bare: { nativeType: 'character(1)', resolvedNativeType: 'character(1)' },
    });
  });

  it('writes an enum column as its type name, unquoted', () => {
    const storage = unboundStorage('test' as StorageHashBase<string>, {
      T: table({
        columns: {
          mood: col({ codecId: 'pg/enum@1', typeParams: { typeName: 'Mood' } }),
        },
      }),
    });

    const mood = contractToSchemaIR(wrap(storage)).tables['T']!.columns['mood']!;
    expect({ nativeType: mood.nativeType, resolvedNativeType: mood.resolvedNativeType }).toEqual({
      nativeType: 'Mood',
      resolvedNativeType: 'Mood',
    });
  });

  it('refuses a column whose codec the stack does not register', () => {
    const storage = unboundStorage('test' as StorageHashBase<string>, {
      T: table({ columns: { id: col({ codecId: 'test/unknown@1', dataType: 'test/unknown' }) } }),
    });

    expect(() => contractToSchemaIR(wrap(storage))).toThrow(
      expect.objectContaining({ code: 'CONTRACT.CODEC_DESCRIPTOR_MISSING' }),
    );
  });

  it('resolves typeRef against storage.types before writing the type', () => {
    const storage = new SqlStorage({
      storageHash: 'test' as StorageHashBase<string>,
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: createTestSqlNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              Post: table({
                columns: {
                  embedding: col({
                    dataType: 'pgvector/vector',
                    codecId: 'pg/vector@1',
                    nullable: true,
                    typeRef: 'Embedding1536',
                  }),
                },
              }),
            },
          },
        }),
      },
      types: {
        Embedding1536: {
          kind: 'codec-instance',
          codecId: 'pg/vector@1',
          dataType: 'pgvector/vector',
          typeParams: { length: 1536 },
        },
      },
    });

    const result = contractToSchemaIR(wrap(storage), { renderDefault: testRenderer });

    expect(result.tables['Post']!.columns['embedding']!.nativeType).toBe('vector(1536)');
  });

  it('converts literal column defaults', () => {
    const storage = new SqlStorage({
      storageHash: 'test' as StorageHashBase<string>,
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: createTestSqlNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              T: table({
                columns: {
                  status: col({
                    default: { kind: 'literal', value: 'active' },
                  }),
                },
              }),
            },
          },
        }),
      },
    });

    const result = contractToSchemaIR(wrap(storage), { renderDefault: testRenderer });
    expect(result.tables['T']!.columns['status']!.default).toBe("'active'");
  });

  it('escapes single quotes in string literal defaults', () => {
    const storage = new SqlStorage({
      storageHash: 'test' as StorageHashBase<string>,
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: createTestSqlNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              T: table({
                columns: {
                  author: col({
                    default: { kind: 'literal', value: "O'Reilly" },
                  }),
                },
              }),
            },
          },
        }),
      },
    });

    const result = contractToSchemaIR(wrap(storage), { renderDefault: testRenderer });
    expect(result.tables['T']!.columns['author']!.default).toBe("'O''Reilly'");
  });

  it('escapes repeated single quotes in string literal defaults', () => {
    const storage = new SqlStorage({
      storageHash: 'test' as StorageHashBase<string>,
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: createTestSqlNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              T: table({
                columns: {
                  textValue: col({
                    default: { kind: 'literal', value: "a'b''c" },
                  }),
                },
              }),
            },
          },
        }),
      },
    });

    const result = contractToSchemaIR(wrap(storage), { renderDefault: testRenderer });
    expect(result.tables['T']!.columns['textValue']!.default).toBe("'a''b''''c'");
  });

  it('converts function column defaults', () => {
    const storage = new SqlStorage({
      storageHash: 'test' as StorageHashBase<string>,
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: createTestSqlNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              T: table({
                columns: {
                  createdAt: col({
                    default: { kind: 'function', expression: 'now()' },
                  }),
                },
              }),
            },
          },
        }),
      },
    });

    const result = contractToSchemaIR(wrap(storage), { renderDefault: testRenderer });
    expect(result.tables['T']!.columns['createdAt']!.default).toBe('now()');
  });

  it('omits default field when column has no default', () => {
    const storage = new SqlStorage({
      storageHash: 'test' as StorageHashBase<string>,
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: createTestSqlNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              T: table({
                columns: {
                  name: col({}),
                },
              }),
            },
          },
        }),
      },
    });

    const result = contractToSchemaIR(wrap(storage), { renderDefault: testRenderer });
    expect(result.tables['T']!.columns['name']!.default).toBeUndefined();
    expect('default' in result.tables['T']!.columns['name']!).toBe(false);
  });

  it('converts primary key', () => {
    const storage = new SqlStorage({
      storageHash: 'test' as StorageHashBase<string>,
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: createTestSqlNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              T: table({
                columns: {
                  id: col({}),
                },
                primaryKey: { columns: ['id'], name: 'T_pkey' },
              }),
            },
          },
        }),
      },
    });

    const result = contractToSchemaIR(wrap(storage), { renderDefault: testRenderer });
    expect(result.tables['T']!.primaryKey).toEqual(
      new PrimaryKey({ columns: ['id'], name: 'T_pkey' }),
    );
  });

  it('converts unique constraints', () => {
    const storage = new SqlStorage({
      storageHash: 'test' as StorageHashBase<string>,
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: createTestSqlNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              T: table({
                columns: {
                  email: col({}),
                },
                uniques: [{ columns: ['email'], name: 'T_email_key' }],
              }),
            },
          },
        }),
      },
    });

    const result = contractToSchemaIR(wrap(storage), { renderDefault: testRenderer });
    expect(result.tables['T']!.uniques).toEqual([
      new SqlUniqueIR({ columns: ['email'], name: 'T_email_key' }),
    ]);
  });

  it('converts indexes with unique: false', () => {
    const storage = new SqlStorage({
      storageHash: 'test' as StorageHashBase<string>,
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: createTestSqlNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              T: table({
                columns: {
                  email: col({}),
                },
                indexes: [
                  serializedIndex({ columns: ['email'], name: 'T_email_idx', unique: false }),
                ],
              }),
            },
          },
        }),
      },
    });

    const result = contractToSchemaIR(wrap(storage), { renderDefault: testRenderer });
    expect(result.tables['T']!.indexes).toEqual([
      new SqlIndexIR({
        naming: { kind: 'exact', name: 'T_email_idx' },
        columns: ['email'],
        where: undefined,
        unique: false,
        partial: false,
        type: undefined,
        options: undefined,
        annotations: undefined,
        dependsOn: undefined,
      }),
    ]);
  });

  it('passes unique, prefix, and where through and derives partial from where', () => {
    const storage = new SqlStorage({
      storageHash: 'test' as StorageHashBase<string>,
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: createTestSqlNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              T: table({
                columns: {
                  email: col({}),
                },
                indexes: [
                  serializedIndex({
                    name: 'T_email_idx_deadbeef',
                    prefix: 'T_email_idx',
                    columns: ['email'],
                    where: 'email IS NOT NULL',
                    unique: true,
                  }),
                ],
              }),
            },
          },
        }),
      },
    });

    const result = contractToSchemaIR(wrap(storage), { renderDefault: testRenderer });
    const idx = result.tables['T']!.indexes[0]!;
    expect(idx).toEqual(
      new SqlIndexIR({
        naming: { kind: 'wire', prefix: 'T_email_idx', hash: 'deadbeef' },
        columns: ['email'],
        where: 'email IS NOT NULL',
        unique: true,
        partial: true,
        type: undefined,
        options: undefined,
        annotations: undefined,
        dependsOn: undefined,
      }),
    );
    expect(idx.partial).toBe(true);
  });

  it('derives an expression index with dependsOn chains to every column of its table', () => {
    const storage = new SqlStorage({
      storageHash: 'test' as StorageHashBase<string>,
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: createTestSqlNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              T: table({
                columns: {
                  id: col({}),
                  email: col({}),
                },
                indexes: [
                  serializedIndex({
                    name: 'T_email_eq',
                    expression: 'lower(email)',
                    unique: false,
                  }),
                ],
              }),
            },
          },
        }),
      },
    });

    const result = contractToSchemaIR(wrap(storage), { renderDefault: testRenderer });
    const idx = result.tables['T']!.indexes[0]!;
    expect(idx.expression).toBe('lower(email)');
    expect(idx.columns).toBeUndefined();
    expect(idx.partial).toBe(false);
    // Deterministic over-approximation: the opaque expression is never
    // parsed, so the chains cover every column of the table.
    expect(idx.dependsOn).toEqual([
      [
        { nodeKind: 'sql-schema', id: 'database' },
        { nodeKind: 'sql-table', id: 'T' },
        { nodeKind: 'sql-column', id: 'column:id' },
      ],
      [
        { nodeKind: 'sql-schema', id: 'database' },
        { nodeKind: 'sql-table', id: 'T' },
        { nodeKind: 'sql-column', id: 'column:email' },
      ],
    ]);
  });

  it('converts foreign keys (reshapes references)', () => {
    const storage = new SqlStorage({
      storageHash: 'test' as StorageHashBase<string>,
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: createTestSqlNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              Post: table({
                columns: {
                  authorId: col({}),
                },
                foreignKeys: [
                  {
                    source: {
                      namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
                      tableName: 'Post',
                      columns: ['authorId'],
                    },
                    target: {
                      namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
                      tableName: 'User',
                      columns: ['id'],
                    },
                    name: 'Post_authorId_fkey',
                    onDelete: 'cascade',
                    onUpdate: 'restrict',
                  },
                ],
              }),
            },
          },
        }),
      },
    });

    const result = contractToSchemaIR(wrap(storage), { renderDefault: testRenderer });
    expect(result.tables['Post']!.foreignKeys).toEqual([
      new SqlForeignKeyIR({
        columns: ['authorId'],
        referencedTable: 'User',
        referencedColumns: ['id'],
        name: 'Post_authorId_fkey',
        onDelete: 'cascade',
        onUpdate: 'restrict',
      }),
    ]);
  });

  it('maps foreignKeys and indexes through 1:1 — materialization now happens upstream at contract emit, not here', () => {
    // Pre-FK1, `convertTable` synthesized backing indexes from `index: true`
    // FKs and dropped `constraint: false` FKs. FK1 moved that materialization
    // to `buildSqlContractFromDefinition` (contract-ts), so by the time a
    // contract reaches `contractToSchemaIR` its `foreignKeys[]` are already
    // constraint-only and its `indexes[]` already carry any FK-backing
    // entries. This asserts the new pass-through contract directly.
    const storage = new SqlStorage({
      storageHash: 'test' as StorageHashBase<string>,
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: createTestSqlNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              Workflow: table({
                columns: {
                  id: col({}),
                  teamId: col({}),
                },
                primaryKey: { columns: ['id', 'teamId'] },
              }),
              WorkflowState: table({
                columns: {
                  workflowId: col({}),
                  teamId: col({}),
                },
                indexes: [
                  serializedIndex({
                    columns: ['workflowId'],
                    name: 'WorkflowState_workflowId_idx',
                    unique: false,
                  }),
                ],
                foreignKeys: [
                  {
                    source: {
                      namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
                      tableName: 'WorkflowState',
                      columns: ['workflowId', 'teamId'],
                    },
                    target: {
                      namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
                      tableName: 'Workflow',
                      columns: ['id', 'teamId'],
                    },
                    name: 'workflow_state_workflow_team_fkey',
                    onDelete: 'cascade',
                  },
                ],
              }),
            },
          },
        }),
      },
    });

    const result = contractToSchemaIR(wrap(storage), { renderDefault: testRenderer });
    expect(result.tables['WorkflowState']!.foreignKeys).toEqual([
      new SqlForeignKeyIR({
        columns: ['workflowId', 'teamId'],
        referencedTable: 'Workflow',
        referencedColumns: ['id', 'teamId'],
        name: 'workflow_state_workflow_team_fkey',
        onDelete: 'cascade',
      }),
    ]);
    expect(result.tables['WorkflowState']!.indexes).toEqual([
      new SqlIndexIR({
        naming: { kind: 'exact', name: 'WorkflowState_workflowId_idx' },
        columns: ['workflowId'],
        where: undefined,
        unique: false,
        partial: false,
        type: undefined,
        options: undefined,
        annotations: undefined,
        dependsOn: undefined,
      }),
    ]);
  });

  it('converts multiple tables', () => {
    const storage = new SqlStorage({
      storageHash: 'test' as StorageHashBase<string>,
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: createTestSqlNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              User: table({
                columns: { id: col({}) },
              }),
              Post: table({
                columns: { id: col({}) },
              }),
            },
          },
        }),
      },
    });

    const result = contractToSchemaIR(wrap(storage), { renderDefault: testRenderer });
    expect(Object.keys(result.tables)).toEqual(expect.arrayContaining(['User', 'Post']));
    expect(Object.keys(result.tables)).toHaveLength(2);
  });

  it('writes no storage-type annotations', () => {
    const storage = new SqlStorage({
      storageHash: 'test' as StorageHashBase<string>,
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: createTestSqlNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              T: table({
                columns: {
                  embedding: col({
                    dataType: 'pgvector/vector',
                    codecId: 'pg/vector@1',
                    typeRef: 'Embedding',
                  }),
                },
              }),
            },
          },
        }),
      },
      types: {
        Embedding: {
          kind: 'codec-instance',
          codecId: 'pg/vector@1',
          dataType: 'pgvector/vector',
          typeParams: { length: 1536 },
        },
      },
    });

    const result = contractToSchemaIR(wrap(storage), { renderDefault: testRenderer });
    expect(result.tables['T']!.columns['embedding']!.nativeType).toBe('vector(1536)');
    expect(result.annotations).toBeUndefined();
  });

  it('handles unique constraints without names', () => {
    const storage = new SqlStorage({
      storageHash: 'test' as StorageHashBase<string>,
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: createTestSqlNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              T: table({
                columns: {
                  a: col({}),
                  b: col({}),
                },
                uniques: [{ columns: ['a', 'b'] }],
              }),
            },
          },
        }),
      },
    });

    const result = contractToSchemaIR(wrap(storage), { renderDefault: testRenderer });
    expect(result.tables['T']!.uniques[0]).toEqual(new SqlUniqueIR({ columns: ['a', 'b'] }));
  });

  it('handles foreign keys without names', () => {
    const storage = new SqlStorage({
      storageHash: 'test' as StorageHashBase<string>,
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: createTestSqlNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              Post: table({
                columns: { authorId: col({}) },
                foreignKeys: [
                  {
                    source: {
                      namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
                      tableName: 'Post',
                      columns: ['authorId'],
                    },
                    target: {
                      namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
                      tableName: 'User',
                      columns: ['id'],
                    },
                  },
                ],
              }),
            },
          },
        }),
      },
    });

    const result = contractToSchemaIR(wrap(storage), { renderDefault: testRenderer });
    expect(result.tables['Post']!.foreignKeys[0]).toEqual(
      new SqlForeignKeyIR({
        columns: ['authorId'],
        referencedTable: 'User',
        referencedColumns: ['id'],
      }),
    );
  });
});

describe('contractToSchemaIR — FK referenced-namespace identity', () => {
  function postTable(targetNamespaceId: string): StorageTable {
    return table({
      columns: { authorId: col({}) },
      foreignKeys: [
        {
          source: {
            namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
            tableName: 'Post',
            columns: ['authorId'],
          },
          target: {
            namespaceId: asNamespaceId(targetNamespaceId),
            tableName: 'User',
            columns: ['id'],
          },
          name: 'Post_authorId_fkey',
        },
      ],
    });
  }

  it('an FK targeting the unbound namespace derives with an absent referenced namespace', () => {
    const storage = new SqlStorage({
      storageHash: 'test' as StorageHashBase<string>,
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: createTestSqlNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: { table: { Post: postTable(UNBOUND_NAMESPACE_ID) } },
        }),
      },
    });

    const fk = contractToSchemaIR(wrap(storage)).tables['Post']!.foreignKeys[0]!;
    expect(fk.referencedSchema).toBeUndefined();
    expect(fk.resolvedReferencedNamespace).toBeUndefined();
    expect(fk.id).toBe('foreign-key:authorId->.User(id)');
  });

  it('an FK targeting a bound namespace derives its identity as before', () => {
    const storage = new SqlStorage({
      storageHash: 'test' as StorageHashBase<string>,
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: createTestSqlNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: { table: { Post: postTable('accounting') } },
        }),
        accounting: createTestSqlNamespace({
          id: 'accounting',
          entries: { table: { User: table({ columns: { id: col({}) } }) } },
        }),
      },
    });

    const fk = contractToSchemaIR(wrap(storage)).tables['Post']!.foreignKeys[0]!;
    expect(fk.referencedSchema).toBe('accounting');
    expect(fk.resolvedReferencedNamespace).toBe('accounting');
    expect(fk.id).toBe('foreign-key:authorId->accounting.User(id)');
  });

  it('an FK targeting a namespace absent from storage keeps its coordinate (cross-space)', () => {
    const storage = new SqlStorage({
      storageHash: 'test' as StorageHashBase<string>,
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: createTestSqlNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: { table: { Post: postTable('other_contract_ns') } },
        }),
      },
    });

    const fk = contractToSchemaIR(wrap(storage)).tables['Post']!.foreignKeys[0]!;
    expect(fk.referencedSchema).toBe('other_contract_ns');
    expect(fk.resolvedReferencedNamespace).toBe('other_contract_ns');
  });

  it('stamps dependsOn as the referenced table plus its own columns in the flat tree', () => {
    const storage = new SqlStorage({
      storageHash: 'test' as StorageHashBase<string>,
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: createTestSqlNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: { table: { Post: postTable(UNBOUND_NAMESPACE_ID) } },
        }),
      },
    });

    const fk = contractToSchemaIR(wrap(storage)).tables['Post']!.foreignKeys[0]!;
    expect(fk.dependsOn).toEqual([
      [
        { nodeKind: 'sql-schema', id: 'database' },
        { nodeKind: 'sql-table', id: 'User' },
      ],
      [
        { nodeKind: 'sql-schema', id: 'database' },
        { nodeKind: 'sql-table', id: 'Post' },
        { nodeKind: 'sql-column', id: 'column:authorId' },
      ],
    ]);
  });

  it('stamps own-column dependsOn on index, unique, and primary key in the flat tree', () => {
    const storage = new SqlStorage({
      storageHash: 'test' as StorageHashBase<string>,
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: createTestSqlNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              Widget: table({
                columns: { id: col({}), slug: col({}) },
                primaryKey: { columns: ['id'] },
                uniques: [{ columns: ['slug'] }],
                indexes: [
                  serializedIndex({ name: 'Widget_slug_idx', columns: ['slug'], unique: false }),
                ],
              }),
            },
          },
        }),
      },
    });

    const widget = contractToSchemaIR(wrap(storage)).tables['Widget']!;
    const pkCol = [
      { nodeKind: 'sql-schema', id: 'database' },
      { nodeKind: 'sql-table', id: 'Widget' },
      { nodeKind: 'sql-column', id: 'column:id' },
    ];
    const slugCol = [
      { nodeKind: 'sql-schema', id: 'database' },
      { nodeKind: 'sql-table', id: 'Widget' },
      { nodeKind: 'sql-column', id: 'column:slug' },
    ];
    expect(widget.primaryKey?.dependsOn).toEqual([pkCol]);
    expect(widget.uniques[0]?.dependsOn).toEqual([slugCol]);
    expect(widget.indexes[0]?.dependsOn).toEqual([slugCol]);
  });
});

describe('detectDestructiveChanges', () => {
  it('returns empty for null from', () => {
    const to = unboundStorage('test' as StorageHashBase<string>, {
      T: table({ columns: { a: col({}) } }),
    });
    expect(detectDestructiveChanges(null, to)).toEqual([]);
  });

  it('returns empty when no removals', () => {
    const storage = new SqlStorage({
      storageHash: 'test' as StorageHashBase<string>,
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: createTestSqlNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              T: table({ columns: { a: col({}) } }),
            },
          },
        }),
      },
    });
    expect(detectDestructiveChanges(storage, storage)).toEqual([]);
  });

  it('returns empty when columns are added', () => {
    const from = unboundStorage('test' as StorageHashBase<string>, {
      T: table({ columns: { a: col({}) } }),
    });
    const to = unboundStorage('test' as StorageHashBase<string>, {
      T: table({ columns: { a: col({}), b: col({}) } }),
    });
    expect(detectDestructiveChanges(from, to)).toEqual([]);
  });

  it('detects removed column', () => {
    const from = unboundStorage('test' as StorageHashBase<string>, {
      T: table({ columns: { a: col({}), b: col({}) } }),
    });
    const to = unboundStorage('test' as StorageHashBase<string>, {
      T: table({ columns: { a: col({}) } }),
    });

    const conflicts = detectDestructiveChanges(from, to);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toEqual({
      kind: 'columnRemoved',
      summary: 'Column "T"."b" was removed',
    });
  });

  it('detects removed table', () => {
    const from = unboundStorage('test' as StorageHashBase<string>, {
      A: table({ columns: { id: col({}) } }),
      B: table({ columns: { id: col({}) } }),
    });
    const to = unboundStorage('test' as StorageHashBase<string>, {
      A: table({ columns: { id: col({}) } }),
    });

    const conflicts = detectDestructiveChanges(from, to);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toEqual({
      kind: 'tableRemoved',
      summary: 'Table "B" was removed',
    });
  });

  it('does not report columns of a removed table individually', () => {
    const from = unboundStorage('test' as StorageHashBase<string>, {
      T: table({
        columns: { a: col({}), b: col({}) },
      }),
    });
    const to = unboundStorage('test' as StorageHashBase<string>, {});

    const conflicts = detectDestructiveChanges(from, to);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.kind).toBe('tableRemoved');
  });

  it('detects multiple removals', () => {
    const from = unboundStorage('test' as StorageHashBase<string>, {
      A: table({
        columns: { id: col({}), name: col({}) },
      }),
      B: table({ columns: { id: col({}) } }),
    });
    const to = unboundStorage('test' as StorageHashBase<string>, {
      A: table({ columns: { id: col({}) } }),
    });

    const conflicts = detectDestructiveChanges(from, to);
    expect(conflicts).toHaveLength(2);
    const kinds = conflicts.map((c) => c.kind);
    expect(kinds).toContain('columnRemoved');
    expect(kinds).toContain('tableRemoved');
  });

  it('detects removed table with prototype-name identifier', () => {
    const from = unboundStorage('test' as StorageHashBase<string>, {
      toString: table({ columns: { id: col({}) } }),
    });
    const to = unboundStorage('test' as StorageHashBase<string>, {});

    const conflicts = detectDestructiveChanges(from, to);
    expect(conflicts).toEqual([
      {
        kind: 'tableRemoved',
        summary: 'Table "toString" was removed',
      },
    ]);
  });

  it('detects removed column with prototype-name identifier', () => {
    const from = unboundStorage('test' as StorageHashBase<string>, {
      T: table({
        columns: {
          toString: col({}),
        },
      }),
    });
    const to = unboundStorage('test' as StorageHashBase<string>, {
      T: table({ columns: {} }),
    });

    const conflicts = detectDestructiveChanges(from, to);
    expect(conflicts).toEqual([
      {
        kind: 'columnRemoved',
        summary: 'Column "T"."toString" was removed',
      },
    ]);
  });
});

describe('contractToSchemaIR — resolved leaf values', () => {
  it('stamps resolvedNativeType equal to the computed native type', () => {
    const storage = unboundStorage('test' as StorageHashBase<string>, {
      T: table({ columns: { id: col({}) } }),
    });

    const result = contractToSchemaIR(wrap(storage), { renderDefault: testRenderer });
    expect(result.tables['T']!.columns['id']!.resolvedNativeType).toBe('text');
  });

  it('stamps the written type into resolvedNativeType', () => {
    const storage = unboundStorage('test' as StorageHashBase<string>, {
      T: table({
        columns: {
          id: col({ codecId: 'sql/char@1', typeParams: { length: 36 } }),
        },
      }),
    });

    const result = contractToSchemaIR(wrap(storage), { renderDefault: testRenderer });
    expect(result.tables['T']!.columns['id']!.resolvedNativeType).toBe('character(36)');
  });

  it('appends [] to resolvedNativeType for array columns', () => {
    const storage = unboundStorage('test' as StorageHashBase<string>, {
      T: table({ columns: { tags: col({ many: true }) } }),
    });

    const result = contractToSchemaIR(wrap(storage), { renderDefault: testRenderer });
    expect(result.tables['T']!.columns['tags']!.resolvedNativeType).toBe('text[]');
  });

  it('stamps the contract ColumnDefault into resolvedDefault', () => {
    const storage = unboundStorage('test' as StorageHashBase<string>, {
      T: table({
        columns: {
          status: col({ default: { kind: 'literal', value: 'draft' } }),
          created: col({
            default: { kind: 'function', expression: 'now()' },
          }),
          plain: col({}),
        },
      }),
    });

    const result = contractToSchemaIR(wrap(storage), { renderDefault: testRenderer });
    const columns = result.tables['T']!.columns;
    expect(columns['status']!.resolvedDefault).toEqual({ kind: 'literal', value: 'draft' });
    expect(columns['created']!.resolvedDefault).toEqual({ kind: 'function', expression: 'now()' });
    expect(columns['plain']!.resolvedDefault).toBeUndefined();
  });

  it('passes the raw default through resolveDefault when supplied', () => {
    // Without a target-supplied `resolveDefault`, the contract's raw
    // default becomes the resolved default unchanged — this is what a
    // target that never normalizes (e.g. one with no literal-vs-function
    // ambiguity in its default syntax) gets by omitting the hook. Proves
    // the hook actually runs, and runs with the resolved (`[]`-suffixed for
    // arrays) native type, not the base one.
    const storage = unboundStorage('test' as StorageHashBase<string>, {
      T: table({
        columns: {
          tags: col({
            many: true,
            default: { kind: 'function', expression: "'{}'::text[]" },
          }),
        },
      }),
    });

    const result = contractToSchemaIR(wrap(storage), {
      renderDefault: testRenderer,
      resolveDefault: (def, resolvedNativeType) =>
        def.kind === 'function' && resolvedNativeType === 'text[]'
          ? { kind: 'literal', value: [] }
          : def,
    });
    expect(result.tables['T']!.columns['tags']!.resolvedDefault).toEqual({
      kind: 'literal',
      value: [],
    });
  });

  it('check nodes pass naming and expression through unchanged', () => {
    const expression = `"status" IN ('draft', 'published')`;
    const hash = computeCheckContentHash(expression);
    const ns = createTestSqlNamespace({
      id: UNBOUND_NAMESPACE_ID,
      entries: {
        table: {
          T: table({
            columns: { status: col({}) },
            checks: [
              new CheckConstraint({
                naming: { kind: 'wire', prefix: 'T_status_check', hash },
                expression,
              }),
              new CheckConstraint({
                naming: { kind: 'exact', name: 'T_legacy_check' },
                expression: `"status" <> ''`,
              }),
            ],
          }),
        },
      },
    });
    const storage = new SqlStorage({
      storageHash: 'test' as StorageHashBase<string>,
      namespaces: { [UNBOUND_NAMESPACE_ID]: ns },
    });

    const result = contractToSchemaIR(wrap(storage), { renderDefault: testRenderer });
    expect(result.tables['T']!.checks).toEqual([
      new SqlCheckConstraintIR({
        naming: { kind: 'wire', prefix: 'T_status_check', hash },
        expression,
        dependsOn: undefined,
      }),
      new SqlCheckConstraintIR({
        naming: { kind: 'exact', name: 'T_legacy_check' },
        expression: `"status" <> ''`,
        dependsOn: undefined,
      }),
    ]);
    // Chains to every column of the table: the predicate is opaque, so the
    // derivation cannot know which columns it names. Without the edge a check
    // could be ordered after the drop of a column it depends on.
    expect(result.tables['T']!.checks?.[0]?.dependsOn).toEqual([
      [
        { nodeKind: 'sql-schema', id: 'database' },
        { nodeKind: 'sql-table', id: 'T' },
        { nodeKind: 'sql-column', id: 'column:status' },
      ],
    ]);
  });
});
