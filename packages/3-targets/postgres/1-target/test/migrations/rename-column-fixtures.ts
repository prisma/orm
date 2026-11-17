import { type Contract, coreHash, crossRef, profileHash } from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import {
  type CheckConstraintInput,
  type IndexInput,
  SqlStorage,
  StorageTable,
} from '@internal/sql-contract/types';
import { computeCheckContentHash, computeIndexContentHash } from '@internal/sql-schema-ir/naming';
import { applicationDomainOf } from '@repo/test-utils';
import { postgresCreateNamespace } from '../../src/core/postgres-schema';
import { reference } from './rename-table-fixtures';

const text = { dataType: 'pg/text', codecId: 'pg/text@1', nullable: false };
const int4 = { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false };
const scalar = { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } } as const;

/** The names the profile table's columns have in one contract. */
export interface ProfileColumns {
  readonly id: string;
  readonly email: string;
  readonly account: string;
}

export const ORIGINAL_COLUMNS: ProfileColumns = { id: 'id', email: 'email', account: 'accountId' };

/** The objects on the profile table, each named after the column it covers. */
export interface ProfileObjects {
  /** A unique constraint on the email column: `undefined` name means a derived name. */
  readonly emailUnique?: { readonly name?: string };
  readonly emailIndex?: boolean;
  /** A predicate index on the email column, whose SQL text names the column. */
  readonly emailPartialIndex?: boolean;
  readonly emailCheck?: boolean;
  /** A foreign key from the account column to the account table. */
  readonly accountForeignKey?: { readonly name?: string };
}

export function emailIndex(tableName: string, column: string): IndexInput {
  return {
    columns: [column],
    naming: {
      kind: 'wire',
      prefix: `${tableName}_${column}_idx`,
      hash: computeIndexContentHash({ columns: [column], unique: false }),
    },
    where: undefined,
    unique: false,
    type: undefined,
    options: undefined,
  };
}

function emailPartialIndex(tableName: string, column: string): IndexInput {
  const where = `"${column}" <> ''`;
  return {
    columns: [column],
    naming: {
      kind: 'wire',
      prefix: `${tableName}_${column}_present_idx`,
      hash: computeIndexContentHash({ columns: [column], unique: false, where }),
    },
    where,
    unique: false,
    type: undefined,
    options: undefined,
  };
}

function emailCheck(tableName: string, column: string): CheckConstraintInput {
  const expression = `length("${column}") > 0`;
  return {
    naming: {
      kind: 'wire',
      prefix: `${tableName}_${column}_check`,
      hash: computeCheckContentHash(expression),
    },
    expression,
  };
}

function profileTable(
  tableName: string,
  columns: ProfileColumns,
  objects: ProfileObjects,
): StorageTable {
  return new StorageTable({
    columns: { [columns.id]: int4, [columns.email]: text, [columns.account]: int4 },
    primaryKey: { columns: [columns.id] },
    uniques:
      objects.emailUnique === undefined
        ? []
        : [
            {
              columns: [columns.email],
              ...(objects.emailUnique.name === undefined ? {} : { name: objects.emailUnique.name }),
            },
          ],
    indexes: [
      ...(objects.emailIndex ? [emailIndex(tableName, columns.email)] : []),
      ...(objects.emailPartialIndex ? [emailPartialIndex(tableName, columns.email)] : []),
    ],
    foreignKeys:
      objects.accountForeignKey === undefined
        ? []
        : [
            {
              source: reference(tableName, [columns.account]),
              target: reference('account', ['id']),
              ...(objects.accountForeignKey.name === undefined
                ? {}
                : { name: objects.accountForeignKey.name }),
            },
          ],
    checks: objects.emailCheck ? [emailCheck(tableName, columns.email)] : [],
  });
}

/**
 * A contract with a profile table, an account table it references, and a post table whose
 * foreign key references the profile table's id column. Its domain has one model per table, each
 * field stored in the column of the same name in `columns`.
 */
export function profileContract(
  hashSeed: string,
  options: {
    readonly table?: string;
    readonly model?: string;
    readonly columns?: ProfileColumns;
    readonly fields?: ProfileColumns;
    readonly objects?: ProfileObjects;
  } = {},
): Contract<SqlStorage> {
  const table = options.table ?? 'Profile';
  const columns = options.columns ?? ORIGINAL_COLUMNS;
  const fields = options.fields ?? columns;
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash(hashSeed),
    storage: new SqlStorage({
      storageHash: coreHash(hashSeed),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: postgresCreateNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              [table]: profileTable(table, columns, options.objects ?? {}),
              account: new StorageTable({
                columns: { id: int4 },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              }),
              post: new StorageTable({
                columns: { id: int4, profileId: int4 },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [
                  {
                    source: reference('post', ['profileId']),
                    target: reference(table, [columns.id]),
                  },
                ],
              }),
            },
          },
        }),
      },
    }),
    roots: {},
    domain: applicationDomainOf({
      models: {
        [options.model ?? table]: {
          fields: {
            [fields.id]: scalar,
            [fields.email]: scalar,
            [fields.account]: scalar,
          },
          relations: {
            posts: {
              to: crossRef('Post'),
              cardinality: '1:N',
              on: { localFields: [fields.id], targetFields: ['profileId'] },
            },
          },
          storage: {
            table,
            namespaceId: UNBOUND_NAMESPACE_ID,
            fields: {
              [fields.id]: { column: columns.id },
              [fields.email]: { column: columns.email },
              [fields.account]: { column: columns.account },
            },
          },
        },
        Post: {
          fields: { id: scalar, profileId: scalar },
          relations: {},
          storage: {
            table: 'post',
            namespaceId: UNBOUND_NAMESPACE_ID,
            fields: { id: { column: 'id' }, profileId: { column: 'profileId' } },
          },
        },
      },
    }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}
