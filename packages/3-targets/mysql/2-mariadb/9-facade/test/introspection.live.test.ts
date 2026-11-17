import mariadbAdapter from '@internal/adapter-mariadb/control';
import mariadbDriver from '@internal/driver-mariadb/control';
import sql from '@internal/family-sql/control';
import { createControlStack } from '@internal/framework-components/control';
import type { SqlControlDriverInstance } from '@internal/sql-contract/types';
import type { SqlSchemaIR } from '@internal/sql-schema-ir/types';
import mariadb from '@internal/target-mariadb/control';
import { timeouts } from '@repo/test-utils';
import { withMysqlDatabase } from '@repo/test-utils/mysql-database';
import { describe, expect, it } from 'vitest';
import { emitFixture } from './emit';

const SERVER = 'MARIADB_URL';
const frameworkComponents = [mariadb, mariadbAdapter];

async function introspect(
  driver: SqlControlDriverInstance<'mariadb'>,
  contract?: unknown,
): Promise<SqlSchemaIR> {
  const adapter = mariadbAdapter.create(
    createControlStack({
      family: sql,
      target: mariadb,
      adapter: mariadbAdapter,
      driver: mariadbDriver,
    }),
  );
  return (await adapter.introspect(driver, contract)) as SqlSchemaIR;
}

async function withTables<T>(
  url: string,
  ddl: readonly string[],
  fn: (driver: SqlControlDriverInstance<'mariadb'>) => Promise<T>,
): Promise<T> {
  const driver = await mariadbDriver.create(url, {
    sessionSettings: mariadb.sessionSettings ?? {},
  });
  try {
    for (const statement of ddl) await driver.query(statement);
    return await fn(driver);
  } finally {
    await driver.close();
  }
}

const exampleTablesDdl = [
  `CREATE TABLE \`User\` (
    \`id\` int(11) NOT NULL AUTO_INCREMENT,
    \`email\` varchar(191) NOT NULL,
    \`role\` enum('USER','ADMIN') NOT NULL,
    PRIMARY KEY (\`id\`),
    UNIQUE KEY \`User_email_key\` (\`email\`)
  )`,
  `CREATE TABLE \`Post\` (
    \`id\` int(11) NOT NULL AUTO_INCREMENT,
    \`title\` varchar(191) NOT NULL,
    \`authorId\` int(11) NOT NULL,
    PRIMARY KEY (\`id\`),
    KEY \`Post_authorId_idx_e47547ed\` (\`authorId\`),
    CONSTRAINT \`Post_authorId_fkey\` FOREIGN KEY (\`authorId\`) REFERENCES \`User\` (\`id\`)
  )`,
  `CREATE TABLE \`Event\` (
    \`id\` int(11) NOT NULL AUTO_INCREMENT,
    \`title\` varchar(191) NOT NULL,
    \`startsAt\` datetime(3) NOT NULL,
    \`day\` date NOT NULL,
    \`opensAt\` time(6) NOT NULL,
    \`createdAt\` datetime(3) NOT NULL DEFAULT current_timestamp(3),
    PRIMARY KEY (\`id\`)
  )`,
] as const;

const columnKindsDdl = `CREATE TABLE \`Kinds\` (
  \`id\` int NOT NULL,
  \`unsignedInt\` int unsigned,
  \`flag\` tinyint(1),
  \`unsignedFlag\` tinyint(1) unsigned,
  \`padded\` int(5) zerofill,
  \`big\` bigint,
  \`price\` decimal(5,2) DEFAULT 1.50,
  \`count\` int DEFAULT 0,
  \`label\` varchar(20) DEFAULT 'it''s',
  \`body\` text DEFAULT ('it''s a \\\\ b'),
  \`word\` varchar(10) DEFAULT 'NULL',
  \`role\` enum('USER','ADMIN') DEFAULT 'USER',
  \`createdAt\` datetime(3) DEFAULT current_timestamp(3),
  \`updatedAt\` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  \`day\` date DEFAULT (curdate()),
  \`nickname\` varchar(10),
  \`required\` int NOT NULL,
  PRIMARY KEY (\`id\`)
)`;

