import type { SqlQueryable, SqlTransaction } from '@internal/sql-relational-core/ast';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it, type TestContext, vi } from 'vitest';
import { withSeededDatabase } from '../live-database';
import type { LiveServer } from '../live-server';

const taskTable = `CREATE TABLE \`Task\` (
    \`id\` int NOT NULL,
    \`title\` varchar(191) NOT NULL,
    \`type\` varchar(191) NOT NULL,
    \`parentId\` int NULL,
    \`severity\` varchar(191) NULL,
    PRIMARY KEY (\`id\`)
  )`;

/** Tasks 1 and 2 have subtasks; 1, 2 and 5 are features, stored in `Feature` too; 3 and 4 are bugs, stored in `Task` alone. */
const taskTree = [
  taskTable,
  `CREATE TABLE \`Feature\` (
    \`id\` int NOT NULL,
    \`priority\` int NOT NULL,
    PRIMARY KEY (\`id\`),
    CONSTRAINT \`Feature_id_fkey\` FOREIGN KEY (\`id\`) REFERENCES \`Task\` (\`id\`) ON DELETE CASCADE
  )`,
  "INSERT INTO `Task` (`id`, `title`, `type`, `parentId`, `severity`) VALUES (1, 'Launch', 'feature', NULL, NULL), (2, 'Checkout', 'feature', 1, NULL), (3, 'Crash', 'bug', 1, 'critical'), (4, 'Typo', 'bug', 2, 'minor'), (5, 'Backlog', 'feature', NULL, NULL)",
  'INSERT INTO `Feature` (`id`, `priority`) VALUES (1, 10), (2, 20), (5, 50)',
] as const;

/** A chain whose child has a lower id than its parent: 1's parent is 2, and 2's parent is 3. */
const upwardChain = [
  taskTable,
  'CREATE TABLE `Feature` (`id` int NOT NULL, `priority` int NOT NULL, PRIMARY KEY (`id`))',
  "INSERT INTO `Task` (`id`, `title`, `type`, `parentId`, `severity`) VALUES (1, 'Leaf', 'bug', 2, 'minor'), (2, 'Middle', 'bug', 3, 'minor'), (3, 'Root', 'bug', NULL, 'minor')",
] as const;

const seededTasks = [
  { id: 1, title: 'Launch', type: 'feature', parentId: null, priority: 10 },
  { id: 2, title: 'Checkout', type: 'feature', parentId: 1, priority: 20 },
  { id: 3, title: 'Crash', type: 'bug', parentId: 1, severity: 'critical' },
  { id: 4, title: 'Typo', type: 'bug', parentId: 2, severity: 'minor' },
  { id: 5, title: 'Backlog', type: 'feature', parentId: null, priority: 50 },
];

const isWrite = (sql: string) => /^(UPDATE|DELETE)\b/.test(sql);

function recordStatements(queryable: SqlQueryable, sent: string[]): void {
  const query = queryable.query.bind(queryable);
  const execute = queryable.execute.bind(queryable);
  vi.spyOn(queryable, 'query').mockImplementation((request) => {
    sent.push(request.sql);
    return query(request);
  });
  vi.spyOn(queryable, 'execute').mockImplementation((request) => {
    sent.push(request.sql);
    return execute(request);
  });
}

function recordTransaction(transaction: SqlTransaction, sent: string[]): SqlTransaction {
  const savepoint = transaction.savepoint.bind(transaction);
  vi.spyOn(transaction, 'savepoint').mockImplementation(async (name) =>
    recordTransaction(await savepoint(name), sent),
  );
  recordStatements(transaction, sent);
  return transaction;
}

/** Records the SQL of every statement the clients the server creates from now on send, until the test ends. */
function watchStatements(server: LiveServer, test: TestContext): string[] {
  const sent: string[] = [];
  const create = server.runtimeDriver.create.bind(server.runtimeDriver);
  const spy = vi.spyOn(server.runtimeDriver, 'create').mockImplementation((...args) => {
    const driver = create(...args);
    recordStatements(driver, sent);
    const acquire = driver.acquireConnection.bind(driver);
    vi.spyOn(driver, 'acquireConnection').mockImplementation(async () => {
      const connection = await acquire();
      recordStatements(connection, sent);
      const begin = connection.beginTransaction.bind(connection);
      vi.spyOn(connection, 'beginTransaction').mockImplementation(async (start) =>
        recordTransaction(await begin(start), sent),
      );
      return connection;
    });
    return driver;
  });
  test.onTestFinished(() => spy.mockRestore());
  return sent;
}

/** The value a write resolves to, or the code and message of the error it is refused with, and whether it sent an UPDATE or DELETE. */
async function outcome<T>(
  sent: readonly string[],
  write: PromiseLike<T>,
): Promise<{ readonly result: T | { refused: unknown }; readonly wrote: boolean }> {
  const before = sent.length;
  const wrote = () => sent.slice(before).some(isWrite);
  try {
    return { result: await write, wrote: wrote() };
  } catch (error) {
    return {
      result: { refused: { code: Object(error).code, message: Object(error).message } },
      wrote: wrote(),
    };
  }
}

