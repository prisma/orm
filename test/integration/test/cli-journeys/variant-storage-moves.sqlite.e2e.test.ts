/**
 * A variant that moves between its base's table and a table of its own (SQLite).
 *
 * The SQLite twin of `variant-storage-moves.e2e.test.ts`, driven through a file database and the SQLite facade config. `Task` is stored in table `task` and discriminated by `type`; its variants `Bug` and `Epic` share `task`, each with a column of its own. Each journey runs once through `migration plan` and `db migrate`, and once through `db update`.
 *
 * A table is renamed only when everything stored in it moves. A variant that gains or loses a table of its own moves alone, so no rename is planned: that is a data migration, and the plan asks about the data it drops.
 *
 * - J1: `Bug` gains `@@map("bug")`, then loses it. Each time the plan asks about `Bug.severity`, and no row of `Task` or `Epic` moves.
 * - J2: `--rename Bug:Defect`, where `Defect` has a table of its own, is refused, since the rename would move the whole table `task`. The advice is followed: without the statement the plan asks about `Bug`, offering the same rename first, and `--delete Bug` deletes its rows and leaves every other row in place.
 * - J3: the same refusal, through `migration plan` only, followed by the hand-written migration its advice describes: `migration new`, a table `defect` filled from the rows of `Bug`, and the column `severity` dropped from `task`. Every row stays in `task`, and `defect` holds the values of `Bug`.
 */

import type { Diagnostic } from '@prisma/cli-engine/protocol';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import { timeouts } from '../utils/journey-test-helpers';
import {
  COMMANDS,
  emit,
  expectSettled,
  migrateByHand,
  planAndApply,
  refusal,
  rows,
  type StoredNameJourney,
  sqliteJourney,
  start,
  tableNames,
} from '../utils/stored-name-journeys';

function taskContract(bug: { readonly name: string; readonly table?: string }): string {
  return `// use prisma-8

model Task {
  id   Int    @id
  type String
  @@discriminator(type)
  @@map("task")
}

model ${bug.name} {
  severity String?
  @@base(Task, "bug")
${bug.table === undefined ? '' : `  @@map("${bug.table}")\n`}}

model Epic {
  scope String?
  @@base(Task, "epic")
}
`;
}

const SHARED = taskContract({ name: 'Bug' });

const SEED = `INSERT INTO "task" (id, type, severity, scope) VALUES (1, 'bug', 'high', NULL), (2, 'epic', NULL, 'big'), (3, 'bug', NULL, NULL)`;

const BUG_RENAME_REFUSED: Diagnostic = {
  code: 'MIGRATION.PLANNING_FAILED',
  severity: 'error',
  summary: 'Migration planning failed',
  why: 'Cannot rename table "task" to "defect": table "task" also stores models "Epic" and "Task"',
  nextActions: [
    {
      kind: 'user-choice',
      label:
        'A table rename moves every row of the table, and the rows of models "Epic" and "Task" do not move to table "defect". Moving the rows of one model out of a table it shares with others is a data migration, which a plan does not write. Leave out this statement to plan the change without moving them: the plan then asks about the data it drops. A question about model "Bug" offers this same rename again, which is refused again for the same reason. Answer it with --delete, which it also offers: that plans the change and deletes the data. To keep the data with migration plan, write this change as a hand-written migration instead: run prisma migration new, and in the operations of the migration.ts it writes, rewrite the rows of model "Bug" into table "defect" yourself, with the other operations of the change. Then run that migration.ts to emit its ops.json.',
    },
  ],
  meta: {
    conflicts: [
      {
        kind: 'statementRefused',
        summary:
          'Cannot rename table "task" to "defect": table "task" also stores models "Epic" and "Task"',
        why: 'A table rename moves every row of the table, and the rows of models "Epic" and "Task" do not move to table "defect". Moving the rows of one model out of a table it shares with others is a data migration, which a plan does not write. Leave out this statement to plan the change without moving them: the plan then asks about the data it drops. A question about model "Bug" offers this same rename again, which is refused again for the same reason. Answer it with --delete, which it also offers: that plans the change and deletes the data. To keep the data with migration plan, write this change as a hand-written migration instead: run prisma migration new, and in the operations of the migration.ts it writes, rewrite the rows of model "Bug" into table "defect" yourself, with the other operations of the change. Then run that migration.ts to emit its ops.json.',
        location: {
          entityKind: 'table',
          entityName: 'task',
        },
        refusedStatement: {
          kind: 'rename',
          entity: 'model',
          from: {
            model: 'Bug',
          },
          to: {
            model: 'Defect',
          },
        },
      },
    ],
  },
  docsUrl: 'https://docs.prisma.io/docs/orm/v8/reference/error-reference#MIGRATION.PLANNING_FAILED',
};

