/**
 * Fields of a base and a variant that share a column, kept by a hand-written migration (Postgres).
 *
 * The Postgres twin of `stored-name-shared-columns.sqlite.e2e.test.ts`. Each journey runs through `migration plan` only, since a hand-written migration is the route its refusal offers there.
 *
 * - C1: `Task.title` and `Bug.label` share column `title`, and `--rename Bug.label:Bug.heading` moves `Bug` to a column of its own. The statement is refused, since the values of `Task.title` would not move. The hand-written migration its advice describes adds column `heading` and copies the label of each bug into it.
 * - C2: `Task.a` moves from column `x` to `z`, and `--rename Bug.b:Bug.c` moves `Bug` from column `y` to `z` too. The statement is refused, since column `z` would also store the values of `Task.a`. The hand-written migration its advice describes renames `x` to `z`, copies `b` of each bug into it, and drops `y`.
 *
 * Each journey reads every row back and ends with `db verify --schema-only` clean and a further plan empty.
 */

import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import { timeouts, useDevDatabase } from '../utils/journey-test-helpers';
import {
  emit,
  expectSettled,
  migrateByHand,
  postgresJourney,
  refusal,
  rows,
  start,
} from '../utils/stored-name-journeys';

function tasks(taskField: string, bugField: string): string {
  return `// use prisma-8

model Task {
  id   Int    @id
  type String
  ${taskField}
  @@discriminator(type)
  @@map("task")
}

model Bug {
  ${bugField}
  @@base(Task, "bug")
}

model Epic {
  scope String?
  @@base(Task, "epic")
}
`;
}

const SPLIT_REFUSAL = {
  code: 'MIGRATION.PLANNING_FAILED',
  severity: 'error',
  summary: 'Migration planning failed',
  why: 'Cannot rename column "task"."title" to "heading": column "title" also stores field "public.Task.title"',
  nextActions: [
    {
      kind: 'user-choice',
      label:
        'A column rename moves the values of every row, and the values of field "public.Task.title" do not move to column "heading". Moving the values of one field out of a column it shares with others is a data migration, which a plan does not write. Leave out this statement to plan the change without moving them: the plan then asks about the data it drops. A question about field "public.Bug.label" offers this same rename again, which is refused again for the same reason. Answer it with --delete, which it also offers: that plans the change and deletes the data. To keep the data with migration plan, write this change as a hand-written migration instead: run prisma migration new, and in the operations of the migration.ts it writes, rewrite the values of field "public.Bug.label" into column "heading" yourself, with the other operations of the change. Then run that migration.ts to emit its ops.json.',
    },
  ],
  meta: {
    conflicts: [
      {
        kind: 'statementRefused',
        summary:
          'Cannot rename column "task"."title" to "heading": column "title" also stores field "public.Task.title"',
        why: 'A column rename moves the values of every row, and the values of field "public.Task.title" do not move to column "heading". Moving the values of one field out of a column it shares with others is a data migration, which a plan does not write. Leave out this statement to plan the change without moving them: the plan then asks about the data it drops. A question about field "public.Bug.label" offers this same rename again, which is refused again for the same reason. Answer it with --delete, which it also offers: that plans the change and deletes the data. To keep the data with migration plan, write this change as a hand-written migration instead: run prisma migration new, and in the operations of the migration.ts it writes, rewrite the values of field "public.Bug.label" into column "heading" yourself, with the other operations of the change. Then run that migration.ts to emit its ops.json.',
        location: {
          namespaceId: 'public',
          entityKind: 'table',
          entityName: 'task',
          column: 'title',
        },
        refusedStatement: {
          kind: 'rename',
          entity: 'field',
          from: {
            namespaceId: 'public',
            model: 'Bug',
            field: 'label',
          },
          to: {
            namespaceId: 'public',
            model: 'Bug',
            field: 'heading',
          },
        },
      },
    ],
  },
  docsUrl: 'https://docs.prisma.io/docs/orm/v8/reference/error-reference#MIGRATION.PLANNING_FAILED',
};

const MERGE_REFUSAL = {
  code: 'MIGRATION.PLANNING_FAILED',
  severity: 'error',
  summary: 'Migration planning failed',
  why: 'Cannot rename column "task"."y" to "z": column "z" also stores field "public.Task.a", whose values are not in column "y"',
  nextActions: [
    {
      kind: 'user-choice',
      label:
        'A column rename moves the values of one column, and column "z" would also store the values of field "public.Task.a". Moving the values of two columns into one is a data migration, which a plan does not write. Leave out this statement to plan the change without moving them: the plan then asks about the data it drops. A question about field "public.Bug.b" offers this same rename again, which is refused again for the same reason. Answer it with --delete, which it also offers: that plans the change and deletes the data. To keep the data with migration plan, write this change as a hand-written migration instead: run prisma migration new, and in the operations of the migration.ts it writes, rewrite the values of field "public.Bug.b", and those of field "public.Task.a" that column "z" does not already hold, into column "z" yourself, with the other operations of the change. Then run that migration.ts to emit its ops.json.',
    },
  ],
  meta: {
    conflicts: [
      {
        kind: 'statementRefused',
        summary:
          'Cannot rename column "task"."y" to "z": column "z" also stores field "public.Task.a", whose values are not in column "y"',
        why: 'A column rename moves the values of one column, and column "z" would also store the values of field "public.Task.a". Moving the values of two columns into one is a data migration, which a plan does not write. Leave out this statement to plan the change without moving them: the plan then asks about the data it drops. A question about field "public.Bug.b" offers this same rename again, which is refused again for the same reason. Answer it with --delete, which it also offers: that plans the change and deletes the data. To keep the data with migration plan, write this change as a hand-written migration instead: run prisma migration new, and in the operations of the migration.ts it writes, rewrite the values of field "public.Bug.b", and those of field "public.Task.a" that column "z" does not already hold, into column "z" yourself, with the other operations of the change. Then run that migration.ts to emit its ops.json.',
        location: {
          namespaceId: 'public',
          entityKind: 'table',
          entityName: 'task',
          column: 'y',
        },
        refusedStatement: {
          kind: 'rename',
          entity: 'field',
          from: {
            namespaceId: 'public',
            model: 'Bug',
            field: 'b',
          },
          to: {
            namespaceId: 'public',
            model: 'Bug',
            field: 'c',
          },
        },
      },
    ],
  },
  docsUrl: 'https://docs.prisma.io/docs/orm/v8/reference/error-reference#MIGRATION.PLANNING_FAILED',
};

