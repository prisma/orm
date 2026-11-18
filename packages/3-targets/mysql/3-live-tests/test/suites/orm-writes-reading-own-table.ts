import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { withSeededDatabase } from '../live-database';
import type { LiveServer } from '../live-server';

/** Tasks 1 and 2 have subtasks; 1, 2 and 5 are features, stored in `Feature` too; 3 and 4 are bugs, stored in `Task` alone. */
const taskTree = [
  `CREATE TABLE \`Task\` (
    \`id\` int NOT NULL,
    \`title\` varchar(191) NOT NULL,
    \`type\` varchar(191) NOT NULL,
    \`parentId\` int NULL,
    \`severity\` varchar(191) NULL,
    PRIMARY KEY (\`id\`)
  )`,
  `CREATE TABLE \`Feature\` (
    \`id\` int NOT NULL,
    \`priority\` int NOT NULL,
    PRIMARY KEY (\`id\`),
    CONSTRAINT \`Feature_id_fkey\` FOREIGN KEY (\`id\`) REFERENCES \`Task\` (\`id\`) ON DELETE CASCADE
  )`,
  "INSERT INTO `Task` (`id`, `title`, `type`, `parentId`, `severity`) VALUES (1, 'Launch', 'feature', NULL, NULL), (2, 'Checkout', 'feature', 1, NULL), (3, 'Crash', 'bug', 1, 'critical'), (4, 'Typo', 'bug', 2, 'minor'), (5, 'Backlog', 'feature', NULL, NULL)",
  'INSERT INTO `Feature` (`id`, `priority`) VALUES (1, 10), (2, 20), (5, 50)',
] as const;

export function describeOrmWritesReadingOwnTable(server: LiveServer): void {
  describe(`${server.displayName} writes through the ORM whose filter reads the written table`, {
    timeout: timeouts.databaseOperation,
  }, () => {
    it('updates the rows a filter on a relation from the model to itself selects', async (test) => {
      await withSeededDatabase(test, server, taskTree, async (url) => {
        await using db = server.client({ url, verifyMarker: false });
        expect({
          updated: await db.orm.Task.where((task) =>
            task.subtasks.some((subtask) => subtask.type.eq('bug')),
          )
            .select('id', 'title')
            .orderBy((task) => task.id.asc())
            .updateAll({ title: 'Has bugs' }),
          counted: await db.orm.Task.where((task) =>
            task.subtasks.some((subtask) => subtask.type.eq('feature')),
          ).updateAndCount({ title: 'Has features' }),
          first: await db.orm.Task.where((task) => task.subtasks.none())
            .where({ type: 'feature' })
            .select('id', 'title')
            .update({ title: 'Leaf' }),
          stored: await db.orm.Task.select('id', 'title')
            .orderBy((task) => task.id.asc())
            .all(),
        }).toEqual({
          updated: [
            { id: 1, title: 'Has bugs' },
            { id: 2, title: 'Has bugs' },
          ],
          counted: 1,
          first: { id: 5, title: 'Leaf' },
          stored: [
            { id: 1, title: 'Has features' },
            { id: 2, title: 'Has bugs' },
            { id: 3, title: 'Crash' },
            { id: 4, title: 'Typo' },
            { id: 5, title: 'Leaf' },
          ],
        });
      });
    });

    it('deletes the rows a filter on a relation from the model to itself selects', async (test) => {
      await withSeededDatabase(test, server, taskTree, async (url) => {
        await using db = server.client({ url, verifyMarker: false });
        expect({
          deleted: await db.orm.Task.where((task) => task.subtasks.none())
            .where({ type: 'bug' })
            .select('id')
            .orderBy((task) => task.id.asc())
            .deleteAll(),
          counted: await db.orm.Task.where((task) => task.subtasks.none()).deleteAndCount(),
          first: await db.orm.Task.where((task) => task.subtasks.none())
            .select('id', 'title')
            .delete(),
          remaining: await db.orm.Task.all(),
          features: await db.orm.Task.variant('feature').all(),
        }).toEqual({
          deleted: [{ id: 3 }, { id: 4 }],
          counted: 2,
          first: { id: 1, title: 'Launch' },
          remaining: [],
          features: [],
        });
      });
    });

    it('updates the rows of a variant stored in its own table', async (test) => {
      await withSeededDatabase(test, server, taskTree, async (url) => {
        await using db = server.client({ url, verifyMarker: false });
        expect({
          updated: await db.orm.Task.variant('feature')
            .where((task) => task.id.gte(2))
            .orderBy((task) => task.id.asc())
            .updateAll({ title: 'Later' }),
          counted: await db.orm.Task.variant('feature')
            .where((task) => task.subtasks.some((subtask) => subtask.type.eq('feature')))
            .updateAndCount({ title: 'Has features' }),
          first: await db.orm.Task.variant('feature').where({ id: 2 }).update({ title: 'Second' }),
          stored: await db.orm.Task.orderBy((task) => task.id.asc()).all(),
        }).toEqual({
          updated: [
            { id: 2, title: 'Later', type: 'feature', parentId: 1, priority: 20 },
            { id: 5, title: 'Later', type: 'feature', parentId: null, priority: 50 },
          ],
          counted: 1,
          first: { id: 2, title: 'Second', type: 'feature', parentId: 1, priority: 20 },
          stored: [
            { id: 1, title: 'Has features', type: 'feature', parentId: null, priority: 10 },
            { id: 2, title: 'Second', type: 'feature', parentId: 1, priority: 20 },
            { id: 3, title: 'Crash', type: 'bug', parentId: 1, severity: 'critical' },
            { id: 4, title: 'Typo', type: 'bug', parentId: 2, severity: 'minor' },
            { id: 5, title: 'Later', type: 'feature', parentId: null, priority: 50 },
          ],
        });
      });
    });

    it('deletes the rows of a variant stored in its own table', async (test) => {
      await withSeededDatabase(test, server, taskTree, async (url) => {
        await using db = server.client({ url, verifyMarker: false });
        expect({
          deleted: await db.orm.Task.variant('feature')
            .where((task) => task.subtasks.none())
            .deleteAll(),
          counted: await db.orm.Task.variant('feature')
            .where((task) => task.id.gte(2))
            .deleteAndCount(),
          first: await db.orm.Task.variant('feature').delete(),
          missing: await db.orm.Task.variant('feature').delete(),
          remaining: await db.orm.Task.orderBy((task) => task.id.asc()).all(),
        }).toEqual({
          deleted: [{ id: 5, title: 'Backlog', type: 'feature', parentId: null, priority: 50 }],
          counted: 1,
          first: { id: 1, title: 'Launch', type: 'feature', parentId: null, priority: 10 },
          missing: null,
          remaining: [
            { id: 3, title: 'Crash', type: 'bug', parentId: 1, severity: 'critical' },
            { id: 4, title: 'Typo', type: 'bug', parentId: 2, severity: 'minor' },
          ],
        });
      });
    });
  });
}
