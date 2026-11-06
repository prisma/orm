import type { Contract } from '@internal/contract/types';
import type {
  MigrationOperationPolicy,
  SchemaOwnership,
} from '@internal/framework-components/control';
import type { SqlStorage } from '@internal/sql-contract/types';
import { SqlSchemaIR } from '@internal/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import mysqlControlTarget from '../../src/core/migrations/control-target';
import { createMysqlMigrationPlanner } from '../../src/core/migrations/planner';
import { contractOf, frameworkComponents, int, stubLowerer, text } from './fixtures';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

const EVERY_CLASS: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'],
};

function fk(name: string) {
  return {
    source: { namespaceId: '__unbound__', tableName: 'Post', columns: ['authorId'] },
    target: { namespaceId: '__unbound__', tableName: 'User', columns: ['id'] },
    name,
    index: false,
  };
}

const user = {
  columns: { id: int, email: text },
  primaryKey: { columns: ['id'] },
};

function plan(
  from: Contract<SqlStorage> | null,
  to: Contract<SqlStorage>,
  options: {
    readonly policy?: MigrationOperationPolicy;
    readonly ownership?: SchemaOwnership;
    readonly schema?: unknown;
  } = {},
) {
  return createMysqlMigrationPlanner(stubLowerer).plan({
    contract: to,
    schema:
      options.schema ?? mysqlControlTarget.migrations.contractToSchema(from, frameworkComponents),
    policy: options.policy ?? EVERY_CLASS,
    fromContract: from,
    origin: from === null ? null : { storageHash: from.storage.storageHash },
    statements: [],
    frameworkComponents,
    spaceId: 'app',
    snapshotsImportPath: '../../snapshots',
    ...(options.ownership === undefined ? {} : { ownership: options.ownership }),
  });
}

async function sqlOf(result: ReturnType<typeof plan>) {
  if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts));
  return (await Promise.all(result.plan.operations)).map((operation) => ({
    id: operation.id,
    sql: operation.execute.map((step) => step.sql),
  }));
}

function summaries(result: ReturnType<typeof plan>) {
  return result.kind === 'failure' ? result.conflicts.map(({ summary }) => summary) : 'planned';
}

