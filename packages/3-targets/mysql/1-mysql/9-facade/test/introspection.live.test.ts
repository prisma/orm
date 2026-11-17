import mysqlAdapter from '@internal/adapter-mysql/control';
import type { MysqlControlDriver } from '@internal/driver-mysql/control';
import mysqlDriver from '@internal/driver-mysql/control';
import sql from '@internal/family-sql/control';
import { createControlStack, diffSchemas } from '@internal/framework-components/control';
import { SqlSchemaIR } from '@internal/sql-schema-ir/types';
import mysql from '@internal/target-mysql/control';
import { timeouts } from '@repo/test-utils';
import { withMysqlDatabase } from '@repo/test-utils/mysql-database';
import { describe, expect, it } from 'vitest';
import { defineContract } from '../src/exports/contract-builder';
import {
  exampleContractSchema,
  exampleTablesDdl,
  frameworkComponents,
  loadExampleContract,
} from './example-contract';

const autoincrement = { kind: 'function', expression: 'autoincrement()' } as const;

async function introspect(driver: MysqlControlDriver, contract?: unknown): Promise<SqlSchemaIR> {
  const adapter = mysqlAdapter.create(
    createControlStack({ family: sql, target: mysql, adapter: mysqlAdapter, driver: mysqlDriver }),
  );
  return (await adapter.introspect(driver, contract)) as SqlSchemaIR;
}

function contractWithBothKindsOfUniqueness() {
  return defineContract({}, ({ field, model, type }) => ({
    models: {
      Account: model('Account', {
        fields: {
          id: field.column(type.Int()).id(),
          email: field.column(type.String()).unique(),
          handle: field.column(type.String()),
        },
      }).sql(({ cols, constraints }) => ({
        indexes: [constraints.index([cols.handle], { unique: true })],
      })),
    },
  }));
}

function contractWithTextDefault() {
  return defineContract({}, ({ field, model, type }) => ({
    models: {
      Note: model('Note', {
        fields: {
          id: field.column(type.Int()).id(),
          body: field.column({ codecId: 'mysql/text@1' }).default("it's a \\ b"),
        },
      }),
    },
  }));
}

function contractWithIndexNamedLikeItsForeignKey() {
  return defineContract({}, ({ field, model, type }) => {
    const User = model('User', { fields: { id: field.column(type.Int()).id() } });
    const Post = model('Post', {
      fields: { id: field.column(type.Int()).id(), authorId: field.column(type.Int()) },
    });
    return {
      models: {
        User,
        Post: Post.sql(({ cols, constraints }) => ({
          foreignKeys: [constraints.foreignKey(cols.authorId, User.refs.id, { index: false })],
          indexes: [constraints.index([cols.authorId], { map: 'fk_x' })],
        })),
      },
    };
  });
}

const tablesWithIndexNamedLikeItsForeignKey = [
  'CREATE TABLE `User` (`id` int NOT NULL, PRIMARY KEY (`id`))',
  `CREATE TABLE \`Post\` (
    \`id\` int NOT NULL,
    \`authorId\` int NOT NULL,
    PRIMARY KEY (\`id\`),
    KEY \`fk_x\` (\`authorId\`),
    CONSTRAINT \`fk_x\` FOREIGN KEY (\`authorId\`) REFERENCES \`User\` (\`id\`)
  )`,
];

async function withExampleTables<T>(
  url: string,
  ddl: readonly string[],
  fn: (driver: MysqlControlDriver) => Promise<T>,
): Promise<T> {
  const driver = await mysqlDriver.create(url);
  try {
    for (const statement of ddl) await driver.query(statement);
    return await fn(driver);
  } finally {
    await driver.close();
  }
}

