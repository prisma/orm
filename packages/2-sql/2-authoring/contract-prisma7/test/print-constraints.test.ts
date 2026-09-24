import type {
  ApplicationDomainNamespace,
  Contract,
  ContractField,
  ContractRelation,
} from '@internal/contract/types';
import { asNamespaceId } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { blindCast } from '@internal/utils/casts';
import { createSqlContract } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { loadPrintedPsl, printContractAsPsl, storageTable } from './support';

const INT_COLUMN = { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } as const;
const TEXT_COLUMN = { nativeType: 'text', codecId: 'pg/text@1', nullable: false } as const;

const INT_FIELD: ContractField = {
  nullable: false,
  type: { kind: 'scalar', codecId: 'pg/int4@1' },
};

interface ModelInput {
  readonly table: string;
  readonly fields: Record<string, { readonly column: string }>;
  readonly relations?: Record<string, ContractRelation>;
}

function contractOf(input: {
  readonly models: Record<string, ModelInput>;
  readonly tables: Record<string, unknown>;
}): Contract<SqlStorage> {
  const domainNamespace: ApplicationDomainNamespace = {
    models: Object.fromEntries(
      Object.entries(input.models).map(([name, model]) => [
        name,
        {
          storage: { table: model.table, namespaceId: 'public', fields: model.fields },
          fields: Object.fromEntries(
            Object.keys(model.fields).map((fieldName) => [fieldName, INT_FIELD]),
          ),
          relations: model.relations ?? {},
        },
      ]),
    ),
  };
  const json = createSqlContract({
    namespaces: { public: domainNamespace },
    storage: { namespaces: { public: { id: 'public', entries: { table: input.tables } } } },
  });
  return blindCast<Contract<SqlStorage>, 'the Postgres serializer yields a SQL contract'>(
    new PostgresContractSerializer().deserializeContract(json),
  );
}

function table(input: {
  readonly columns: Record<string, unknown>;
  readonly primaryKey?: { readonly columns: readonly string[] };
  readonly uniques?: readonly unknown[];
  readonly indexes?: readonly unknown[];
  readonly foreignKeys?: readonly unknown[];
  readonly checks?: readonly unknown[];
}): unknown {
  return {
    columns: input.columns,
    uniques: input.uniques ?? [],
    indexes: input.indexes ?? [],
    foreignKeys: input.foreignKeys ?? [],
    ...(input.checks === undefined ? {} : { checks: input.checks }),
    ...(input.primaryKey === undefined ? {} : { primaryKey: input.primaryKey }),
  };
}

function widget(overrides: Parameters<typeof table>[0]): Contract<SqlStorage> {
  return contractOf({
    models: {
      Widget: {
        table: 'widget',
        fields: { id: { column: 'id' }, email: { column: 'email' } },
      },
    },
    tables: { widget: table({ primaryKey: { columns: ['id'] }, ...overrides }) },
  });
}

const WIDGET_COLUMNS = { id: INT_COLUMN, email: TEXT_COLUMN };

describe('table constraints survive the print and the read back', () => {
  it('prints a check constraint the PSL source reads back with its name and expression', async () => {
    const contract = widget({
      columns: WIDGET_COLUMNS,
      checks: [{ name: 'widget_email_not_blank', expression: 'length(email) > 0' }],
    });

    const text = printContractAsPsl(contract);
    expect(text).toContain(
      '@@check(expression: "length(email) > 0", map: "widget_email_not_blank")',
    );

    const readBack = storageTable(await loadPrintedPsl(text), 'widget');
    expect(readBack.checks?.map((check) => ({ ...check }))).toEqual([
      { name: 'widget_email_not_blank', expression: 'length(email) > 0' },
    ]);
  });

  it('prints a unique constraint as @@unique, which reads back as a unique constraint', async () => {
    const contract = widget({
      columns: WIDGET_COLUMNS,
      uniques: [{ columns: ['email'], name: 'widget_email_key' }],
    });

    const text = printContractAsPsl(contract);
    expect(text).toContain('@@unique([email], map: "widget_email_key")');

    const readBack = storageTable(await loadPrintedPsl(text), 'widget');
    expect(readBack.uniques.map((unique) => ({ ...unique }))).toEqual([
      { columns: ['email'], name: 'widget_email_key' },
    ]);
    expect(readBack.indexes).toEqual([]);
  });

  it('prints a unique index as a unique index, which reads back as an index', async () => {
    const contract = widget({
      columns: WIDGET_COLUMNS,
      indexes: [{ name: 'widget_email_idx', unique: true, columns: ['email'] }],
    });

    const text = printContractAsPsl(contract);
    expect(text).toContain('unique: true');

    const readBack = storageTable(await loadPrintedPsl(text), 'widget');
    expect(readBack.uniques).toEqual([]);
    expect(readBack.indexes.map((index) => ({ name: index.name, unique: index.unique }))).toEqual([
      { name: 'widget_email_idx', unique: true },
    ]);
  });
});

