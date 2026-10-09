import { coreHash, profileHash } from '@internal/contract/types';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { renderFullTextIndexDocument } from '../../src/core/full-text-search-document';
import { contractToPostgresDatabaseSchemaNode } from '../../src/core/migrations/contract-to-postgres-database-schema-node';
import { type PostgresContract, PostgresSchema } from '../../src/core/postgres-schema';
import { postgresRenderDefault } from '../../src/exports/control';
import { postgresTypeLookups } from '../postgres-type-lookups';

const fullTextOptions = {
  weightGroups: [['title', 'subtitle'], ['body']],
  language: 'english',
} as const;

function contractWithIndex(index: {
  readonly columns: readonly string[];
  readonly where?: string;
  readonly options: Record<string, unknown>;
}): PostgresContract {
  const table = new StorageTable({
    columns: {
      id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
      title: { dataType: 'pg/text', codecId: 'pg/text@1', nullable: false },
      subtitle: { dataType: 'pg/text', codecId: 'pg/text@1', nullable: true },
      body: { dataType: 'pg/text', codecId: 'pg/text@1', nullable: true },
      views: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
    },
    primaryKey: { columns: ['id'] },
    foreignKeys: [],
    uniques: [],
    indexes: [
      {
        naming: { kind: 'wire', prefix: 'post_search', hash: '0a1b2c3d' },
        columns: index.columns,
        where: index.where,
        unique: false,
        type: 'fullText',
        options: index.options,
      },
    ],
  });
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('full-text-index-schema-node-test'),
    storage: new SqlStorage({
      storageHash: coreHash('full-text-index-schema-node-test'),
      namespaces: {
        public: new PostgresSchema({
          id: 'public',
          entries: { table: { post: table }, policy: {}, role: {}, rls: {} },
        }),
      },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

function indexNodeOf(contract: PostgresContract) {
  const root = contractToPostgresDatabaseSchemaNode(contract, {
    annotationNamespace: 'pg',
    renderDefault: postgresRenderDefault,
    ...postgresTypeLookups,
  });
  const index = root.namespaces['public']?.tables['post']?.indexes[0];
  if (index === undefined) throw new Error('the post table has no index');
  return index;
}

describe('a full-text index in the schema node', () => {
  const contract = contractWithIndex({
    columns: ['title', 'subtitle', 'body'],
    options: fullTextOptions,
  });

  it('is an expression index over the rendered search document', () => {
    const index = indexNodeOf(contract);

    expect(index.columns).toBeUndefined();
    expect(index.expression).toBe(renderFullTextIndexDocument(fullTextOptions));
    expect(index.expression).toBe(
      `(setweight(to_tsvector('english', coalesce("title", '')), 'A') || setweight(to_tsvector('english', coalesce("subtitle", '')), 'A') || setweight(to_tsvector('english', coalesce("body", '')), 'B'))`,
    );
  });

  it('keeps its name, is a gin index, and carries no storage options', () => {
    const index = indexNodeOf(contract);

    expect(index).toMatchObject({ name: 'post_search_0a1b2c3d', type: 'gin', unique: false });
    expect(index.options).toBeUndefined();
  });

  it('renders the same expression whatever the nullability of the covered columns', () => {
    const allRequired = new StorageTable({
      ...contract.storage.namespaces['public']!.entries.table!['post']!,
      columns: {
        id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
        title: { dataType: 'pg/text', codecId: 'pg/text@1', nullable: false },
        subtitle: { dataType: 'pg/text', codecId: 'pg/text@1', nullable: false },
        body: { dataType: 'pg/text', codecId: 'pg/text@1', nullable: false },
        views: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
      },
    });
    const required: PostgresContract = {
      ...contract,
      storage: new SqlStorage({
        storageHash: contract.storage.storageHash,
        namespaces: {
          public: new PostgresSchema({
            id: 'public',
            entries: { table: { post: allRequired }, policy: {}, role: {}, rls: {} },
          }),
        },
      }),
    };

    expect(indexNodeOf(required).expression).toBe(indexNodeOf(contract).expression);
  });

  it('depends on exactly the columns it covers', () => {
    const columnIds = (indexNodeOf(contract).dependsOn ?? []).map((chain) => chain.at(-1)?.id);

    expect(columnIds).toEqual(['column:title', 'column:subtitle', 'column:body']);
  });

  it('keeps a where predicate, and is partial with one', () => {
    const index = indexNodeOf(
      contractWithIndex({
        columns: ['title'],
        where: 'views > 0',
        options: { weightGroups: [['title']], language: 'english' },
      }),
    );

    expect(index).toMatchObject({
      expression: `to_tsvector('english', "title")`,
      where: 'views > 0',
      partial: true,
    });
  });
});

describe('a full-text index whose columns are not the fields of its weight groups', () => {
  it('is refused when the namespace is built', () => {
    expect(() =>
      contractWithIndex({ columns: ['title', 'body'], options: fullTextOptions }),
    ).toThrow(expect.objectContaining({ code: 'CONTRACT.INDEX_INVALID' }));
  });
});