withTempDir(({ createTempDir }) => {
  describe('Journey C1 (Postgres): a variant field leaves the column it shares with a base field', () => {
    const db = useDevDatabase();

    it(
      'is refused, and the hand-written migration its advice describes keeps the values of Bug.label',
      async () => {
        const journey = postgresJourney(db.connectionString, createTempDir, 'migration plan');
        await start(
          journey,
          tasks('title String?', 'label String? @map("title")'),
          `INSERT INTO "task" (id, type, title, scope) VALUES (1, 'bug', 'crash', NULL), (2, 'epic', 'plan', 'big'), (3, 'bug', NULL, NULL)`,
          'C1.01',
        );
        await emit(journey, tasks('title String?', 'heading String?'), 'C1.02');
        expect(
          await refusal(journey, ['--rename', 'Bug.label:Bug.heading'], 'C1.03'),
          'C1.03: the statement is refused',
        ).toEqual(SPLIT_REFUSAL);

        await migrateByHand(
          journey,
          ['col', 'rawSql'],
          `      this.addColumn({
        schema: 'public',
        table: 'task',
        column: col('heading', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      rawSql({
        id: 'data_migration.bug-label-into-heading',
        label: 'Copy the label of each bug into "heading"',
        operationClass: 'data',
        target: { id: 'postgres' },
        precheck: [],
        execute: [{ description: 'copy the label of each bug into "heading"', sql: 'UPDATE "public"."task" SET heading = title WHERE type = \\'bug\\'' }],
        postcheck: [],
      }),`,
          'C1.04',
        );

        expect(
          await rows(journey, 'SELECT id, type, title, heading FROM "task" ORDER BY id'),
          'C1.05: heading holds the label of each bug, and title is unchanged',
        ).toEqual([
          { id: 1, type: 'bug', title: 'crash', heading: 'crash' },
          { id: 2, type: 'epic', title: 'plan', heading: null },
          { id: 3, type: 'bug', title: null, heading: null },
        ]);
        await expectSettled(journey, 'C1.06');
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('Journey C2 (Postgres): a variant field moves into the column a base field moves to', () => {
    const db = useDevDatabase();

    it(
      'is refused, and the hand-written migration its advice describes keeps the values of both fields',
      async () => {
        const journey = postgresJourney(db.connectionString, createTempDir, 'migration plan');
        await start(
          journey,
          tasks('a String? @map("x")', 'b String? @map("y")'),
          `INSERT INTO "task" (id, type, x, y, scope) VALUES (1, 'bug', 'a1', 'b1', NULL), (2, 'epic', 'a2', NULL, 'big'), (3, 'bug', 'a3', NULL, NULL)`,
          'C2.01',
        );
        await emit(journey, tasks('a String? @map("z")', 'c String? @map("z")'), 'C2.02');
        expect(
          await refusal(journey, ['--rename', 'Bug.b:Bug.c'], 'C2.03'),
          'C2.03: the statement is refused',
        ).toEqual(MERGE_REFUSAL);

        await migrateByHand(
          journey,
          ['rawSql'],
          `      ...this.renameColumn({
        schema: 'public',
        table: 'task',
        column: 'x',
        to: 'z',
      }),
      rawSql({
        id: 'data_migration.bug-b-into-z',
        label: 'Copy b of each bug into "z"',
        operationClass: 'data',
        target: { id: 'postgres' },
        precheck: [],
        execute: [{ description: 'copy b of each bug into "z"', sql: 'UPDATE "public"."task" SET z = y WHERE type = \\'bug\\'' }],
        postcheck: [],
      }),
      this.dropColumn({ schema: 'public', table: 'task', column: 'y' }),`,
          'C2.04',
        );

        expect(
          await rows(journey, 'SELECT id, type, z FROM "task" ORDER BY id'),
          'C2.05: z holds b of each bug and a of every other row',
        ).toEqual([
          { id: 1, type: 'bug', z: 'b1' },
          { id: 2, type: 'epic', z: 'a2' },
          { id: 3, type: 'bug', z: null },
        ]);
        await expectSettled(journey, 'C2.06');
      },
      timeouts.spinUpPpgDev,
    );
  });
});
