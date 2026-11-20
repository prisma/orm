/**
 * Stored-name chains and merges (Postgres).
 *
 * The Postgres twin of `stored-name-chains-and-merges.sqlite.e2e.test.ts`. Each journey runs once through `migration plan` and `db migrate`, and once through `db update`, and reads every row back.
 *
 * - Chains: two models or two fields whose tables or columns move along a chain in one contract change (`User` from `users` to `accounts` while `Account` moves from `accounts` to `members`). The plan is refused with no statement named, and its advice is followed through two plans and names nothing uses.
 * - G1: a statement merges two tables: `--rename Bug:Defect`, where `Bug` has a table of its own and `Defect` is stored in its base's table `task`. The statement is refused. Its advice is followed: without the statement the plan asks about `Bug`, offering the same rename first, and `--delete Bug` deletes its rows and leaves every other row in place.
 * - G2: two contract changes move to one new table name: the base `Task` moves from `task` to `work`, and its variant `Bug` leaves its own table `bug` for its base's. No rename is planned: the plan asks about the data of `Bug` and `Task` it drops, and no row moves into `work`.
 * - G3: the same refusal as G1, through `migration plan` only, followed by the hand-written migration its advice describes: `migration new`, column `severity` added to `task`, the severity of each bug copied into it, and table `bug` dropped. Every row is kept.
 */

import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import { timeouts, useDevDatabase } from '../utils/journey-test-helpers';
import {
  COMMANDS,
  emit,
  expectSettled,
  migrateByHand,
  planAndApply,
  postgresJourney,
  refusal,
  rows,
  start,
  tableNames,
} from '../utils/stored-name-journeys';
import {
  ACCOUNT_ROW,
  expectAdviceKeepsRows,
  fields,
  MODELS_SEED,
  models,
  type RefusalScenario,
  USER_ROW,
} from '../utils/stored-name-refusal-scenarios';

const CHAINS: readonly RefusalScenario[] = [
  {
    name: 'two tables chain',
    from: models('users', 'accounts'),
    seed: MODELS_SEED,
    to: models('accounts', 'members'),
    args: [],
    conflict: {
      summary:
        'Cannot rename table "users" to "accounts": table "accounts" is renamed in the same plan',
      why: 'The table of model "public.User" changes from "users" to "accounts", and the table of model "public.Account" changes from "accounts" to "members". A rename onto a name another rename frees, or takes, needs an order or a temporary name that the plan does not work out, and without the renames the plan would read the rows of table "accounts" as rows of model "public.User". Make the change in two plans: first give model "public.User" the table "prisma_swap_accounts" and model "public.Account" the table "prisma_swap_members", tables nothing uses, and plan and apply that; then give model "public.User" the table "accounts" and model "public.Account" the table "members", and plan again.',
      location: { namespaceId: 'public', entityKind: 'table', entityName: 'users' },
    },
    steps: [
      {
        psl: models('prisma_swap_accounts', 'prisma_swap_members'),
        args: [],
        operations: [
          { label: 'Rename table "accounts" to "prisma_swap_members"', operationClass: 'widening' },
          {
            label:
              'Rename primary key "accounts_pkey" to "prisma_swap_members_pkey" on "prisma_swap_members"',
            operationClass: 'widening',
          },
          { label: 'Rename table "users" to "prisma_swap_accounts"', operationClass: 'widening' },
          {
            label:
              'Rename primary key "users_pkey" to "prisma_swap_accounts_pkey" on "prisma_swap_accounts"',
            operationClass: 'widening',
          },
        ],
      },
      {
        psl: models('accounts', 'members'),
        args: [],
        operations: [
          { label: 'Rename table "prisma_swap_members" to "members"', operationClass: 'widening' },
          {
            label: 'Rename primary key "prisma_swap_members_pkey" to "members_pkey" on "members"',
            operationClass: 'widening',
          },
          {
            label: 'Rename table "prisma_swap_accounts" to "accounts"',
            operationClass: 'widening',
          },
          {
            label:
              'Rename primary key "prisma_swap_accounts_pkey" to "accounts_pkey" on "accounts"',
            operationClass: 'widening',
          },
        ],
      },
    ],
    tables: { accounts: [USER_ROW], members: [ACCOUNT_ROW] },
  },
  {
    name: 'two columns chain',
    from: fields('  a String @map("x")\n  b Int    @map("y")'),
    seed: `INSERT INTO "users" (id, x, y) VALUES (1, 'ax', 7)`,
    to: fields('  a String @map("y")\n  b Int    @map("z")'),
    args: [],
    conflict: {
      summary: 'Cannot rename column "users"."x" to "y": column "y" is renamed in the same plan',
      why: 'The column of field "public.User.a" changes from "x" to "y", and the column of field "public.User.b" changes from "y" to "z". A rename onto a name another rename frees, or takes, needs an order or a temporary name that the plan does not work out, and without the renames the plan would read the values of column "y" as values of field "public.User.a". Make the change in two plans: first give field "public.User.a" the column "prisma_swap_y" and field "public.User.b" the column "prisma_swap_z", columns nothing uses, and plan and apply that; then give field "public.User.a" the column "y" and field "public.User.b" the column "z", and plan again.',
      location: { namespaceId: 'public', entityKind: 'table', entityName: 'users', column: 'x' },
    },
    steps: [
      {
        psl: fields('  a String @map("prisma_swap_y")\n  b Int    @map("prisma_swap_z")'),
        args: [],
        operations: [
          { label: 'Rename column "users"."x" to "prisma_swap_y"', operationClass: 'widening' },
          { label: 'Rename column "users"."y" to "prisma_swap_z"', operationClass: 'widening' },
        ],
      },
      {
        psl: fields('  a String @map("y")\n  b Int    @map("z")'),
        args: [],
        operations: [
          { label: 'Rename column "users"."prisma_swap_y" to "y"', operationClass: 'widening' },
          { label: 'Rename column "users"."prisma_swap_z" to "z"', operationClass: 'widening' },
        ],
      },
    ],
    tables: { users: [{ id: 1, y: 'ax', z: 7 }] },
  },
];

