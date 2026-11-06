import type { ResolvedMigrationStatement } from '@internal/framework-components/control';
import mysql from '@internal/target-mysql/control';
import { createMysqlMigrationPlanner } from '@internal/target-mysql/migration';
import { describe, expect, it } from 'vitest';
import { defineContract } from '../../src/exports/contract-builder';
import { frameworkComponents, loadExampleContract } from '../example-contract';
import { contractWithNickname } from './contracts';
import { ADDITIVE, createAdapter, EVERY_CLASS, executedSql, planFrom } from './planner-harness';

function accountWith(
  email: 'String' | 'Int' | 'optional String' | 'String with default' | 'no email',
  extra?: 'required nickname',
) {
  return defineContract({}, ({ field, model, type }) => ({
    models: {
      Account: model('Account', {
        fields: {
          id: field.column(type.Int()).id(),
          ...(email === 'String' ? { email: field.column(type.String()) } : {}),
          ...(email === 'Int' ? { email: field.column(type.Int()) } : {}),
          ...(email === 'optional String' ? { email: field.column(type.String()).optional() } : {}),
          ...(email === 'String with default'
            ? { email: field.column(type.String()).default('none') }
            : {}),
          ...(extra === 'required nickname' ? { nickname: field.column(type.String()) } : {}),
        },
      }),
    },
  }));
}

function conflictsOf(result: ReturnType<typeof planFrom>) {
  return result.kind === 'failure'
    ? result.conflicts.map(({ kind, summary }) => ({ kind, summary }))
    : 'planned';
}

describe('the MySQL planner', () => {
  it('creates the tables of the example contract, then their indexes, then their foreign keys', async () => {
    const result = planFrom(null, loadExampleContract(), ADDITIVE);
    expect(await executedSql(result)).toEqual([
      {
        id: 'table.Post',
        sql: [
          'CREATE TABLE `Post` (\n  `authorId` int NOT NULL,\n  `id` int NOT NULL AUTO_INCREMENT,\n  `title` varchar(191) NOT NULL,\n  PRIMARY KEY (`id`)\n)',
        ],
      },
      {
        id: 'table.User',
        sql: [
          "CREATE TABLE `User` (\n  `email` varchar(191) NOT NULL,\n  `id` int NOT NULL AUTO_INCREMENT,\n  `role` enum('USER','ADMIN') NOT NULL,\n  PRIMARY KEY (`id`),\n  CONSTRAINT `User_email_key` UNIQUE (`email`)\n)",
        ],
      },
      {
        id: 'index.Post.Post_authorId_idx_e47547ed',
        sql: ['CREATE INDEX `Post_authorId_idx_e47547ed` ON `Post` (`authorId`)'],
      },
      {
        id: 'foreignKey.Post.Post_authorId_fkey',
        sql: [
          'ALTER TABLE `Post` ADD CONSTRAINT `Post_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User` (`id`)',
        ],
      },
    ]);
  });

  it('writes a migration.ts that extends the MySQL migration class', () => {
    const result = planFrom(null, loadExampleContract());
    if (result.kind !== 'success') throw new Error('expected a plan');
    const source = result.plan.renderTypeScript((specifier) => specifier);
    expect({
      imports: source.includes(
        "import { Migration, MigrationCLI, col, fn, primaryKey, sql, unique } from '@internal/mysql/migration';",
      ),
      foreignKey: source.includes(
        'this.addForeignKey({ table: "Post", name: "Post_authorId_fkey", columns: ["authorId"], references: { table: "User", columns: ["id"] } })',
      ),
      index: source.includes(
        'this.createIndex({ table: "Post", index: "Post_authorId_idx_e47547ed", columns: ["authorId"] })',
      ),
    }).toEqual({ imports: true, foreignKey: true, index: true });
  });

  it('adds a nullable column, and drops it when the policy allows a destructive change', async () => {
    const added = planFrom(loadExampleContract(), contractWithNickname());
    const dropped = planFrom(contractWithNickname(), loadExampleContract());
    expect({
      added: await executedSql(added),
      dropped: await executedSql(dropped),
      dataLoss: dropped.kind === 'success' ? dropped.dataLoss : undefined,
    }).toEqual({
      added: [
        {
          id: 'column.User.nickname',
          sql: ['ALTER TABLE `User` ADD COLUMN `nickname` varchar(191)'],
        },
      ],
      dropped: [
        { id: 'dropColumn.User.nickname', sql: ['ALTER TABLE `User` DROP COLUMN `nickname`'] },
      ],
      dataLoss: [
        {
          operationIndex: 0,
          subject: { kind: 'field', namespaceId: '__unbound__', model: 'User', field: 'nickname' },
          loss: 'drop',
          label: 'Drop column nickname on User',
        },
      ],
    });
  });

  it('leaves an extra column alone under an additive policy, and refuses to drop it when the policy allows no destructive change', () => {
    expect(conflictsOf(planFrom(contractWithNickname(), loadExampleContract(), ADDITIVE))).toEqual(
      'planned',
    );
    expect(
      conflictsOf(
        planFrom(contractWithNickname(), loadExampleContract(), {
          allowedOperationClasses: ['additive', 'widening'],
        }),
      ),
    ).toEqual([
      {
        kind: 'missingButNonAdditive',
        summary:
          'Operation "Drop column nickname on User" requires class "destructive", but policy allows only: additive, widening',
      },
    ]);
  });

  it.each([
    [
      'a type change',
      accountWith('String'),
      accountWith('Int'),
      { kind: 'typeMismatch', change: "Changing a column's type", at: 'Account.email' },
    ],
    [
      'a nullability change',
      accountWith('String'),
      accountWith('optional String'),
      {
        kind: 'nullabilityConflict',
        change: "Changing a column's nullability",
        at: 'Account.email',
      },
    ],
    [
      'a default change',
      accountWith('String'),
      accountWith('String with default'),
      {
        kind: 'unsupportedOperation',
        change: "Changing a column's default",
        at: 'Account',
      },
    ],
    [
      'a required column without a default',
      accountWith('String'),
      accountWith('String', 'required nickname'),
      {
        kind: 'nullabilityConflict',
        change: 'Adding a required column without a default',
        at: 'Account.nickname',
      },
    ],
  ])('refuses %s as not yet supported on MySQL', (_name, from, to, expected) => {
    const conflicts = conflictsOf(planFrom(from, to));
    expect(conflicts).toEqual([
      {
        kind: expected.kind,
        summary: `${expected.change} is not yet supported on MySQL (${expected.at})`,
      },
    ]);
  });

  it('refuses a statement such as a rename as not yet supported on MySQL', () => {
    const rename = { kind: 'rename' } as unknown as ResolvedMigrationStatement;
    const result = createMysqlMigrationPlanner(createAdapter()).plan({
      contract: loadExampleContract(),
      schema: mysql.migrations.contractToSchema(null, frameworkComponents),
      policy: EVERY_CLASS,
      fromContract: loadExampleContract(),
      origin: null,
      statements: [rename],
      frameworkComponents,
      spaceId: 'app',
      snapshotsImportPath: '../../snapshots',
    });
    expect(conflictsOf(result)).toEqual([
      { kind: 'statementRefused', summary: 'A rename statement is not yet supported on MySQL' },
    ]);
  });
});