function postAndUser(input: {
  readonly userIdColumn: string;
  readonly authorIdColumn: string;
  readonly foreignKeys: readonly unknown[];
  readonly relations: Record<string, ContractRelation>;
  readonly postFields: Record<string, { readonly column: string }>;
}): Contract<SqlStorage> {
  return contractOf({
    models: {
      User: {
        table: 'user',
        fields: { id: { column: input.userIdColumn } },
        relations: input.relations,
      },
      Post: {
        table: 'post',
        fields: input.postFields,
        relations: Object.fromEntries(
          Object.entries(input.postFields)
            .filter(([fieldName]) => fieldName.endsWith('Id') && fieldName !== 'id')
            .map(([fieldName]) => [
              fieldName.replace(/Id$/, ''),
              {
                to: { namespace: asNamespaceId('public'), model: 'User' },
                cardinality: 'N:1',
                nullable: false,
                on: { localFields: [fieldName], targetFields: ['id'] },
              } satisfies ContractRelation,
            ]),
        ),
      },
    },
    tables: {
      user: table({
        columns: { [input.userIdColumn]: INT_COLUMN },
        primaryKey: { columns: [input.userIdColumn] },
      }),
      post: table({
        columns: Object.fromEntries(
          Object.values(input.postFields).map((field) => [field.column, INT_COLUMN]),
        ),
        primaryKey: { columns: ['id'] },
        foreignKeys: input.foreignKeys,
      }),
    },
  });
}

describe('relations survive the print and the read back', () => {
  it('keeps a foreign key name the PSL source would not derive', async () => {
    const contract = postAndUser({
      userIdColumn: 'id',
      authorIdColumn: 'authorId',
      postFields: { id: { column: 'id' }, authorId: { column: 'authorId' } },
      relations: {
        posts: {
          to: { namespace: asNamespaceId('public'), model: 'Post' },
          cardinality: '1:N',
          on: { localFields: ['id'], targetFields: ['authorId'] },
        },
      },
      foreignKeys: [
        {
          name: 'post_written_by_user',
          source: { namespaceId: 'public', tableName: 'post', columns: ['authorId'] },
          target: { namespaceId: 'public', tableName: 'user', columns: ['id'] },
        },
      ],
    });

    const text = printContractAsPsl(contract);
    expect(text).toContain('map: "post_written_by_user"');

    const readBack = storageTable(await loadPrintedPsl(text), 'post');
    expect(readBack.foreignKeys.map((key) => key.name)).toEqual(['post_written_by_user']);
  });

  it('names an ambiguous pair when the referenced columns are mapped', async () => {
    const contract = postAndUser({
      userIdColumn: 'user_id',
      authorIdColumn: 'author_id',
      postFields: {
        id: { column: 'id' },
        authorId: { column: 'author_id' },
        editorId: { column: 'editor_id' },
      },
      relations: {
        written: {
          to: { namespace: asNamespaceId('public'), model: 'Post' },
          cardinality: '1:N',
          on: { localFields: ['id'], targetFields: ['authorId'] },
        },
        edited: {
          to: { namespace: asNamespaceId('public'), model: 'Post' },
          cardinality: '1:N',
          on: { localFields: ['id'], targetFields: ['editorId'] },
        },
      },
      foreignKeys: [
        {
          source: { namespaceId: 'public', tableName: 'post', columns: ['author_id'] },
          target: { namespaceId: 'public', tableName: 'user', columns: ['user_id'] },
        },
        {
          source: { namespaceId: 'public', tableName: 'post', columns: ['editor_id'] },
          target: { namespaceId: 'public', tableName: 'user', columns: ['user_id'] },
        },
      ],
    });

    const readBack = storageTable(await loadPrintedPsl(printContractAsPsl(contract)), 'post');
    expect(
      readBack.foreignKeys.map((key) => ({
        source: [...key.source.columns],
        target: [...key.target.columns],
      })),
    ).toEqual([
      { source: ['author_id'], target: ['user_id'] },
      { source: ['editor_id'], target: ['user_id'] },
    ]);
  });
});