async function task(journey: StoredNameJourney) {
  return rows(journey, 'SELECT * FROM "task" ORDER BY id');
}

withTempDir(({ createTempDir }) => {
  describe.each(COMMANDS)(
    'Journey J1 (SQLite): a variant moves to a table of its own and back, with %s',
    (command) => {
      it(
        'plans no rename, asks about the variant field each way, and moves no row of another model',
        async () => {
          const journey = sqliteJourney(createTempDir, command);
          await start(journey, SHARED, SEED, 'J1.01');
          await emit(journey, taskContract({ name: 'Bug', table: 'bug' }), 'J1.02');

          const asked = await refusal(journey, [], 'J1.03');
          expect(asked, 'J1.03: the question names Bug.severity').toEqual({
            code: 'CLI.CONSENT_REQUIRED',
            severity: 'error',
            summary: '"Bug.severity" needs a statement, and the session is not interactive.',
            why: 'Drop column "severity" from "task" would lose the values of field "Bug.severity".',
            nextActions: [
              {
                kind: 'user-choice',
                label: 'Run the command again with --delete Bug.severity',
              },
            ],
            meta: {
              subject: 'Bug.severity',
              verbs: ['delete'],
              unanswered: [
                {
                  subject: 'Bug.severity',
                  verbs: ['delete'],
                },
              ],
            },
            docsUrl:
              'https://docs.prisma.io/docs/orm/v8/reference/error-reference/CLI.CONSENT_REQUIRED',
          });
          const away = await planAndApply(journey, ['--delete', 'Bug.severity'], 'J1.04');
          expect(away, 'J1.04: no rename').toEqual([
            {
              label: 'Create table bug',
              operationClass: 'additive',
            },
            {
              label: 'Drop column "severity" from "task"',
              operationClass: 'destructive',
            },
          ]);
          expect(await tableNames(journey), 'J1.05: the variant table is new').toEqual([
            'bug',
            'task',
          ]);
          expect(await task(journey), 'J1.05: every row stays in task').toEqual([
            { id: 1, type: 'bug', scope: null },
            { id: 2, type: 'epic', scope: 'big' },
            { id: 3, type: 'bug', scope: null },
          ]);

          await emit(journey, SHARED, 'J1.06');
          const askedBack = await refusal(journey, [], 'J1.07');
          expect(askedBack, 'J1.07: the question names Bug').toEqual({
            code: 'CLI.CONSENT_REQUIRED',
            severity: 'error',
            summary: '"Bug" needs a statement, and the session is not interactive.',
            why: 'Drop table "bug" would lose the data of model "Bug".',
            nextActions: [
              {
                kind: 'user-choice',
                label: 'Run the command again with --delete Bug',
              },
            ],
            meta: {
              subject: 'Bug',
              verbs: ['delete'],
              unanswered: [
                {
                  subject: 'Bug',
                  verbs: ['delete'],
                },
              ],
            },
            docsUrl:
              'https://docs.prisma.io/docs/orm/v8/reference/error-reference/CLI.CONSENT_REQUIRED',
          });
          const back = await planAndApply(journey, ['--delete', 'Bug'], 'J1.08');
          expect(back, 'J1.08: no rename').toEqual([
            {
              label: 'Add column severity on task',
              operationClass: 'additive',
            },
            {
              label: 'Drop table "bug"',
              operationClass: 'destructive',
            },
          ]);
          expect(await tableNames(journey), 'J1.09: the variant table is gone').toEqual(['task']);
          expect(await task(journey), 'J1.09: every row stays in task').toEqual([
            { id: 1, type: 'bug', scope: null, severity: null },
            { id: 2, type: 'epic', scope: 'big', severity: null },
            { id: 3, type: 'bug', scope: null, severity: null },
          ]);
          await expectSettled(journey, 'J1.10');
        },
        timeouts.spinUpPpgDev,
      );
    },
  );

  describe.each(COMMANDS)(
    'Journey J2 (SQLite): --rename of a variant that leaves a shared table, with %s',
    (command) => {
      it(
        'is refused, and without the statement --delete Bug leaves every other row in place',
        async () => {
          const journey = sqliteJourney(createTempDir, command);
          await start(journey, SHARED, SEED, 'J2.01');
          await emit(journey, taskContract({ name: 'Defect', table: 'defect' }), 'J2.02');

          const refused = await refusal(journey, ['--rename', 'Bug:Defect'], 'J2.03');
          expect(refused, 'J2.03: the statement is refused').toEqual(BUG_RENAME_REFUSED);

          const asked = await refusal(journey, [], 'J2.04');
          expect(
            asked,
            'J2.04: the plan asks about Bug, and offers the rename the planner refused',
          ).toEqual({
            code: 'CLI.CONSENT_REQUIRED',
            severity: 'error',
            summary: '"Bug" needs a statement, and the session is not interactive.',
            why: 'These operations would lose the data of model "Bug":\n- Drop column "severity" from "task"\n- Delete the rows of "task" that hold value "bug" in column "type"\nSQLite migrations run with foreign keys off, so deleting these rows does not delete the rows of "defect" that reference them: the apply then fails at PRAGMA foreign_key_check. Delete or change those rows first.',
            nextActions: [
              {
                kind: 'user-choice',
                label: 'Run the command again with --rename Bug:Defect',
              },
              {
                kind: 'user-choice',
                label: 'Run the command again with --delete Bug',
              },
            ],
            meta: {
              subject: 'Bug',
              verbs: ['rename', 'delete'],
              unanswered: [
                {
                  subject: 'Bug',
                  verbs: ['rename', 'delete'],
                },
              ],
            },
            docsUrl:
              'https://docs.prisma.io/docs/orm/v8/reference/error-reference/CLI.CONSENT_REQUIRED',
          });
          const planned = await planAndApply(journey, ['--delete', 'Bug'], 'J2.05');
          expect(planned, 'J2.05: no rename').toEqual([
            {
              label: 'Create table defect',
              operationClass: 'additive',
            },
            {
              label: 'Drop column "severity" from "task"',
              operationClass: 'destructive',
            },
            {
              label: 'Delete the rows of "task" that hold value "bug" in column "type"',
              operationClass: 'destructive',
            },
          ]);
          expect(await tableNames(journey), 'J2.06: the variant table is new').toEqual([
            'defect',
            'task',
          ]);
          expect(
            await task(journey),
            'J2.06: the rows of Bug are deleted, and no other row moves',
          ).toEqual([{ id: 2, type: 'epic', scope: 'big' }]);
          await expectSettled(journey, 'J2.07');
        },
        timeouts.spinUpPpgDev,
      );
    },
  );
  describe('Journey J3 (SQLite): --rename of a variant that leaves a shared table, kept by a hand-written migration', () => {
    it(
      'is refused, and the hand-written migration its advice describes keeps the rows of Bug',
      async () => {
        const journey = sqliteJourney(createTempDir, 'migration plan');
        await start(journey, SHARED, SEED, 'J3.01');
        await emit(journey, taskContract({ name: 'Defect', table: 'defect' }), 'J3.02');
        expect(
          await refusal(journey, ['--rename', 'Bug:Defect'], 'J3.03'),
          'J3.03: the statement is refused',
        ).toEqual(BUG_RENAME_REFUSED);

        await migrateByHand(
          journey,
          ['col', 'foreignKey', 'primaryKey', 'rawSql'],
          `      this.createTable({
        table: 'defect',
        columns: [
          col('id', 'INTEGER', { notNull: true, codecRef: { codecId: 'sqlite/integer@1' } }),
          col('severity', 'TEXT', { codecRef: { codecId: 'sqlite/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          foreignKey(['id'], 'task', ['id'], { onDelete: 'cascade' }),
        ],
      }),
      rawSql({
        id: 'data_migration.bug-rows-into-defect',
        label: 'Copy the rows of Bug into "defect"',
        operationClass: 'data',
        target: { id: 'sqlite' },
        precheck: [],
        execute: [
          {
            description: 'copy the severity of each bug into "defect"',
            sql: 'INSERT INTO "defect" (id, severity) SELECT id, severity FROM "task" WHERE type = \\'bug\\'',
          },
        ],
        postcheck: [],
      }),
      this.dropColumn({ table: 'task', column: 'severity' }),`,
          'J3.04',
        );

        expect(await tableNames(journey), 'J3.05: the variant table is new').toEqual([
          'defect',
          'task',
        ]);
        expect(await task(journey), 'J3.05: every row stays in task').toEqual([
          { id: 1, type: 'bug', scope: null },
          { id: 2, type: 'epic', scope: 'big' },
          { id: 3, type: 'bug', scope: null },
        ]);
        expect(
          await rows(journey, 'SELECT * FROM "defect" ORDER BY id'),
          'J3.05: defect holds the rows of Bug',
        ).toEqual([
          { id: 1, severity: 'high' },
          { id: 3, severity: null },
        ]);
        await expectSettled(journey, 'J3.06');
      },
      timeouts.spinUpPpgDev,
    );
  });
});