describe('introspecting a MySQL database made by hand', {
  timeout: timeouts.databaseOperation,
}, () => {
  it('yields the schema IR the example contract describes', async (test) => {
    await withMysqlDatabase(test, ({ url }) =>
      withExampleTables(url, exampleTablesDdl, async (driver) => {
        const actual = await introspect(driver, loadExampleContract());

        expect(diffSchemas(exampleContractSchema(), actual)).toEqual([]);
        expect(
          mysql.diffSchema({
            contract: loadExampleContract(),
            schema: actual,
            frameworkComponents,
          }).issues,
        ).toEqual([]);
        expect(actual).toEqual(
          new SqlSchemaIR({
            tables: {
              Post: {
                name: 'Post',
                columns: {
                  id: {
                    name: 'id',
                    typeText: 'int',
                    nullable: false,
                    resolvedDefault: autoincrement,
                  },
                  title: { name: 'title', typeText: 'varchar(191)', nullable: false },
                  authorId: { name: 'authorId', typeText: 'int', nullable: false },
                },
                primaryKey: { columns: ['id'] },
                foreignKeys: [
                  {
                    columns: ['authorId'],
                    referencedTable: 'User',
                    referencedColumns: ['id'],
                    name: 'Post_authorId_fkey',
                  },
                ],
                uniques: [],
                indexes: [
                  {
                    naming: { kind: 'exact', name: 'Post_authorId_idx_e47547ed' },
                    columns: ['authorId'],
                    unique: false,
                    where: undefined,
                    partial: false,
                    type: undefined,
                    options: undefined,
                    annotations: undefined,
                    dependsOn: undefined,
                  },
                ],
              },
              User: {
                name: 'User',
                columns: {
                  id: {
                    name: 'id',
                    typeText: 'int',
                    nullable: false,
                    resolvedDefault: autoincrement,
                  },
                  email: { name: 'email', typeText: 'varchar(191)', nullable: false },
                  role: { name: 'role', typeText: "enum('USER','ADMIN')", nullable: false },
                },
                primaryKey: { columns: ['id'] },
                foreignKeys: [],
                uniques: [{ columns: ['email'], name: 'User_email_key' }],
                indexes: [],
              },
            },
          }),
        );
      }),
    );
  });

  it('verifies a unique constraint and a unique index the contract declares without drift', async (test) => {
    const contract = contractWithBothKindsOfUniqueness();
    const account = contract.storage.namespaces['__unbound__']?.entries.table?.['Account'];
    const uniqueIndexName = account?.indexes[0]?.name ?? '';
    const accountDdl = `CREATE TABLE \`Account\` (
      \`id\` int NOT NULL,
      \`email\` varchar(191) NOT NULL,
      \`handle\` varchar(191) NOT NULL,
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`Account_email_key\` (\`email\`),
      UNIQUE KEY \`${uniqueIndexName}\` (\`handle\`)
    )`;
    await withMysqlDatabase(test, ({ url }) =>
      withExampleTables(url, [accountDdl], async (driver) => {
        const actual = await introspect(driver, contract);
        expect({
          uniqueIndexName,
          issues: mysql.diffSchema({ contract, schema: actual, frameworkComponents }).issues,
        }).toEqual({ uniqueIndexName: expect.stringMatching(/^Account_handle_/), issues: [] });
      }),
    );
  });

  it('reads a literal default on a text column as the literal', async (test) => {
    const contract = contractWithTextDefault();
    const noteDdl = `CREATE TABLE \`Note\` (
      \`id\` int NOT NULL,
      \`body\` text NOT NULL DEFAULT ('it''s a \\\\ b'),
      PRIMARY KEY (\`id\`)
    )`;
    await withMysqlDatabase(test, ({ url }) =>
      withExampleTables(url, [noteDdl], async (driver) => {
        const actual = await introspect(driver, contract);
        expect({
          resolvedDefault: actual.tables['Note']?.columns['body']?.resolvedDefault,
          issues: mysql.diffSchema({ contract, schema: actual, frameworkComponents }).issues,
        }).toEqual({ resolvedDefault: { kind: 'literal', value: "it's a \\ b" }, issues: [] });
      }),
    );
  });

  it('leaves out the index InnoDB creates for a foreign key with no index of its own', async (test) => {
    const [userTable] = exampleTablesDdl;
    const postWithoutIndex = `CREATE TABLE \`Post\` (
      \`id\` int NOT NULL AUTO_INCREMENT,
      \`authorId\` int NOT NULL,
      PRIMARY KEY (\`id\`),
      CONSTRAINT \`Post_authorId_fkey\` FOREIGN KEY (\`authorId\`) REFERENCES \`User\` (\`id\`) ON DELETE CASCADE
    )`;
    await withMysqlDatabase(test, ({ url }) =>
      withExampleTables(url, [userTable, postWithoutIndex], async (driver) => {
        const post = (await introspect(driver)).tables['Post'];
        expect({ indexes: post?.indexes, foreignKeys: post?.foreignKeys }).toEqual({
          indexes: [],
          foreignKeys: [
            expect.objectContaining({
              columns: ['authorId'],
              name: 'Post_authorId_fkey',
              onDelete: 'cascade',
            }),
          ],
        });
      }),
    );
  });

  it('keeps an index the contract declares under the name and columns of a foreign key', async (test) => {
    const contract = contractWithIndexNamedLikeItsForeignKey();
    await withMysqlDatabase(test, ({ url }) =>
      withExampleTables(url, tablesWithIndexNamedLikeItsForeignKey, async (driver) => {
        const actual = await introspect(driver, contract);
        expect({
          indexes: actual.tables['Post']?.indexes.map(({ name, columns }) => ({ name, columns })),
          issues: mysql.diffSchema({ contract, schema: actual, frameworkComponents }).issues,
        }).toEqual({ indexes: [{ name: 'fk_x', columns: ['authorId'] }], issues: [] });
      }),
    );
  });

  it('leaves out an index named like a foreign key when the contract does not declare it', async (test) => {
    await withMysqlDatabase(test, ({ url }) =>
      withExampleTables(url, tablesWithIndexNamedLikeItsForeignKey, async (driver) => {
        const post = (await introspect(driver)).tables['Post'];
        expect({
          indexes: post?.indexes,
          foreignKeys: post?.foreignKeys.map(({ name }) => name),
        }).toEqual({ indexes: [], foreignKeys: ['fk_x'] });
      }),
    );
  });

  it('reports a changed enum member as a different column type', async (test) => {
    const [, postTable] = exampleTablesDdl;
    const userWithOtherMembers = exampleTablesDdl[0].replace(
      "enum('USER','ADMIN')",
      "enum('USER','OWNER')",
    );
    await withMysqlDatabase(test, ({ url }) =>
      withExampleTables(url, [userWithOtherMembers, postTable], async (driver) => {
        const actual = await introspect(driver, loadExampleContract());
        expect(
          mysql
            .diffSchema({ contract: loadExampleContract(), schema: actual, frameworkComponents })
            .issues.map((issue) => issue.path.join('/')),
        ).toEqual([expect.stringContaining('role')]);
      }),
    );
  });
});
