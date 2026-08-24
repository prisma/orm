import type { CodecLookup } from '@internal/framework-components/codec';
import type { TargetPackRef } from '@internal/framework-components/components';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { buildSqlContractFromDefinition } from '../src/contract-builder';
import { modelsOf } from './contract-test-helpers';
import { crossRef, documentScopedTypes } from './cross-ref-helpers';
import { unboundTables } from './unbound-tables';

const postgresTargetPack: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
};

describe('shared contract definition lowering', () => {
  it('builds SQL contract IR from contract model nodes', () => {
    const contract = buildSqlContractFromDefinition({
      warnings: undefined,
      target: postgresTargetPack,
      createNamespace: createTestSqlNamespace,
      storageTypes: {
        Role: {
          kind: 'codec-instance',
          codecId: 'app/test-enum@1',
          nativeType: 'role',
          typeParams: { values: ['USER', 'ADMIN'] },
        },
      },
      models: [
        {
          modelName: 'User',
          tableName: 'app_user',
          fields: [
            {
              fieldName: 'id',
              columnName: 'id',
              descriptor: {
                codecId: 'sql/char@1',
                nativeType: 'character',
                typeParams: { length: 36 },
              },
              nullable: false,
              executionDefaults: { onCreate: { kind: 'generator', id: 'uuidv4' } },
            },
            {
              fieldName: 'role',
              columnName: 'role',
              descriptor: {
                codecId: 'app/test-enum@1',
                nativeType: 'role',
                typeRef: 'Role',
              },
              nullable: false,
            },
          ],
          id: {
            columns: ['id'],
            name: 'app_user_pkey',
          },
          relations: [
            {
              fieldName: 'posts',
              toModel: 'Post',
              toTable: 'blog_post',
              cardinality: '1:N',
              on: {
                parentTable: 'app_user',
                parentColumns: ['id'],
                childTable: 'blog_post',
                childColumns: ['author_id'],
              },
            },
          ],
        },
        {
          modelName: 'Post',
          tableName: 'blog_post',
          fields: [
            {
              fieldName: 'id',
              columnName: 'id',
              descriptor: {
                codecId: 'pg/int4@1',
                nativeType: 'int4',
              },
              nullable: false,
            },
            {
              fieldName: 'authorId',
              columnName: 'author_id',
              descriptor: {
                codecId: 'sql/char@1',
                nativeType: 'character',
                typeParams: { length: 36 },
              },
              nullable: false,
            },
          ],
          id: {
            columns: ['id'],
            name: 'blog_post_pkey',
          },
          foreignKeys: [
            {
              columns: ['author_id'],
              references: {
                model: 'User',
                table: 'app_user',
                columns: ['id'],
              },
              name: 'blog_post_author_id_fkey',
            },
          ],
          relations: [
            {
              fieldName: 'author',
              toModel: 'User',
              toTable: 'app_user',
              cardinality: 'N:1',
              on: {
                parentTable: 'blog_post',
                parentColumns: ['author_id'],
                childTable: 'app_user',
                childColumns: ['id'],
              },
            },
          ],
        },
      ],
    });

    const models = modelsOf(contract) as Record<
      string,
      | {
          readonly storage: { readonly fields: Record<string, unknown> };
          readonly fields: Record<string, unknown>;
          readonly relations: Record<string, unknown>;
        }
      | undefined
    >;

    expect(documentScopedTypes(contract)?.['Role']).toEqual({
      kind: 'codec-instance',
      codecId: 'app/test-enum@1',
      nativeType: 'role',
      typeParams: { values: ['USER', 'ADMIN'] },
    });
    expect(unboundTables(contract.storage)['app_user']?.primaryKey).toEqual({
      columns: ['id'],
      name: 'app_user_pkey',
    });
    expect(unboundTables(contract.storage)['blog_post']?.foreignKeys).toEqual([
      {
        source: {
          namespaceId: 'public',
          tableName: 'blog_post',
          columns: ['author_id'],
        },
        target: { namespaceId: 'public', tableName: 'app_user', columns: ['id'] },
        name: 'blog_post_author_id_fkey',
      },
    ]);
    expect(unboundTables(contract.storage)['blog_post']?.indexes).toEqual([
      {
        name: 'blog_post_author_id_idx_f3862461',
        prefix: 'blog_post_author_id_idx',
        columns: ['author_id'],
        unique: false,
      },
    ]);
    expect(models['User']?.relations['posts']).toEqual({
      to: crossRef('Post', 'public'),
      cardinality: '1:N',
      on: {
        localFields: ['id'],
        targetFields: ['authorId'],
      },
    });
    expect(models['Post']?.storage.fields['authorId']).toEqual({
      column: 'author_id',
    });
  });

  it('encodes literal defaults through codecLookup during storage lowering', () => {
    const codecLookup: CodecLookup = {
      get: (id) => {
        if (id !== 'pg/timestamptz-temporal@1') {
          return undefined;
        }

        return {
          id,
          encode: async (value: unknown) => value,
          decode: async (wire: unknown) => wire,
          encodeJson: (value: unknown) =>
            value instanceof Date ? value.toISOString() : (value as string),
          decodeJson: (json: unknown) => new Date(json as string),
        };
      },
      targetTypesFor: (id) => (id === 'pg/timestamptz-temporal@1' ? ['timestamptz'] : undefined),
      renderOutputTypeFor: () => undefined,
    };

    const contract = buildSqlContractFromDefinition(
      {
        warnings: undefined,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        models: [
          {
            modelName: 'Event',
            tableName: 'event',
            fields: [
              {
                fieldName: 'scheduledAt',
                columnName: 'scheduled_at',
                descriptor: {
                  codecId: 'pg/timestamptz-temporal@1',
                  nativeType: 'timestamptz',
                },
                nullable: false,
                default: {
                  kind: 'literal',
                  value: new Date('2025-01-01T00:00:00.000Z'),
                },
              },
            ],
          },
        ],
      },
      codecLookup,
    );

    expect(unboundTables(contract.storage)['event']?.columns['scheduled_at']?.default).toEqual({
      kind: 'literal',
      value: '2025-01-01T00:00:00.000Z',
    });
  });

  it('builds phase-specific execution defaults', () => {
    const contract = buildSqlContractFromDefinition({
      warnings: undefined,
      target: postgresTargetPack,
      createNamespace: createTestSqlNamespace,
      models: [
        {
          modelName: 'User',
          tableName: 'app_user',
          fields: [
            {
              fieldName: 'updatedAt',
              columnName: 'updated_at',
              descriptor: {
                codecId: 'pg/timestamptz-temporal@1',
                nativeType: 'timestamptz',
              },
              nullable: false,
              executionDefaults: {
                onCreate: { kind: 'generator', id: 'timestampNow' },
                onUpdate: { kind: 'generator', id: 'timestampNow' },
              },
            },
          ],
        },
      ],
    });

    expect(contract.execution?.mutations.defaults).toEqual([
      {
        ref: { namespace: 'public', table: 'app_user', column: 'updated_at' },
        onCreate: { kind: 'generator', id: 'timestampNow' },
        onUpdate: { kind: 'generator', id: 'timestampNow' },
      },
    ]);
  });

  it('rejects generated fields that also declare storage defaults', () => {
    expect(() =>
      buildSqlContractFromDefinition({
        warnings: undefined,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        models: [
          {
            modelName: 'User',
            tableName: 'app_user',
            fields: [
              {
                fieldName: 'id',
                columnName: 'id',
                descriptor: {
                  codecId: 'pg/text@1',
                  nativeType: 'text',
                },
                nullable: false,
                default: {
                  kind: 'function',
                  expression: 'gen_random_uuid()',
                },
                executionDefaults: {
                  onCreate: {
                    kind: 'generator',
                    id: 'uuidv4',
                  },
                },
              },
            ],
          },
        ],
      }),
    ).toThrow('Field "User.id" cannot define both default and executionDefaults.');
  });

  it('default-and-executionDefaults rejection carries CONTRACT.DEFAULT_INVALID', () => {
    expect(() =>
      buildSqlContractFromDefinition({
        warnings: undefined,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        models: [
          {
            modelName: 'User',
            tableName: 'app_user',
            fields: [
              {
                fieldName: 'id',
                columnName: 'id',
                descriptor: {
                  codecId: 'pg/text@1',
                  nativeType: 'text',
                },
                nullable: false,
                default: {
                  kind: 'function',
                  expression: 'gen_random_uuid()',
                },
                executionDefaults: {
                  onCreate: {
                    kind: 'generator',
                    id: 'uuidv4',
                  },
                },
              },
            ],
          },
        ],
      }),
    ).toThrow(expect.objectContaining({ code: 'CONTRACT.DEFAULT_INVALID' }));
  });

  it('rejects a foreign key whose referenced table disagrees with the target model mapping', () => {
    const build = () =>
      buildSqlContractFromDefinition({
        warnings: undefined,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        models: [
          {
            modelName: 'User',
            tableName: 'app_user',
            fields: [
              {
                fieldName: 'id',
                columnName: 'id',
                descriptor: {
                  codecId: 'pg/int4@1',
                  nativeType: 'int4',
                },
                nullable: false,
              },
            ],
            id: { columns: ['id'] },
          },
          {
            modelName: 'Post',
            tableName: 'blog_post',
            fields: [
              {
                fieldName: 'id',
                columnName: 'id',
                descriptor: {
                  codecId: 'pg/int4@1',
                  nativeType: 'int4',
                },
                nullable: false,
              },
              {
                fieldName: 'authorId',
                columnName: 'author_id',
                descriptor: {
                  codecId: 'pg/int4@1',
                  nativeType: 'int4',
                },
                nullable: false,
              },
            ],
            id: { columns: ['id'] },
            foreignKeys: [
              {
                columns: ['author_id'],
                references: {
                  model: 'User',
                  table: 'wrong_table',
                  columns: ['id'],
                },
              },
            ],
          },
        ],
      });

    expect(build).toThrow(
      'Foreign key on model "Post" references table "wrong_table" but model "User" maps to "app_user"',
    );
    expect(build).toThrow(expect.objectContaining({ code: 'CONTRACT.TABLE_MISMATCH' }));
  });

  it('rejects generated fields that are still marked nullable', () => {
    expect(() =>
      buildSqlContractFromDefinition({
        warnings: undefined,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        models: [
          {
            modelName: 'User',
            tableName: 'app_user',
            fields: [
              {
                fieldName: 'id',
                columnName: 'id',
                descriptor: {
                  codecId: 'pg/text@1',
                  nativeType: 'text',
                },
                nullable: true,
                executionDefaults: {
                  onCreate: {
                    kind: 'generator',
                    id: 'uuidv4',
                  },
                },
              },
            ],
          },
        ],
      }),
    ).toThrow('Field "User.id" cannot be nullable when executionDefaults are present.');
  });

  it('rejects nullable identity fields', () => {
    expect(() =>
      buildSqlContractFromDefinition({
        warnings: undefined,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        models: [
          {
            modelName: 'User',
            tableName: 'app_user',
            fields: [
              {
                fieldName: 'id',
                columnName: 'id',
                descriptor: {
                  codecId: 'pg/int4@1',
                  nativeType: 'int4',
                },
                nullable: true,
              },
            ],
            id: {
              columns: ['id'],
            },
          },
        ],
      }),
    ).toThrow(
      /Contract semantic validation failed:.*primary key column "id".*primary key columns must be NOT NULL/,
    );
  });

  it('rejects a check on a model that shares its base table (STI variant backstop)', () => {
    expect(() =>
      buildSqlContractFromDefinition({
        warnings: undefined,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        models: [
          {
            modelName: 'Bug',
            tableName: 'task',
            sharesBaseTable: true,
            fields: [
              {
                fieldName: 'severity',
                columnName: 'severity',
                descriptor: { codecId: 'pg/text@1', nativeType: 'text' },
                nullable: true,
              },
            ],
            checks: [
              { expression: "severity <> ''", name: 'bug_severity_present', map: undefined },
            ],
          },
        ],
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.CHECK_ON_STI_VARIANT',
        meta: { tableName: 'task', modelName: 'Bug' },
      }),
    );
  });
});

