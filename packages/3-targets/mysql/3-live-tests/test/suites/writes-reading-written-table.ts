import type { SqlMiddleware } from '@internal/sql-runtime';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { withSeededDatabase } from '../live-database';
import type { LiveServer } from '../live-server';

/** Members, by id: 3 invited 1, 1 invited 2, 2 invited 4. Members 3 and 4 are admins, stored in `Admin` too. */
const members = [
  `CREATE TABLE \`Member\` (
    \`id\` int NOT NULL,
    \`name\` varchar(191) NOT NULL,
    \`kind\` varchar(191) NOT NULL,
    \`invitedById\` int,
    PRIMARY KEY (\`id\`),
    CONSTRAINT \`Member_invitedById_fkey\` FOREIGN KEY (\`invitedById\`) REFERENCES \`Member\` (\`id\`)
  )`,
  `CREATE TABLE \`Admin\` (
    \`id\` int NOT NULL,
    \`level\` int NOT NULL,
    PRIMARY KEY (\`id\`),
    CONSTRAINT \`Admin_id_fkey\` FOREIGN KEY (\`id\`) REFERENCES \`Member\` (\`id\`) ON DELETE CASCADE
  )`,
  "INSERT INTO `Member` (`id`, `name`, `kind`, `invitedById`) VALUES (3, 'a', 'admin', NULL), (1, 'a', 'user', 3), (2, 'b', 'user', 1), (4, 'd', 'admin', 2)",
  'INSERT INTO `Admin` (`id`, `level`) VALUES (3, 1), (4, 2)',
] as const;

export function describeWritesReadingWrittenTable(server: LiveServer): void {
  describe(`${server.displayName} writes whose filter reads the written table`, {
    timeout: timeouts.databaseOperation,
  }, () => {
    it('updateAll filtered by a self-relation updates the rows that matched before the statement changed any', async (test) => {
      await withSeededDatabase(test, server, members, async (url) => {
        const updates: string[] = [];
        const recordsUpdates: SqlMiddleware = {
          name: 'update-recorder',
          intercept: {
            async onExecute(plan) {
              if (plan.sql.startsWith('UPDATE')) updates.push(plan.sql);
              return undefined;
            },
          },
        };
        await using db = server.client({ url, verifyMarker: false, middleware: [recordsUpdates] });
        const stored = () =>
          db.orm.Member.select('id', 'name')
            .orderBy((member) => member.id.asc())
            .all();
        expect({
          updated: await db.orm.Member.where((member) =>
            member.invitedBy.some((inviter) => inviter.name.eq('a')),
          )
            .select('id', 'name')
            .orderBy((member) => member.id.asc())
            .updateAll({ name: 'z' }),
          stored: await stored(),
        }).toEqual({
          updated: [
            { id: 1, name: 'z' },
            { id: 2, name: 'z' },
          ],
          stored: [
            { id: 1, name: 'z' },
            { id: 2, name: 'z' },
            { id: 3, name: 'a' },
            { id: 4, name: 'd' },
          ],
        });
        expect(updates).toEqual([server.expected.updateFilteredBySelfRelation]);
      });
    });

    it('deleteAll filtered by a self-relation deletes the rows that matched before the statement deleted any', async (test) => {
      await withSeededDatabase(test, server, members, async (url) => {
        await using db = server.client({ url, verifyMarker: false });
        expect({
          deleted: await db.orm.Member.where((member) => member.invitees.none())
            .select('id')
            .deleteAll(),
          stored: await db.orm.Member.select('id')
            .orderBy((member) => member.id.asc())
            .all(),
        }).toEqual({
          deleted: [{ id: 4 }],
          stored: [{ id: 1 }, { id: 2 }, { id: 3 }],
        });
      });
    });

    it('a nested updateAll filtered by a self-relation updates the related rows that match', async (test) => {
      await withSeededDatabase(test, server, members, async (url) => {
        await using db = server.client({ url, verifyMarker: false });
        expect({
          parent: await db.orm.Member.where({ id: 3 })
            .select('id')
            .update({
              invitees: (invitees) =>
                invitees.where((member) => member.invitees.some()).updateAll({ name: 'z' }),
            }),
          stored: await db.orm.Member.select('id', 'name')
            .orderBy((member) => member.id.asc())
            .all(),
        }).toEqual({
          parent: { id: 3 },
          stored: [
            { id: 1, name: 'z' },
            { id: 2, name: 'b' },
            { id: 3, name: 'a' },
            { id: 4, name: 'd' },
          ],
        });
      });
    });

    it('updateAll and deleteAll on a variant stored in its own table write that variant only', async (test) => {
      await withSeededDatabase(test, server, members, async (url) => {
        await using db = server.client({ url, verifyMarker: false });
        const admins = db.orm.Member.variant('admin');
        const stored = () =>
          db.orm.Member.select('id', 'name')
            .orderBy((member) => member.id.asc())
            .all();
        const updated = await admins
          .select('id', 'name')
          .orderBy((member) => member.id.asc())
          .updateAll({ name: 'z' });
        const afterUpdate = await stored();
        expect({
          updated,
          afterUpdate,
          deleted: await admins.where({ id: 4 }).select('id').deleteAll(),
          afterDelete: await stored(),
        }).toEqual({
          updated: [
            { id: 3, name: 'z' },
            { id: 4, name: 'z' },
          ],
          afterUpdate: [
            { id: 1, name: 'a' },
            { id: 2, name: 'b' },
            { id: 3, name: 'z' },
            { id: 4, name: 'z' },
          ],
          deleted: [{ id: 4 }],
          afterDelete: [
            { id: 1, name: 'a' },
            { id: 2, name: 'b' },
            { id: 3, name: 'z' },
          ],
        });
      });
    });
  });
}
