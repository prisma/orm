import { ColumnRef } from '@internal/sql-relational-core/ast';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { describe, expect, it } from 'vitest';
import { sql } from '../../src/runtime/sql';
import type { Contract } from '../fixtures/generated/contract';

const text = { many: false, codecId: 'pg/text@1', dataType: 'pg/text', nullable: false } as const;
const nullableText = { ...text, nullable: true } as const;

const searchOptions = { weightGroups: [['title'], ['body']], language: 'english' };

const documentsContract = {
  capabilities: {},
  target: 'postgres',
  storage: {
    storageHash: 'stub',
    namespaces: {
      public: {
        id: 'public',
        entries: {
          table: {
            documents: {
              columns: { id: text, title: text, body: nullableText },
              primaryKey: { columns: ['id'] },
              uniques: [],
              foreignKeys: [],
              indexes: [
                {
                  name: 'documents_search_2f1bb221',
                  prefix: 'documents_search',
                  columns: ['title', 'body'],
                  unique: false,
                  type: 'fullText',
                  options: searchOptions,
                },
                {
                  name: 'documents_title_lower',
                  expression: 'lower(title)',
                  unique: false,
                },
                {
                  name: 'documents_twice_1111aaaa',
                  prefix: 'documents_twice',
                  columns: ['title'],
                  unique: false,
                },
                {
                  name: 'documents_twice_2222bbbb',
                  prefix: 'documents_twice',
                  columns: ['body'],
                  unique: false,
                },
              ],
            },
          },
        },
      },
    },
  },
};

const stubBase = {
  operations: {},
  codecs: {},
  queryOperations: { entries: () => ({}) },
  aggregateDescriptors: { resolve: () => undefined, values: function* () {} },
  types: {},
  applyMutationDefaults: () => [],
};

type IndexReferenceStub = {
  readonly columns: Readonly<Record<string, { buildAst(): unknown; readonly returnType: unknown }>>;
  readonly type: string | undefined;
  readonly options: unknown;
};
type DocumentsTable = {
  readonly indexes: Readonly<Record<string, IndexReferenceStub>>;
  as(alias: string): DocumentsTable;
  select(alias: string, expression: () => unknown): { build(): unknown };
  delete(): { where(predicate: () => unknown): { build(): unknown } };
};

function documents(): DocumentsTable {
  return (
    sql({
      context: {
        ...stubBase,
        contract: documentsContract,
      } as unknown as ExecutionContext<Contract>,
      rawCodecInferer: { inferCodec: () => 'pg/text@1' },
    }) as unknown as { public: { documents: DocumentsTable } }
  ).public.documents;
}

describe('a table proxy’s indexes', () => {
  it('keys each index by the name its source gave it, with its type and options', () => {
    const { indexes } = documents();

    expect(Object.keys(indexes)).toEqual([
      'documents_search',
      'documents_title_lower',
      'documents_twice',
    ]);
    expect(indexes['documents_search']).toMatchObject({ type: 'fullText', options: searchOptions });
  });

  it('binds the columns of an index to the table, and to its alias once aliased', () => {
    const columnsOf = (table: DocumentsTable) =>
      Object.fromEntries(
        Object.entries(table.indexes['documents_search']?.columns ?? {}).map(([name, column]) => [
          name,
          { ast: column.buildAst(), returnType: column.returnType },
        ]),
      );

    expect(columnsOf(documents())).toEqual({
      title: {
        ast: ColumnRef.of('documents', 'title'),
        returnType: expect.objectContaining({ codecId: 'pg/text@1', nullable: false }),
      },
      body: {
        ast: ColumnRef.of('documents', 'body'),
        returnType: expect.objectContaining({ codecId: 'pg/text@1', nullable: true }),
      },
    });
    expect(columnsOf(documents().as('d'))).toEqual({
      title: expect.objectContaining({ ast: ColumnRef.of('d', 'title') }),
      body: expect.objectContaining({ ast: ColumnRef.of('d', 'body') }),
    });
  });

  it('gives an expression index no columns', () => {
    expect(documents().indexes['documents_title_lower']).toEqual({
      columns: {},
      type: undefined,
      options: undefined,
    });
  });

  it('refuses a name more than one index shares, when it is read', () => {
    expect(() => documents().indexes['documents_twice']).toThrow(
      expect.objectContaining({
        code: 'ORM.ARGUMENT_INVALID',
        message: 'Table "documents" has more than one index named "documents_twice".',
        meta: { namespaceId: 'public', tableName: 'documents', index: 'documents_twice' },
      }),
    );
  });

  it('gives the same references on every read', () => {
    const table = documents();

    expect(table.indexes).toBe(table.indexes);
  });

  describe('a column of an index read from a table the query does not read', () => {
    const outside = () => documents().as('d').indexes['documents_search']?.columns['title'];
    const refusal = expect.objectContaining({
      code: 'ORM.ARGUMENT_INVALID',
      message:
        'The query reads column "title" of "d", which is not one of its sources ("documents").',
      meta: { alias: 'd', column: 'title', sources: ['documents'] },
    });

    it('is refused when a select is built', () => {
      expect(() => documents().select('title', outside).build()).toThrow(refusal);
    });

    it('is refused when a delete is built', () => {
      expect(() => documents().delete().where(outside).build()).toThrow(refusal);
    });

    it('is accepted from the table the query reads', () => {
      const own = () => documents().indexes['documents_search']?.columns['title'];

      expect(() => documents().select('title', own).build()).not.toThrow();
    });
  });
});