describe('introspecting a MariaDB database made by hand', {
  timeout: timeouts.databaseOperation,
}, () => {
  it('verifies the example contract against tables MariaDB reports as int(11), with a current_timestamp(3) default MariaDB does not mark as generated', async (test) => {
    const { contract } = await emitFixture('example');
    await withMysqlDatabase(
      test,
      ({ url }) =>
        withTables(url, exampleTablesDdl, async (driver) => {
          const actual = await introspect(driver, contract);
          expect({
            idType: actual.tables['User']?.columns['id']?.typeText,
            createdAt: actual.tables['Event']?.columns['createdAt']?.resolvedDefault,
            issues: mariadb.diffSchema({ contract, schema: actual, frameworkComponents }).issues,
          }).toEqual({
            idType: 'int',
            createdAt: { kind: 'function', expression: 'now()' },
            issues: [],
          });
        }),
      SERVER,
    );
  });

  it('reads each column type and default as MySQL 8.4 reports it, though MariaDB keeps display widths, quotes literals and reports no default as the text NULL', async (test) => {
    await withMysqlDatabase(
      test,
      ({ url }) =>
        withTables(url, [columnKindsDdl], async (driver) => {
          const columns = (await introspect(driver)).tables['Kinds']?.columns ?? {};
          expect(
            Object.fromEntries(
              Object.entries(columns).map(([name, column]) => [
                name,
                {
                  type: column.typeText,
                  default: column.default,
                  resolved: column.resolvedDefault,
                },
              ]),
            ),
          ).toEqual({
            id: { type: 'int', default: undefined, resolved: undefined },
            unsignedInt: { type: 'int unsigned', default: undefined, resolved: undefined },
            flag: { type: 'tinyint(1)', default: undefined, resolved: undefined },
            unsignedFlag: { type: 'tinyint unsigned', default: undefined, resolved: undefined },
            padded: { type: 'int(5) unsigned zerofill', default: undefined, resolved: undefined },
            big: { type: 'bigint', default: undefined, resolved: undefined },
            price: { type: 'decimal(5,2)', default: '1.50', resolved: undefined },
            count: { type: 'int', default: '0', resolved: undefined },
            label: { type: 'varchar(20)', default: "it's", resolved: undefined },
            body: { type: 'text', default: "it's a \\ b", resolved: undefined },
            word: { type: 'varchar(10)', default: 'NULL', resolved: undefined },
            role: { type: "enum('USER','ADMIN')", default: 'USER', resolved: undefined },
            createdAt: {
              type: 'datetime(3)',
              default: 'current_timestamp(3)',
              resolved: { kind: 'function', expression: 'now()' },
            },
            updatedAt: {
              type: 'datetime',
              default: 'current_timestamp()',
              resolved: { kind: 'function', expression: 'now()' },
            },
            day: {
              type: 'date',
              default: 'curdate()',
              resolved: { kind: 'function', expression: 'CURRENT_DATE' },
            },
            nickname: { type: 'varchar(10)', default: undefined, resolved: undefined },
            required: { type: 'int', default: undefined, resolved: undefined },
          });
        }),
      SERVER,
    );
  });

  it('reads literal defaults through the codecs of the columns a contract declares', async (test) => {
    const { contract } = await emitFixture('defaults');
    const itemDdl = `CREATE TABLE \`Item\` (
      \`id\` int(11) NOT NULL,
      \`label\` varchar(191) NOT NULL DEFAULT 'it''s',
      \`count\` int(11) NOT NULL DEFAULT 0,
      \`total\` bigint(20) NOT NULL DEFAULT 10,
      \`role\` enum('USER','ADMIN') NOT NULL DEFAULT 'USER',
      \`nickname\` varchar(191) DEFAULT NULL,
      \`createdAt\` datetime(3) NOT NULL DEFAULT current_timestamp(3),
      \`day\` date NOT NULL DEFAULT curdate(),
      PRIMARY KEY (\`id\`)
    )`;
    await withMysqlDatabase(
      test,
      ({ url }) =>
        withTables(url, [itemDdl], async (driver) => {
          const actual = await introspect(driver, contract);
          const item = actual.tables['Item']?.columns ?? {};
          expect({
            label: item['label']?.resolvedDefault,
            count: item['count']?.resolvedDefault,
            total: item['total']?.resolvedDefault,
            role: item['role']?.resolvedDefault,
            nickname: item['nickname']?.resolvedDefault,
            issues: mariadb.diffSchema({ contract, schema: actual, frameworkComponents }).issues,
          }).toEqual({
            label: { kind: 'literal', value: "it's" },
            count: { kind: 'literal', value: 0 },
            total: { kind: 'literal', value: '10' },
            role: { kind: 'literal', value: 'USER' },
            nickname: undefined,
            issues: [],
          });
        }),
      SERVER,
    );
  });
});