function tasks(table: string, bug: { readonly name: string; readonly table?: string }): string {
  return `// use prisma-8

model Task {
  id   Int    @id
  type String
  @@discriminator(type)
  @@map("${table}")
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

const OWN_TABLE = tasks('task', { name: 'Bug', table: 'bug' });

const SEED = `INSERT INTO "task" (id, type, scope) VALUES (1, 'bug', NULL), (2, 'epic', 'big'), (3, 'bug', NULL); INSERT INTO "bug" (id, severity) VALUES (1, 'high'), (3, NULL)`;

const BUG_MERGE_SUMMARY =
  'Cannot rename table "bug" to "task": table "task" also stores models "public.Epic" and "public.Task", whose rows are not in table "bug"';

const BUG_MERGE_WHY =
  'A table rename moves the rows of one table, and table "task" would also store the rows of models "public.Epic" and "public.Task". Moving the rows of two tables into one is a data migration, which a plan does not write. Leave out this --rename to plan the change without moving them: the command then stops and says what the change would delete. If it offers this same --rename for model "public.Bug", that is refused again for the same reason; give --delete for model "public.Bug" in its place, which plans the change and deletes the data. To keep the data with migration plan, write this change as a hand-written migration instead: run prisma migration new, and in the operations of the migration.ts it writes, rewrite the rows of model "public.Bug", and those of models "public.Epic" and "public.Task" that table "task" does not already hold, into table "task" yourself, with the other operations of the change. Then run that migration.ts to emit its ops.json.';

const MERGE_ADVICE =
  'For model "Bug" and model "Task": the destination stores models "public.Bug", "public.Epic" and "public.Task" in table "work", and the origin stores them in different tables, so their storage is being merged. Keeping their rows is a data migration, which a plan does not write. With migration plan, write this change as a hand-written migration instead: run prisma migration new, and in the operations of the migration.ts it writes, rewrite the rows of models "public.Bug", "public.Epic" and "public.Task" into table "work" yourself, with the other operations of the change. Then run that migration.ts to emit its ops.json.';

withTempDir(({ createTempDir }) => {
  describe.each(CHAINS.flatMap((scenario) => COMMANDS.map((command) => ({ scenario, command }))))(
    'Journey (Postgres): $scenario.name, with $command',
    ({ scenario, command }) => {
      const db = useDevDatabase();

      it(
        'is refused with no statement named, and the advice, followed, keeps every row under the right name',
        async () => {
          const journey = postgresJourney(db.connectionString, createTempDir, command);
          await expectAdviceKeepsRows(journey, scenario);
        },
        timeouts.spinUpPpgDev,
      );
    },
  );

  describe.each(COMMANDS)(
    'Journey G1 (Postgres): --rename of a variant into its base table, with %s',
    (command) => {
      const db = useDevDatabase();

      it(
        'is refused, and without the statement --delete Bug leaves every other row in place',
        async () => {
          const journey = postgresJourney(db.connectionString, createTempDir, command);
          await start(journey, OWN_TABLE, SEED, 'G1.01');
          await emit(journey, tasks('task', { name: 'Defect' }), 'G1.02');

          expect(
            await refusal(journey, ['--rename', 'Bug:Defect'], 'G1.03'),
            'G1.03: the statement is refused',
          ).toEqual({
            code: 'MIGRATION.PLANNING_FAILED',
            severity: 'error',
            summary: 'Migration planning failed',
            why: BUG_MERGE_SUMMARY,
            nextActions: [{ kind: 'user-choice', label: BUG_MERGE_WHY }],
            meta: {
              conflicts: [
                {
                  kind: 'statementRefused',
                  summary: BUG_MERGE_SUMMARY,
                  why: BUG_MERGE_WHY,
                  location: { namespaceId: 'public', entityKind: 'table', entityName: 'bug' },
                  refusedStatement: {
                    kind: 'rename',
                    entity: 'model',
                    from: { namespaceId: 'public', model: 'Bug' },
                    to: { namespaceId: 'public', model: 'Defect' },
                  },
                },
              ],
            },
            docsUrl:
              'https://docs.prisma.io/docs/orm/v8/reference/error-reference#MIGRATION.PLANNING_FAILED',
          });

          expect(
            await refusal(journey, [], 'G1.04'),
            'G1.04: the plan asks about Bug, and offers the rename the planner refused',
          ).toEqual({
            code: 'CLI.CONSENT_REQUIRED',
            severity: 'error',
            summary: 'Removing model "Bug" would delete its data.',
            why: 'The operations of the plan that do this:\n- Drop table "bug"\n- Delete the rows of "task" that hold value "bug" in column "type"',
            nextActions: [
              {
                kind: 'user-choice',
                label: 'If the model was renamed to "Defect", keep its data: --rename Bug:Defect',
              },
              { kind: 'user-choice', label: 'If its data can go: --delete Bug' },
            ],
            meta: {
              subject: 'Bug',
              verbs: ['rename', 'delete'],
              unanswered: [{ subject: 'Bug', verbs: ['rename', 'delete'] }],
            },
            docsUrl:
              'https://docs.prisma.io/docs/orm/v8/reference/error-reference/CLI.CONSENT_REQUIRED',
          });

          expect(await planAndApply(journey, ['--delete', 'Bug'], 'G1.05'), 'G1.05').toEqual([
            { label: 'Drop table "bug"', operationClass: 'destructive' },
            { label: 'Add column "severity" to "task"', operationClass: 'additive' },
            {
              label: 'Delete the rows of "task" that hold value "bug" in column "type"',
              operationClass: 'destructive',
            },
          ]);
          expect(await tableNames(journey), 'G1.06: the variant table is gone').toEqual(['task']);
          expect(
            await rows(journey, 'SELECT * FROM "task" ORDER BY id'),
            'G1.06: the rows of Bug are deleted, and no other row moves',
          ).toEqual([{ id: 2, type: 'epic', scope: 'big', severity: null }]);
          await expectSettled(journey, 'G1.07');
        },
        timeouts.spinUpPpgDev,
      );
    },
  );

  describe.each(COMMANDS)(
    'Journey G2 (Postgres): a base table and a variant table move to one new name, with %s',
    (command) => {
      const db = useDevDatabase();

      it(
        'plans no rename, asks about the data it drops, and moves no row',
        async () => {
          const journey = postgresJourney(db.connectionString, createTempDir, command);
          await start(journey, OWN_TABLE, SEED, 'G2.01');
          await emit(journey, tasks('work', { name: 'Bug' }), 'G2.02');

          expect(await refusal(journey, [], 'G2.03'), 'G2.03: the questions').toEqual({
            code: 'CLI.CONSENT_REQUIRED',
            severity: 'error',
            summary: 'This change would lose data: model "Bug", model "Task".',
            why: 'This change would delete the data of model "Bug".\nThe operation of the plan that does this: Drop table "bug".\n\nThis change would delete the data of model "Task".\nThe operation of the plan that does this: Drop table "task".',
            nextActions: [
              { kind: 'user-choice', label: MERGE_ADVICE },
              { kind: 'user-choice', label: 'If the data of model "Bug" can go: --delete Bug' },
              { kind: 'user-choice', label: 'If the data of model "Task" can go: --delete Task' },
            ],
            meta: {
              unanswered: [
                { subject: 'Bug', verbs: ['delete'] },
                { subject: 'Task', verbs: ['delete'] },
              ],
            },
            docsUrl:
              'https://docs.prisma.io/docs/orm/v8/reference/error-reference/CLI.CONSENT_REQUIRED',
          });

          expect(
            await planAndApply(journey, ['--delete', 'Bug', '--delete', 'Task'], 'G2.04'),
            'G2.04: no rename',
          ).toEqual([
            { label: 'Drop table "bug"', operationClass: 'destructive' },
            { label: 'Drop table "task"', operationClass: 'destructive' },
            { label: 'Create table "work"', operationClass: 'additive' },
          ]);
          expect(await tableNames(journey), 'G2.05: only the new table').toEqual(['work']);
          expect(
            await rows(journey, 'SELECT * FROM "work" ORDER BY id'),
            'G2.05: no row moves into the new table',
          ).toEqual([]);
          await expectSettled(journey, 'G2.06');
        },
        timeouts.spinUpPpgDev,
      );
    },
  );

  describe('Journey G3 (Postgres): --rename of a variant into its base table, kept by a hand-written migration', () => {
    const db = useDevDatabase();

    it(
      'is refused, and the hand-written migration its advice describes keeps the rows of Bug',
      async () => {
        const journey = postgresJourney(db.connectionString, createTempDir, 'migration plan');
        await start(journey, OWN_TABLE, SEED, 'G3.01');
        await emit(journey, tasks('task', { name: 'Defect' }), 'G3.02');
        const refused = await refusal(journey, ['--rename', 'Bug:Defect'], 'G3.03');
        expect(refused.nextActions, 'G3.03: the statement is refused').toEqual([
          { kind: 'user-choice', label: BUG_MERGE_WHY },
        ]);

        await migrateByHand(
          journey,
          ['col', 'rawSql'],
          `      this.addColumn({
        schema: 'public',
        table: 'task',
        column: col('severity', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      rawSql({
        id: 'data_migration.bug-rows-into-task',
        label: 'Copy the rows of Bug into "task"',
        operationClass: 'data',
        target: { id: 'postgres' },
        precheck: [],
        execute: [
          {
            description: 'copy the severity of each bug into "task"',
            sql: 'UPDATE "public"."task" SET severity = bug.severity FROM "public"."bug" WHERE bug.id = task.id',
          },
        ],
        postcheck: [],
      }),
      this.dropTable({ schema: 'public', table: 'bug' }),`,
          'G3.04',
        );

        expect(await tableNames(journey), 'G3.05: the variant table is gone').toEqual(['task']);
        expect(
          await rows(journey, 'SELECT * FROM "task" ORDER BY id'),
          'G3.05: task holds the rows of Bug, and no other row changes',
        ).toEqual([
          { id: 1, type: 'bug', scope: null, severity: 'high' },
          { id: 2, type: 'epic', scope: 'big', severity: null },
          { id: 3, type: 'bug', scope: null, severity: null },
        ]);
        await expectSettled(journey, 'G3.06');
      },
      timeouts.spinUpPpgDev,
    );
  });
});