describe('MysqlMigrationPlanner', () => {
  it('adds and drops unique constraints, indexes and foreign keys, dropping foreign keys first, and refuses changing one', async () => {
    const from = contractOf('from', {
      User: { ...user, uniques: [{ columns: ['email'], name: 'User_email_key' }] },
      Post: {
        columns: { id: int, authorId: int },
        primaryKey: { columns: ['id'] },
        indexes: [{ columns: ['authorId'], name: 'Post_authorId_idx' }],
        foreignKeys: [fk('Post_authorId_fkey')],
      },
    });
    const to = contractOf('to', {
      User: { ...user, indexes: [{ columns: ['email'], name: 'User_email_idx', unique: true }] },
      Post: {
        columns: { id: int, authorId: int },
        primaryKey: { columns: ['id'] },
        uniques: [{ columns: ['authorId'], name: 'Post_authorId_key' }],
        foreignKeys: [{ ...fk('Post_authorId_fkey'), onDelete: 'cascade' }],
      },
    });
    const withoutForeignKey = contractOf('bare', {
      User: user,
      Post: { columns: { id: int, authorId: int }, primaryKey: { columns: ['id'] } },
    });
    expect({
      changed: summaries(plan(from, to)),
      dropped: await sqlOf(plan(from, withoutForeignKey)),
      added: await sqlOf(plan(withoutForeignKey, to)),
    }).toEqual({
      changed: ['Changing a foreign key is not yet supported on MySQL (Post)'],
      dropped: [
        {
          id: 'dropForeignKey.Post.Post_authorId_fkey',
          sql: ['ALTER TABLE `Post` DROP FOREIGN KEY `Post_authorId_fkey`'],
        },
        {
          id: 'dropUnique.User.User_email_key',
          sql: ['ALTER TABLE `User` DROP INDEX `User_email_key`'],
        },
        {
          id: 'dropIndex.Post.Post_authorId_idx',
          sql: ['DROP INDEX `Post_authorId_idx` ON `Post`'],
        },
      ],
      added: [
        {
          id: 'unique.Post.Post_authorId_key',
          sql: ['ALTER TABLE `Post` ADD CONSTRAINT `Post_authorId_key` UNIQUE (`authorId`)'],
        },
        {
          id: 'index.User.User_email_idx',
          sql: ['CREATE UNIQUE INDEX `User_email_idx` ON `User` (`email`)'],
        },
        {
          id: 'foreignKey.Post.Post_authorId_fkey',
          sql: [
            'ALTER TABLE `Post` ADD CONSTRAINT `Post_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User` (`id`) ON DELETE CASCADE',
          ],
        },
      ],
    });
  });

  it("drops the index InnoDB made for a dropped foreign key when the key's columns stay", async () => {
    const from = contractOf('from', {
      User: user,
      Post: {
        columns: { id: int, authorId: int },
        primaryKey: { columns: ['id'] },
        foreignKeys: [fk('Post_authorId_fkey')],
      },
    });
    const to = contractOf('to', {
      User: user,
      Post: { columns: { id: int, authorId: int }, primaryKey: { columns: ['id'] } },
    });
    expect(await sqlOf(plan(from, to))).toEqual([
      {
        id: 'dropForeignKey.Post.Post_authorId_fkey',
        sql: ['ALTER TABLE `Post` DROP FOREIGN KEY `Post_authorId_fkey`'],
      },
      {
        id: 'dropIndex.Post.Post_authorId_fkey',
        sql: ['DROP INDEX `Post_authorId_fkey` ON `Post`'],
      },
    ]);
  });

  it("re-points a relation on a column with no index, dropping InnoDB's index before the new key is added", async () => {
    const post = (target: string) => ({
      columns: { id: int, authorId: int },
      primaryKey: { columns: ['id'] },
      foreignKeys: [
        {
          ...fk('Post_authorId_fkey'),
          target: { namespaceId: '__unbound__', tableName: target, columns: ['id'] },
        },
      ],
    });
    const from = contractOf('from', { User: user, Admin: user, Post: post('User') });
    const to = contractOf('to', { User: user, Admin: user, Post: post('Admin') });
    expect(await sqlOf(plan(from, to))).toEqual([
      {
        id: 'dropForeignKey.Post.Post_authorId_fkey',
        sql: ['ALTER TABLE `Post` DROP FOREIGN KEY `Post_authorId_fkey`'],
      },
      {
        id: 'dropIndex.Post.Post_authorId_fkey',
        sql: ['DROP INDEX `Post_authorId_fkey` ON `Post`'],
      },
      {
        id: 'foreignKey.Post.Post_authorId_fkey',
        sql: [
          'ALTER TABLE `Post` ADD CONSTRAINT `Post_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `Admin` (`id`)',
        ],
      },
    ]);
  });

  it('refuses to drop the index a kept foreign key uses, and drops it when another index takes over', async () => {
    const post = (indexes: readonly unknown[]) => ({
      columns: { id: int, authorId: int },
      primaryKey: { columns: ['id'] },
      indexes,
      foreignKeys: [fk('Post_authorId_fkey')],
    });
    const from = contractOf('from', {
      User: user,
      Post: post([{ columns: ['authorId'], name: 'Post_authorId_idx' }]),
    });
    const withoutIndex = contractOf('bare', { User: user, Post: post([]) });
    const withOtherIndex = contractOf('other', {
      User: user,
      Post: post([{ columns: ['authorId', 'id'], name: 'Post_authorId_id_idx' }]),
    });
    const refused = plan(from, withoutIndex);
    expect({
      refused:
        refused.kind === 'failure'
          ? refused.conflicts.map(({ kind, summary, location }) => ({ kind, summary, location }))
          : 'planned',
      replaced: await sqlOf(plan(from, withOtherIndex)),
    }).toEqual({
      refused: [
        {
          kind: 'indexIncompatible',
          summary:
            'Dropping index Post_authorId_idx, which foreign key Post_authorId_fkey uses, is not yet supported on MySQL (Post)',
          location: { entityKind: 'table', entityName: 'Post', index: 'Post_authorId_idx' },
        },
      ],
      replaced: [
        {
          id: 'index.Post.Post_authorId_id_idx',
          sql: ['CREATE INDEX `Post_authorId_id_idx` ON `Post` (`authorId`, `id`)'],
        },
        {
          id: 'dropIndex.Post.Post_authorId_idx',
          sql: ['DROP INDEX `Post_authorId_idx` ON `Post`'],
        },
      ],
    });
  });

  it('drops a table no space owns, and leaves one another space owns or the runner owns', async () => {
    const from = contractOf('from', { User: user, Legacy: user, Shared: user });
    const to = contractOf('to', { User: user });
    const live = mysqlControlTarget.migrations.contractToSchema(from, frameworkComponents);
    const ownership: SchemaOwnership = {
      declaresEntity: ({ entityName }) => entityName === 'Shared',
      namespaceDeclaringSpaces: () => ['app'],
    };
    const result = plan(from, to, { ownership, schema: live });
    expect({
      sql: await sqlOf(result),
      dataLoss: result.kind === 'success' ? result.dataLoss.map(({ subject }) => subject) : [],
    }).toEqual({
      sql: [{ id: 'dropTable.Legacy', sql: ['DROP TABLE `Legacy`'] }],
      dataLoss: [{ kind: 'storage', name: 'Legacy' }],
    });
  });

  it('never drops the marker and ledger tables', async () => {
    const withControlTables = new SqlSchemaIR({
      tables: {
        _prisma_marker: {
          name: '_prisma_marker',
          columns: {},
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
    });
    expect(await sqlOf(plan(null, contractOf('to', {}), { schema: withControlTables }))).toEqual(
      [],
    );
  });

  it('adds a column with a default through the lowerer', async () => {
    const from = contractOf('from', { User: user });
    const to = contractOf('to', {
      User: {
        ...user,
        columns: { ...user.columns, score: { ...int, default: { kind: 'literal', value: 0 } } },
      },
    });
    expect(await sqlOf(plan(from, to))).toEqual([
      {
        id: 'column.User.score',
        sql: ['ALTER TABLE `User` ADD COLUMN `score` int NOT NULL DEFAULT 0'],
      },
    ]);
  });

  it('refuses a primary key change, an expression index and a new autoincrement column', () => {
    const from = contractOf('from', { User: user });
    expect({
      primaryKey: summaries(
        plan(from, contractOf('pk', { User: { ...user, primaryKey: { columns: ['email'] } } })),
      ),
      autoincrement: summaries(
        plan(
          from,
          contractOf('ai', {
            User: {
              ...user,
              columns: {
                ...user.columns,
                seq: { ...int, default: { kind: 'function', expression: 'autoincrement()' } },
              },
            },
          }),
        ),
      ),
    }).toEqual({
      primaryKey: ['Changing a primary key is not yet supported on MySQL (User)'],
      autoincrement: [
        'Adding a required column without a default is not yet supported on MySQL (User.seq)',
      ],
    });
  });

  it('refuses a name longer than 64 characters before anything applies', () => {
    const long = (prefix: string) => `${prefix}_${'x'.repeat(64 - prefix.length)}`;
    const to = contractOf('long', {
      [long('T')]: { columns: { id: int }, primaryKey: { columns: ['id'] } },
      User: {
        ...user,
        columns: { ...user.columns, [long('c')]: { ...int, nullable: true } },
        indexes: [{ columns: ['email'], name: long('i') }],
      },
    });
    expect(summaries(plan(contractOf('from', { User: user }), to))).toEqual([
      `The name ${long('T')} is longer than the 64 characters MySQL allows (${long('T')})`,
      `The name ${long('c')} is longer than the 64 characters MySQL allows (User.${long('c')})`,
      `The name ${long('i')} is longer than the 64 characters MySQL allows (User)`,
    ]);
  });

  it('refuses an autoincrement column that is not the first column of a key', () => {
    const seq = { ...int, default: { kind: 'function', expression: 'autoincrement()' } };
    const refused = contractOf('refused', {
      Counter: { columns: { id: int, seq }, primaryKey: { columns: ['id'] } },
      Pair: { columns: { a: int, seq }, primaryKey: { columns: ['a', 'seq'] } },
    });
    const keyed = contractOf('keyed', {
      Counter: { columns: { seq, id: int }, primaryKey: { columns: ['seq', 'id'] } },
      Tagged: {
        columns: { id: int, seq },
        primaryKey: { columns: ['id'] },
        uniques: [{ columns: ['seq'], name: 'Tagged_seq_key' }],
      },
    });
    expect({
      refused: summaries(plan(null, refused)),
      keyed: summaries(plan(null, keyed)),
    }).toEqual({
      refused: [
        'An autoincrement column that is not the first column of the primary key or a unique constraint is not supported on MySQL (Counter.seq)',
        'An autoincrement column that is not the first column of the primary key or a unique constraint is not supported on MySQL (Pair.seq)',
      ],
      keyed: 'planned',
    });
  });

  it('refuses to plan without the additive class', () => {
    expect(
      summaries(
        plan(null, contractOf('to', { User: user }), { policy: { allowedOperationClasses: [] } }),
      ),
    ).toEqual(['Migration planner requires additive operations be allowed']);
  });

  it('refuses a schema tree MySQL did not build', () => {
    expect(() => plan(null, contractOf('to', {}), { schema: { tables: {} } })).toThrow(
      expect.objectContaining({ code: 'CONTRACT.TARGET_MISMATCH' }),
    );
  });

  it('scaffolds an empty migration for migration new', () => {
    const empty = createMysqlMigrationPlanner(stubLowerer).emptyMigration(
      { packageDir: '/p', fromHash: A, toHash: B, snapshotsImportPath: '../s' },
      'app',
    );
    expect({
      spaceId: empty.spaceId,
      operations: empty.operations,
      describe: empty.describe(),
      source: empty.renderTypeScript((specifier) => specifier).includes('return [\n\n    ];'),
    }).toEqual({
      spaceId: 'app',
      operations: [],
      describe: { from: A, to: B },
      source: true,
    });
  });
});