export function describeOrmWritesReadingOwnTable(server: LiveServer): void {
  const runs = server.expected.writeReadingWrittenTable === 'runs';
  const refused = {
    result: {
      refused: {
        code: 'RUNTIME.AST_UNSUPPORTED',
        message: `${server.displayName} cannot run an UPDATE or DELETE whose filter or values read the table being written, \`Task\``,
      },
    },
    wrote: false,
  };
  const written = <T>(result: T) => ({ result, wrote: true });

  describe(`${server.displayName} writes through the ORM whose filter reads the written table`, {
    timeout: timeouts.databaseOperation,
  }, () => {
    it('updates the rows a filter on a relation from the model to itself selects', async (test) => {
      await withSeededDatabase(server, taskTree, async (url) => {
        const sent = watchStatements(server, test);
        await using db = server.client({ url, verifyMarker: false });
        expect({
          updated: await outcome(
            sent,
            db.orm.Task.where((task) => task.subtasks.some((subtask) => subtask.type.eq('bug')))
              .select('id', 'title')
              .orderBy((task) => task.id.asc())
              .updateAll({ title: 'Has bugs' }),
          ),
          counted: await outcome(
            sent,
            db.orm.Task.where((task) =>
              task.subtasks.some((subtask) => subtask.type.eq('feature')),
            ).updateAndCount({ title: 'Has features' }),
          ),
          first: await outcome(
            sent,
            db.orm.Task.where((task) => task.subtasks.none())
              .where({ type: 'feature' })
              .select('id', 'title')
              .update({ title: 'Leaf' }),
          ),
          pinned: await outcome(
            sent,
            db.orm.Task.where((task) => task.subtasks.none())
              .where({ id: 4 })
              .select('id', 'title')
              .update({ title: 'Pinned' }),
          ),
          stored: await db.orm.Task.select('id', 'title')
            .orderBy((task) => task.id.asc())
            .all(),
        }).toEqual(
          runs
            ? {
                updated: written([
                  { id: 1, title: 'Has bugs' },
                  { id: 2, title: 'Has bugs' },
                ]),
                counted: written(1),
                first: written({ id: 5, title: 'Leaf' }),
                pinned: written({ id: 4, title: 'Pinned' }),
                stored: [
                  { id: 1, title: 'Has features' },
                  { id: 2, title: 'Has bugs' },
                  { id: 3, title: 'Crash' },
                  { id: 4, title: 'Pinned' },
                  { id: 5, title: 'Leaf' },
                ],
              }
            : {
                updated: refused,
                counted: refused,
                first: written({ id: 5, title: 'Leaf' }),
                pinned: refused,
                stored: seededTasks.map(({ id, title }) => ({
                  id,
                  title: id === 5 ? 'Leaf' : title,
                })),
              },
        );
      });
    });

    it('deletes the rows a filter on a relation from the model to itself selects', async (test) => {
      await withSeededDatabase(server, taskTree, async (url) => {
        const sent = watchStatements(server, test);
        await using db = server.client({ url, verifyMarker: false });
        expect({
          pinned: await outcome(
            sent,
            db.orm.Task.where((task) => task.subtasks.none())
              .where({ id: 5 })
              .select('id')
              .delete(),
          ),
          deleted: await outcome(
            sent,
            db.orm.Task.where((task) => task.subtasks.none())
              .where({ type: 'bug' })
              .select('id')
              .orderBy((task) => task.id.asc())
              .deleteAll(),
          ),
          counted: await outcome(
            sent,
            db.orm.Task.where((task) => task.subtasks.none()).deleteAndCount(),
          ),
          first: await outcome(
            sent,
            db.orm.Task.where((task) => task.subtasks.none())
              .select('id', 'title')
              .orderBy((task) => task.id.asc())
              .delete(),
          ),
          remaining: await db.orm.Task.orderBy((task) => task.id.asc()).all(),
          features: await db.orm.Task.variant('feature')
            .select('id')
            .orderBy((task) => task.id.asc())
            .all(),
        }).toEqual(
          runs
            ? {
                pinned: written({ id: 5 }),
                deleted: written([{ id: 3 }, { id: 4 }]),
                counted: written(1),
                first: written({ id: 1, title: 'Launch' }),
                remaining: [],
                features: [],
              }
            : {
                pinned: refused,
                deleted: refused,
                counted: refused,
                first: written({ id: 3, title: 'Crash' }),
                remaining: seededTasks.filter((task) => task.id !== 3),
                features: [{ id: 1 }, { id: 2 }, { id: 5 }],
              },
        );
      });
    });

    it.runIf(runs)(
      'evaluates the filter against the rows as they were before the statement',
      async () => {
        await withSeededDatabase(server, upwardChain, async (url) => {
          await using db = server.client({ url, verifyMarker: false });
          expect({
            counted: await db.orm.Task.where((task) => task.subtasks.none()).deleteAndCount(),
            remaining: await db.orm.Task.select('id', 'title')
              .orderBy((task) => task.id.asc())
              .all(),
          }).toEqual({
            counted: 1,
            remaining: [
              { id: 2, title: 'Middle' },
              { id: 3, title: 'Root' },
            ],
          });
        });
      },
    );

    it('updates the rows of a variant stored in its own table', async (test) => {
      await withSeededDatabase(server, taskTree, async (url) => {
        const sent = watchStatements(server, test);
        await using db = server.client({ url, verifyMarker: false });
        expect({
          updated: await outcome(
            sent,
            db.orm.Task.variant('feature')
              .where((task) => task.id.gte(2))
              .orderBy((task) => task.id.asc())
              .updateAll({ title: 'Later' }),
          ),
          counted: await outcome(
            sent,
            db.orm.Task.variant('feature')
              .where((task) => task.subtasks.some((subtask) => subtask.type.eq('feature')))
              .updateAndCount({ title: 'Has features' }),
          ),
          first: await outcome(
            sent,
            db.orm.Task.variant('feature').where({ id: 2 }).update({ title: 'Second' }),
          ),
          stored: await db.orm.Task.orderBy((task) => task.id.asc()).all(),
        }).toEqual(
          runs
            ? {
                updated: written([
                  { id: 2, title: 'Later', type: 'feature', parentId: 1, priority: 20 },
                  { id: 5, title: 'Later', type: 'feature', parentId: null, priority: 50 },
                ]),
                counted: written(1),
                first: written({
                  id: 2,
                  title: 'Second',
                  type: 'feature',
                  parentId: 1,
                  priority: 20,
                }),
                stored: [
                  { id: 1, title: 'Has features', type: 'feature', parentId: null, priority: 10 },
                  { id: 2, title: 'Second', type: 'feature', parentId: 1, priority: 20 },
                  { id: 3, title: 'Crash', type: 'bug', parentId: 1, severity: 'critical' },
                  { id: 4, title: 'Typo', type: 'bug', parentId: 2, severity: 'minor' },
                  { id: 5, title: 'Later', type: 'feature', parentId: null, priority: 50 },
                ],
              }
            : {
                updated: refused,
                counted: refused,
                first: written({
                  id: 2,
                  title: 'Second',
                  type: 'feature',
                  parentId: 1,
                  priority: 20,
                }),
                stored: seededTasks.map((task) =>
                  task.id === 2 ? { ...task, title: 'Second' } : task,
                ),
              },
        );
      });
    });

    it('deletes the rows of a variant stored in its own table', async (test) => {
      await withSeededDatabase(server, taskTree, async (url) => {
        const sent = watchStatements(server, test);
        await using db = server.client({ url, verifyMarker: false });
        expect({
          deleted: await outcome(
            sent,
            db.orm.Task.variant('feature')
              .where((task) => task.subtasks.none())
              .deleteAll(),
          ),
          counted: await outcome(
            sent,
            db.orm.Task.variant('feature')
              .where((task) => task.id.gte(2))
              .deleteAndCount(),
          ),
          byKey: await outcome(
            sent,
            db.orm.Task.variant('feature').where({ id: 1 }).select('id', 'title', 'type').delete(),
          ),
          first: await outcome(
            sent,
            db.orm.Task.variant('feature')
              .orderBy((task) => task.id.asc())
              .delete(),
          ),
          second: await db.orm.Task.variant('feature')
            .orderBy((task) => task.id.asc())
            .delete(),
          remaining: await db.orm.Task.orderBy((task) => task.id.asc()).all(),
        }).toEqual(
          runs
            ? {
                deleted: written([
                  { id: 5, title: 'Backlog', type: 'feature', parentId: null, priority: 50 },
                ]),
                counted: written(1),
                byKey: written({ id: 1, title: 'Launch', type: 'feature' }),
                first: { result: null, wrote: false },
                second: null,
                remaining: [
                  { id: 3, title: 'Crash', type: 'bug', parentId: 1, severity: 'critical' },
                  { id: 4, title: 'Typo', type: 'bug', parentId: 2, severity: 'minor' },
                ],
              }
            : {
                deleted: refused,
                counted: refused,
                byKey: written({ id: 1, title: 'Launch', type: 'feature' }),
                first: written({
                  id: 2,
                  title: 'Checkout',
                  type: 'feature',
                  parentId: 1,
                  priority: 20,
                }),
                second: { id: 5, title: 'Backlog', type: 'feature', parentId: null, priority: 50 },
                remaining: seededTasks.filter((task) => task.id === 3 || task.id === 4),
              },
        );
      });
    });
  });
}
