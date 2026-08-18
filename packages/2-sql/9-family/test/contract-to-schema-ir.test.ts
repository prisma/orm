import {
  asNamespaceId,
  type ColumnDefault,
  type Contract,
  profileHash,
  type StorageHashBase,
} from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
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
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../1-core/contract/test/test-support';
import type { DefaultRenderer } from '../src/core/migrations/contract-to-schema-ir';
import {
  contractToSchemaIR as contractToSchemaIRImpl,
  detectDestructiveChanges,
} from '../src/core/migrations/contract-to-schema-ir';

const testRenderer: DefaultRenderer = (def: ColumnDefault, column: StorageColumn) => {
  if (def.kind === 'function') return def.expression;
  const { value } = def;
  if (typeof value === 'string') return `'${value.replaceAll("'", "''")}'`;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null) return 'NULL';
  const json = JSON.stringify(value);
  const isJsonColumn = column.nativeType === 'json' || column.nativeType === 'jsonb';
  if (isJsonColumn) return `'${json}'::${column.nativeType}`;
  return `'${json}'`;
};

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

function col(overrides: Partial<StorageColumn> & { nativeType: string }): StorageColumn {
  return {
    codecId: 'pg/text@1',
    nullable: false,
    many: false,
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
  options?: Omit<Parameters<typeof contractToSchemaIRImpl>[1], 'annotationNamespace'>,
): SqlSchemaIR {
  return contractToSchemaIRImpl(contract, { annotationNamespace: 'pg', ...options });
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
                  id: col({ nativeType: 'text' }),
                  email: col({ nativeType: 'text', nullable: false }),
                  name: col({ nativeType: 'text', nullable: true }),
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
                    nativeType: 'vector',
                    codecId: 'pgvector/vector@1',
                    typeParams: { dimensions: 1536 },
                  }),
                  b: col({
                    nativeType: 'vector',
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
          nativeType: 'vector',
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

  it('expands parameterized native types when expandNativeType is provided', () => {
    const storage = new SqlStorage({
      storageHash: 'test' as StorageHashBase<string>,
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: createTestSqlNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              T: table({
                columns: {
                  id: col({
                    nativeType: 'character',
                    codecId: 'sql/char@1',
                    typeParams: { length: 36 },
                  }),
                  name: col({ nativeType: 'text', codecId: 'pg/text@1' }),
                },
              }),
            },
          },
        }),
      },
    });

    const expand = (input: {
      nativeType: string;
      codecId?: string;
      typeParams?: Record<string, unknown>;
    }) => {
      if (input.typeParams && 'length' in input.typeParams) {
        return `${input.nativeType}(${input.typeParams['length']})`;
      }
      return input.nativeType;
    };

    const result = contractToSchemaIR(wrap(storage), {
      expandNativeType: expand,
      renderDefault: testRenderer,
    });
    expect(result.tables['T']!.columns['id']!.nativeType).toBe('character(36)');
    expect(result.tables['T']!.columns['name']!.nativeType).toBe('text');
  });

  it('resolves typeRef against storage.types before expanding native type', () => {
    // Regression: `post.embedding` in prisma-8-demo stores a bare
    // `{ nativeType: 'vector', typeRef: 'Embedding1536' }`; the parameter
    // metadata lives on the named `storage.types` entry. If the IR
    // conversion doesn't resolve `typeRef`, it emits `"vector"` while
    // `verify-sql-schema` resolves the ref and emits `"vector(1536)"`,
    // producing a spurious `type_mismatch` (and a spurious
    // `alterColumnType` op) when planning from one revision of the
    // contract to itself.
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
                    nativeType: 'vector',
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
          nativeType: 'vector',
          typeParams: { length: 1536 },
        },
      },
    });

    const expand = (input: {
      nativeType: string;
      codecId?: string;
      typeParams?: Record<string, unknown>;
    }) => {
      if (input.typeParams && 'length' in input.typeParams) {
        return `${input.nativeType}(${input.typeParams['length']})`;
      }
      return input.nativeType;
    };

    const result = contractToSchemaIR(wrap(storage), {
      expandNativeType: expand,
      renderDefault: testRenderer,
    });

    expect(result.tables['Post']!.columns['embedding']!.nativeType).toBe('vector(1536)');
  });

  it('uses base nativeType when no expandNativeType is provided', () => {
    const storage = new SqlStorage({
      storageHash: 'test' as StorageHashBase<string>,
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: createTestSqlNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              T: table({
                columns: {
                  id: col({
                    nativeType: 'character',
                    codecId: 'sql/char@1',
                    typeParams: { length: 36 },
                  }),
                },
              }),
            },
          },
        }),
      },
    });

    const result = contractToSchemaIR(wrap(storage), { renderDefault: testRenderer });
    expect(result.tables['T']!.columns['id']!.nativeType).toBe('character');
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
                    nativeType: 'text',
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
                    nativeType: 'text',
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
                    nativeType: 'text',
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
                    nativeType: 'timestamptz',
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
                  name: col({ nativeType: 'text' }),
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
                  id: col({ nativeType: 'text' }),
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
                  email: col({ nativeType: 'text' }),
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
                  email: col({ nativeType: 'text' }),
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
                  email: col({ nativeType: 'text' }),
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
                  id: col({ nativeType: 'text' }),
                  email: col({ nativeType: 'text' }),
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
                  authorId: col({ nativeType: 'text' }),
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
                  id: col({ nativeType: 'text' }),
                  teamId: col({ nativeType: 'text' }),
                },
                primaryKey: { columns: ['id', 'teamId'] },
              }),
              WorkflowState: table({
                columns: {
                  workflowId: col({ nativeType: 'text' }),
                  teamId: col({ nativeType: 'text' }),
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
                columns: { id: col({ nativeType: 'text' }) },
              }),
              Post: table({
                columns: { id: col({ nativeType: 'text' }) },
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

  it('propagates storage types into annotations', () => {
    const storage = new SqlStorage({
      storageHash: 'test' as StorageHashBase<string>,
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: createTestSqlNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              T: table({
                columns: {
                  embedding: col({ nativeType: 'vector', typeRef: 'Embedding' }),
                },
              }),
            },
          },
        }),
      },
      types: {
        Embedding: {
          kind: 'codec-instance',
          codecId: 'pgvector/vector@1',
          nativeType: 'vector',
          typeParams: { dimensions: 1536 },
        },
      },
    });

    const result = contractToSchemaIR(wrap(storage), { renderDefault: testRenderer });
    expect(result.tables['T']!.columns['embedding']!.nativeType).toBe('vector');
    expect((result.annotations as Record<string, unknown>)?.['pg']).toMatchObject({
      storageTypes: {
        vector: {
          codecId: 'pgvector/vector@1',
          nativeType: 'vector',
          typeParams: { dimensions: 1536 },
        },
      },
    });
  });

  it('writes storage type annotations using the configured namespace', () => {
    const storage = new SqlStorage({
      storageHash: 'test' as StorageHashBase<string>,
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: createTestSqlNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              T: table({
                columns: {
                  embedding: col({ nativeType: 'vector', typeRef: 'Embedding' }),
                },
              }),
            },
          },
        }),
      },
      types: {
        Embedding: {
          kind: 'codec-instance',
          codecId: 'pgvector/vector@1',
          nativeType: 'vector',
          typeParams: { dimensions: 1536 },
        },
      },
    });

    const result = contractToSchemaIRImpl(wrap(storage), {
      annotationNamespace: 'custom',
    });
    expect((result.annotations as Record<string, unknown>)?.['custom']).toMatchObject({
      storageTypes: {
        vector: {
          codecId: 'pgvector/vector@1',
          nativeType: 'vector',
          typeParams: { dimensions: 1536 },
        },
      },
    });
    expect((result.annotations as Record<string, unknown>)?.['pg']).toBeUndefined();
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
                  a: col({ nativeType: 'text' }),
                  b: col({ nativeType: 'text' }),
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
                columns: { authorId: col({ nativeType: 'text' }) },
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
      columns: { authorId: col({ nativeType: 'text' }) },
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
          entries: { table: { User: table({ columns: { id: col({ nativeType: 'text' }) } }) } },
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
                columns: { id: col({ nativeType: 'text' }), slug: col({ nativeType: 'text' }) },
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
      T: table({ columns: { a: col({ nativeType: 'text' }) } }),
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
              T: table({ columns: { a: col({ nativeType: 'text' }) } }),
            },
          },
        }),
      },
    });
    expect(detectDestructiveChanges(storage, storage)).toEqual([]);
  });

  it('returns empty when columns are added', () => {
    const from = unboundStorage('test' as StorageHashBase<string>, {
      T: table({ columns: { a: col({ nativeType: 'text' }) } }),
    });
    const to = unboundStorage('test' as StorageHashBase<string>, {
      T: table({ columns: { a: col({ nativeType: 'text' }), b: col({ nativeType: 'text' }) } }),
    });
    expect(detectDestructiveChanges(from, to)).toEqual([]);
  });

  it('detects removed column', () => {
    const from = unboundStorage('test' as StorageHashBase<string>, {
      T: table({ columns: { a: col({ nativeType: 'text' }), b: col({ nativeType: 'text' }) } }),
    });
    const to = unboundStorage('test' as StorageHashBase<string>, {
      T: table({ columns: { a: col({ nativeType: 'text' }) } }),
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
      A: table({ columns: { id: col({ nativeType: 'text' }) } }),
      B: table({ columns: { id: col({ nativeType: 'text' }) } }),
    });
    const to = unboundStorage('test' as StorageHashBase<string>, {
      A: table({ columns: { id: col({ nativeType: 'text' }) } }),
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
        columns: { a: col({ nativeType: 'text' }), b: col({ nativeType: 'text' }) },
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
        columns: { id: col({ nativeType: 'text' }), name: col({ nativeType: 'text' }) },
      }),
      B: table({ columns: { id: col({ nativeType: 'text' }) } }),
    });
    const to = unboundStorage('test' as StorageHashBase<string>, {
      A: table({ columns: { id: col({ nativeType: 'text' }) } }),
    });

    const conflicts = detectDestructiveChanges(from, to);
    expect(conflicts).toHaveLength(2);
    const kinds = conflicts.map((c) => c.kind);
    expect(kinds).toContain('columnRemoved');
    expect(kinds).toContain('tableRemoved');
  });

  it('detects removed table with prototype-name identifier', () => {
    const from = unboundStorage('test' as StorageHashBase<string>, {
      toString: table({ columns: { id: col({ nativeType: 'text' }) } }),
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
          toString: col({ nativeType: 'text' }),
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
      T: table({ columns: { id: col({ nativeType: 'text' }) } }),
    });

    const result = contractToSchemaIR(wrap(storage), { renderDefault: testRenderer });
    expect(result.tables['T']!.columns['id']!.resolvedNativeType).toBe('text');
  });

  it('stamps the expanded type into resolvedNativeType when expandNativeType is provided', () => {
    const storage = unboundStorage('test' as StorageHashBase<string>, {
      T: table({
        columns: {
          id: col({ nativeType: 'character', codecId: 'sql/char@1', typeParams: { length: 36 } }),
        },
      }),
    });

    const result = contractToSchemaIR(wrap(storage), {
      expandNativeType: (input) =>
        input.typeParams && 'length' in input.typeParams
          ? `${input.nativeType}(${input.typeParams['length']})`
          : input.nativeType,
      renderDefault: testRenderer,
    });
    expect(result.tables['T']!.columns['id']!.resolvedNativeType).toBe('character(36)');
  });

  it('appends [] to resolvedNativeType for array columns', () => {
    const storage = unboundStorage('test' as StorageHashBase<string>, {
      T: table({
        columns: { tags: col({ nativeType: 'text', many: { elementNullable: false } }) },
      }),
    });

    const result = contractToSchemaIR(wrap(storage), { renderDefault: testRenderer });
    expect(result.tables['T']!.columns['tags']!.resolvedNativeType).toBe('text[]');
  });

  it('stamps the contract ColumnDefault into resolvedDefault', () => {
    const storage = unboundStorage('test' as StorageHashBase<string>, {
      T: table({
        columns: {
          status: col({ nativeType: 'text', default: { kind: 'literal', value: 'draft' } }),
          created: col({
            nativeType: 'timestamptz',
            default: { kind: 'function', expression: 'now()' },
          }),
          plain: col({ nativeType: 'text' }),
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
            nativeType: 'text',
            many: { elementNullable: false },
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
            columns: { status: col({ nativeType: 'text' }) },
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
