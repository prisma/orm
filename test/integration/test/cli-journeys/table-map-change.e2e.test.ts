/**
 * A model that keeps its name while `@@map` gives it a new table (Postgres).
 *
 * The Postgres twin of `table-map-change.sqlite.e2e.test.ts`. Each journey runs once through `migration plan` and `db migrate`, and once through `db update`.
 *
 * Journey M1 changes only `@@map`: the table is renamed with no question, and the rows are read back under the new name. Journey M2 changes a column from `Int` to `String` in the same change: the column of the renamed table is altered, and its values read back as text. Journey M3 renames a field with a statement in the same change. Journey M4 removes a field in the same change: the question names the origin model and field, and `--delete User.nick` answers it. Journey M5 is a script that still passes `--delete User`, as the drop and create of the table once needed: the run is refused, since nothing asks about `User`.
 */

import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import { timeouts, useDevDatabase } from '../utils/journey-test-helpers';
import {
  COMMANDS,
  columnNames,
  emit,
  expectSettled,
  latestMigrationSource,
  planAndApply,
  postgresJourney,
  refusal,
  rows,
  type StoredNameJourney,
  start,
  tableNames,
} from '../utils/stored-name-journeys';

const FROM_PSL = `// use prisma-8

model User {
  id    Int     @id
  email String  @unique
  nick  String?
  score Int

  @@map("users")
}
`;

const MOVED_PSL = FROM_PSL.replace('@@map("users")', '@@map("people")');

const SEED = `INSERT INTO "users" (id, email, nick, score) VALUES (1, 'alice@example.com', 'al', 10), (2, 'bob@example.com', NULL, 20)`;

const RENAMED_TABLE = [
  { label: 'Rename table "users" to "people"', operationClass: 'widening' },
  {
    label: 'Rename primary key "users_pkey" to "people_pkey" on "people"',
    operationClass: 'widening',
  },
  {
    label: 'Rename unique constraint "users_email_key" to "people_email_key" on "people"',
    operationClass: 'widening',
  },
];

async function people(journey: StoredNameJourney): Promise<readonly Record<string, unknown>[]> {
  return rows(journey, 'SELECT * FROM "people" ORDER BY id');
}

async function begin(journey: StoredNameJourney, label: string): Promise<void> {
  await start(journey, FROM_PSL, SEED, label);
}