describe('M:N through descriptor lowering', () => {
  const tagModel = (target: {
    id?: { columns: readonly string[] };
    uniques?: readonly { columns: readonly string[] }[];
  }) => ({
    modelName: 'Tag',
    tableName: 'tags',
    fields: [
      {
        fieldName: 'id',
        columnName: 'id',
        descriptor: { codecId: 'pg/int4@1', nativeType: 'int4' },
        nullable: false,
      },
      {
        fieldName: 'slug',
        columnName: 'slug',
        descriptor: { codecId: 'pg/text@1', nativeType: 'text' },
        nullable: false,
      },
    ],
    ...target,
  });

  const buildWithTag = (target: Parameters<typeof tagModel>[0]) =>
    buildSqlContractFromDefinition({
      warnings: undefined,
      target: postgresTargetPack,
      createNamespace: createTestSqlNamespace,
      models: [
        {
          modelName: 'Post',
          tableName: 'posts',
          fields: [
            {
              fieldName: 'id',
              columnName: 'id',
              descriptor: { codecId: 'pg/int4@1', nativeType: 'int4' },
              nullable: false,
            },
          ],
          id: { columns: ['id'] },
          relations: [
            {
              fieldName: 'tags',
              toModel: 'Tag',
              toTable: 'tags',
              cardinality: 'N:M',
              on: {
                parentTable: 'posts',
                parentColumns: ['id'],
                childTable: 'tags',
                childColumns: ['id'],
              },
              through: {
                table: 'post_tags',
                parentColumns: ['post_id'],
                childColumns: ['tag_id'],
              },
            },
          ],
        },
        tagModel(target),
        {
          modelName: 'PostTag',
          tableName: 'post_tags',
          fields: [
            {
              fieldName: 'postId',
              columnName: 'post_id',
              descriptor: { codecId: 'pg/int4@1', nativeType: 'int4' },
              nullable: false,
            },
            {
              fieldName: 'tagId',
              columnName: 'tag_id',
              descriptor: { codecId: 'pg/int4@1', nativeType: 'int4' },
              nullable: false,
            },
          ],
          id: { columns: ['post_id', 'tag_id'] },
        },
      ],
    });

  const throughOf = (contract: ReturnType<typeof buildWithTag>) => {
    const models = modelsOf(contract) as Record<
      string,
      { readonly relations: Record<string, { readonly through?: { targetColumns: string[] } }> }
    >;
    return models['Post']!.relations['tags']!.through;
  };

  it('derives junction targetColumns from the target primary id', () => {
    const through = throughOf(buildWithTag({ id: { columns: ['id'] } }));
    expect(through?.targetColumns).toEqual(['id']);
  });

  it('falls back to the first unique constraint when the target has no primary id', () => {
    const through = throughOf(buildWithTag({ uniques: [{ columns: ['slug'] }] }));
    expect(through?.targetColumns).toEqual(['slug']);
  });

  it('throws when the target has neither a primary id nor a unique key', () => {
    expect(() => buildWithTag({})).toThrow(/no primary id or unique key/);
  });
});
