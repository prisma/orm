import { asNamespaceId, type Contract, coreHash, profileHash } from '@internal/contract/types';
import type { MigrationOperationPolicy } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { ReferentialAction, StorageColumn } from '@internal/sql-contract/types';
import { SqlStorage } from '@internal/sql-contract/types';
import { sqliteCreateNamespace } from '@internal/target-sqlite/types';
import { applicationDomainOf } from '@repo/test-utils';

export const ALL_CLASSES: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'],
};

export const integer: StorageColumn = {
  many: false,
  dataType: 'sqlite/integer',
  codecId: 'sqlite/integer@1',
  nullable: false,
};

function contractOf(
  name: string,
  tables: Parameters<typeof sqliteCreateNamespace>[0]['entries']['table'],
  models: Parameters<typeof applicationDomainOf>[0]['models'] = {},
): Contract<SqlStorage> {
  return {
    target: 'sqlite',
    targetFamily: 'sql',
    profileHash: profileHash('recreate-table-postcheck-skip'),
    storage: new SqlStorage({
      storageHash: coreHash(name),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: sqliteCreateNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: { table: tables },
        }),
      },
    }),
    roots: {},
    domain: applicationDomainOf({ models }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

export function postContract(
  onDelete: ReferentialAction,
  extraColumns: Readonly<Record<string, StorageColumn>> = {},
): Contract<SqlStorage> {
  return contractOf(`post-${onDelete}-${Object.keys(extraColumns).join('-')}`, {
    User: {
      columns: { id: integer },
      primaryKey: { columns: ['id'] },
      uniques: [],
      indexes: [],
      foreignKeys: [],
    },
    Post: {
      columns: { id: integer, authorId: { ...integer, nullable: true }, ...extraColumns },
      primaryKey: { columns: ['id'] },
      uniques: [],
      indexes: [],
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
          onDelete,
        },
      ],
    },
  });
}

export function counterContract(autoincrement: boolean): Contract<SqlStorage> {
  return contractOf(`counter-${autoincrement}`, {
    Counter: {
      columns: {
        id: autoincrement
          ? { ...integer, default: { kind: 'function', expression: 'autoincrement()' } }
          : integer,
      },
      primaryKey: { columns: ['id'] },
      uniques: [],
      indexes: [],
      foreignKeys: [],
    },
  });
}

const text: StorageColumn = {
  many: false,
  dataType: 'sqlite/text',
  codecId: 'sqlite/text@1',
  nullable: true,
};

/**
 * A `User` table and a post table with a foreign key to it, each with a model whose fields are
 * stored in columns of the same names. The post table, its model and its title column can be
 * renamed, and optional text columns added.
 */
export function postModelContract(options: {
  readonly onDelete: ReferentialAction;
  readonly table?: string;
  readonly title?: string;
  readonly optional?: readonly string[];
}): Contract<SqlStorage> {
  const table = options.table ?? 'Post';
  const title = options.title ?? 'title';
  const optional = options.optional ?? [];
  const textColumns = [title, ...optional];
  const scalar = (codecId: string, nullable: boolean) =>
    ({ nullable, type: { kind: 'scalar', codecId } }) as const;
  return contractOf(
    `post-model-${options.onDelete}-${table}-${textColumns.join('-')}`,
    {
      User: {
        columns: { id: integer },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
      [table]: {
        columns: {
          id: integer,
          authorId: { ...integer, nullable: true },
          ...Object.fromEntries(textColumns.map((column) => [column, text])),
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [
          {
            source: {
              namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
              tableName: table,
              columns: ['authorId'],
            },
            target: {
              namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
              tableName: 'User',
              columns: ['id'],
            },
            onDelete: options.onDelete,
          },
        ],
      },
    },
    {
      User: {
        fields: { id: scalar('sqlite/integer@1', false) },
        relations: {},
        storage: {
          table: 'User',
          namespaceId: UNBOUND_NAMESPACE_ID,
          fields: { id: { column: 'id' } },
        },
      },
      [table]: {
        fields: {
          id: scalar('sqlite/integer@1', false),
          authorId: scalar('sqlite/integer@1', true),
          ...Object.fromEntries(
            textColumns.map((column) => [column, scalar('sqlite/text@1', true)]),
          ),
        },
        relations: {},
        storage: {
          table,
          namespaceId: UNBOUND_NAMESPACE_ID,
          fields: Object.fromEntries(
            ['id', 'authorId', ...textColumns].map((column) => [column, { column }]),
          ),
        },
      },
    },
  );
}