withTempDir(({ createTempDir }) => {
  describe.each(COMMANDS)('Journey M1 (Postgres): a changed @@map with %s', (command) => {
    const db = useDevDatabase();

    it(
      'renames the table with no question and keeps the rows',
      async () => {
        const journey = postgresJourney(db.connectionString, createTempDir, command);
        await begin(journey, 'M1.01');
        await emit(journey, MOVED_PSL, 'M1.02');

        const planned = await planAndApply(journey, [], 'M1.03');
        expect(planned, 'M1.03: the table and its constraints are renamed').toEqual(RENAMED_TABLE);
        if (command === 'migration plan') {
          expect(latestMigrationSource(journey), 'M1.03: migration.ts renames the table').toContain(
            "...this.renameTable({ schema: 'public', table: 'users', to: 'people' })",
          );
        }
        expect(await tableNames(journey), 'M1.04: only the new table').toEqual(['people']);
        expect(await people(journey), 'M1.04: the rows under the new name').toEqual([
          { id: 1, email: 'alice@example.com', nick: 'al', score: 10 },
          { id: 2, email: 'bob@example.com', nick: null, score: 20 },
        ]);
        await expectSettled(journey, 'M1.05');
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe.each(COMMANDS)(
    'Journey M2 (Postgres): a changed @@map and a column type change with %s',
    (command) => {
      const db = useDevDatabase();

      it(
        'renames the table, then changes the type of its column',
        async () => {
          const journey = postgresJourney(db.connectionString, createTempDir, command);
          await begin(journey, 'M2.01');
          await emit(journey, MOVED_PSL.replace('score Int', 'score String'), 'M2.02');

          const planned = await planAndApply(journey, [], 'M2.03');
          expect(planned, 'M2.03: the rename, then the type change of the renamed column').toEqual([
            ...RENAMED_TABLE,
            { label: 'Alter type of "people"."score" to text', operationClass: 'widening' },
          ]);
          expect(await people(journey), 'M2.04: the rows, with the converted column').toEqual([
            { id: 1, email: 'alice@example.com', nick: 'al', score: '10' },
            { id: 2, email: 'bob@example.com', nick: null, score: '20' },
          ]);
          await expectSettled(journey, 'M2.05');
        },
        timeouts.spinUpPpgDev,
      );
    },
  );

  describe.each(COMMANDS)(
    'Journey M3 (Postgres): a changed @@map and a field rename statement with %s',
    (command) => {
      const db = useDevDatabase();

      it(
        'renames the table first, then the column the statement names',
        async () => {
          const journey = postgresJourney(db.connectionString, createTempDir, command);
          await begin(journey, 'M3.01');
          await emit(journey, MOVED_PSL.replace('nick  String?', 'handle String?'), 'M3.02');

          const planned = await planAndApply(
            journey,
            ['--rename', 'User.nick:User.handle'],
            'M3.03',
          );
          expect(planned, 'M3.03: the table rename, then the column rename').toEqual([
            ...RENAMED_TABLE,
            { label: 'Rename column "people"."nick" to "handle"', operationClass: 'widening' },
          ]);
          expect(await people(journey), 'M3.04: the rows under the new names').toEqual([
            { id: 1, email: 'alice@example.com', handle: 'al', score: 10 },
            { id: 2, email: 'bob@example.com', handle: null, score: 20 },
          ]);
          await expectSettled(journey, 'M3.05');
        },
        timeouts.spinUpPpgDev,
      );
    },
  );

  describe.each(COMMANDS)(
    'Journey M4 (Postgres): a changed @@map and a removed field with %s',
    (command) => {
      const db = useDevDatabase();

      it(
        'asks about the field by its origin model and name, and --delete User.nick answers',
        async () => {
          const journey = postgresJourney(db.connectionString, createTempDir, command);
          await begin(journey, 'M4.01');
          await emit(journey, MOVED_PSL.replace('  nick  String?\n', ''), 'M4.02');

          const asked = await refusal(journey, [], 'M4.03');
          expect(asked, 'M4.03: the question names User.nick').toEqual({
            code: 'CLI.CONSENT_REQUIRED',
            severity: 'error',
            summary: 'Drop column "nick" from "people" would lose the values of field "User.nick".',
            why: 'You have to choose what happens, and this run cannot ask you.',
            nextActions: [
              {
                kind: 'user-choice',
                label: "Run the command again with --rename 'User.nick:User.<new name>'",
              },
              { kind: 'user-choice', label: 'Run the command again with --delete User.nick' },
            ],
            meta: {
              subject: 'User.nick',
              verbs: ['rename', 'delete'],
              unanswered: [{ subject: 'User.nick', verbs: ['rename', 'delete'] }],
            },
            docsUrl:
              'https://docs.prisma.io/docs/orm/v8/reference/error-reference/CLI.CONSENT_REQUIRED',
          });

          const planned = await planAndApply(journey, ['--delete', 'User.nick'], 'M4.04');
          expect(planned, 'M4.04: the rename, then the drop of the column').toEqual([
            ...RENAMED_TABLE,
            { label: 'Drop column "nick" from "people"', operationClass: 'destructive' },
          ]);
          expect(await columnNames(journey, 'people'), 'M4.05: the column is gone').toEqual([
            'email',
            'id',
            'score',
          ]);
          expect(await people(journey), 'M4.05: the rows under the new name').toEqual([
            { id: 1, email: 'alice@example.com', score: 10 },
            { id: 2, email: 'bob@example.com', score: 20 },
          ]);
          await expectSettled(journey, 'M4.06');
        },
        timeouts.spinUpPpgDev,
      );
    },
  );

  describe.each(COMMANDS)(
    'Journey M5 (Postgres): a script that passes --delete User for a changed @@map with %s',
    (command) => {
      const db = useDevDatabase();

      it(
        'refuses the run, since nothing asks about User, and plans the rename without it',
        async () => {
          const journey = postgresJourney(db.connectionString, createTempDir, command);
          await begin(journey, 'M5.01');
          await emit(journey, MOVED_PSL, 'M5.02');

          const refused = await refusal(journey, ['--delete', 'User'], 'M5.03');
          expect(refused, 'M5.03: an unused consent').toEqual({
            code: 'CLI.CONSENT_UNUSED',
            severity: 'error',
            summary: '--delete User was given but nothing in this run asked about User.',
            nextActions: [
              {
                kind: 'user-choice',
                label: 'Remove the flag, or spell the subject the way the command names it.',
              },
            ],
            meta: { unused: [{ verb: 'delete', values: ['User'] }] },
            docsUrl:
              'https://docs.prisma.io/docs/orm/v8/reference/error-reference/CLI.CONSENT_UNUSED',
          });
          expect(await tableNames(journey), 'M5.03: nothing changed').toEqual(['users']);

          expect(await planAndApply(journey, [], 'M5.04'), 'M5.04: without it').toEqual(
            RENAMED_TABLE,
          );
          expect(await people(journey), 'M5.05: the rows under the new name').toEqual([
            { id: 1, email: 'alice@example.com', nick: 'al', score: 10 },
            { id: 2, email: 'bob@example.com', nick: null, score: 20 },
          ]);
          await expectSettled(journey, 'M5.06');
        },
        timeouts.spinUpPpgDev,
      );
    },
  );
});
