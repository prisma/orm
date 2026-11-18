/**
 * `db update` for a changed `@@map` against a database that does not match the contract it was last updated to (Postgres).
 *
 * The Postgres twin of `stored-name-db-update.sqlite.e2e.test.ts`.
 *
 * Journey D1: the table was renamed by hand, as the advice of earlier releases said, and the same change also gives a field a new `@map`, removes a field and renames one with a statement. `db update` plans no rename of the table: it renames the column, asks about the removed field by its origin model and name, and `--delete User.nick` answers.
 *
 * Journeys D2 and D3: the database has both the old and the new table, and the run is refused with no statement named. D2 follows the first route of the advice, for a table something created before `db update` ran: the rows are moved into the old table and the new one dropped. D3 follows the second, for a table renamed by hand whose old name was used again: the reused table is dropped. (Renamed out of the way instead, it is a table the contract does not have, which `db update` asks to drop.) Each reads every row back.
 */

import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import { timeouts, useDevDatabase } from '../utils/journey-test-helpers';
import {
  emit,
  execute,
  expectSettled,
  planAndApply,
  planningFailure,
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
  email String  @unique @map("email")
  nick  String?
  score Int

  @@map("users")
}
`;

const MOVED_PSL = FROM_PSL.replace('@@map("users")', '@@map("people")');

const CHANGED_PSL = `// use prisma-8

model User {
  id     Int    @id
  email  String @unique @map("email_address")
  points Int

  @@map("people")
}
`;

const SEED = `INSERT INTO "users" (id, email, nick, score) VALUES (1, 'alice@example.com', 'al', 10), (2, 'bob@example.com', NULL, 20)`;

async function begin(createTempDir: () => string, connectionString: string, label: string) {
  const journey = postgresJourney(connectionString, createTempDir, 'db update');
  await start(journey, FROM_PSL, SEED, label);
  return journey;
}

async function people(journey: StoredNameJourney) {
  return rows(journey, 'SELECT * FROM "people" ORDER BY id');
}

withTempDir(({ createTempDir }) => {
  describe('Journey D1 (Postgres): db update after the table was renamed by hand', () => {
    const db = useDevDatabase();

    it(
      'plans no table rename, renames the column, and asks about the removed field by its origin name',
      async () => {
        const journey = await begin(createTempDir, db.connectionString, 'D1.01');
        await execute(journey, 'ALTER TABLE "users" RENAME TO "people"');
        await emit(journey, CHANGED_PSL, 'D1.02');

        const asked = await refusal(journey, ['--rename', 'User.score:User.points'], 'D1.03');
        expect(asked, 'D1.03: the question names User.nick').toEqual({
          code: 'CLI.CONSENT_REQUIRED',
          severity: 'error',
          summary: '"User.nick" needs a statement, and the session is not interactive.',
          why: 'Drop column "nick" from "people" would lose the values of field "User.nick".',
          nextActions: [
            {
              kind: 'user-choice',
              label: "Run the command again with --rename 'User.nick:User.<new name>'",
            },
            {
              kind: 'user-choice',
              label: 'Run the command again with --delete User.nick',
            },
          ],
          meta: {
            subject: 'User.nick',
            verbs: ['rename', 'delete'],
            unanswered: [
              {
                subject: 'User.nick',
                verbs: ['rename', 'delete'],
              },
            ],
          },
          docsUrl:
            'https://docs.prisma.io/docs/orm/v8/reference/error-reference/CLI.CONSENT_REQUIRED',
        });

        const planned = await planAndApply(
          journey,
          ['--rename', 'User.score:User.points', '--delete', 'User.nick'],
          'D1.04',
        );
        expect(planned, 'D1.04: no table rename').toEqual([
          {
            label: 'Rename column "people"."score" to "points"',
            operationClass: 'widening',
          },
          {
            label: 'Rename column "people"."email" to "email_address"',
            operationClass: 'widening',
          },
          {
            label:
              'Rename unique constraint "users_email_key" to "people_email_address_key" on "people"',
            operationClass: 'widening',
          },
          {
            label: 'Rename primary key "users_pkey" to "people_pkey" on "people"',
            operationClass: 'widening',
          },
          {
            label: 'Drop column "nick" from "people"',
            operationClass: 'destructive',
          },
        ]);
        expect(await tableNames(journey), 'D1.05: the table renamed by hand').toEqual(['people']);
        expect(await people(journey), 'D1.05: the rows under the new names').toEqual([
          { id: 1, email_address: 'alice@example.com', points: 10 },
          { id: 2, email_address: 'bob@example.com', points: 20 },
        ]);
        await expectSettled(journey, 'D1.06');
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('Journey D2 (Postgres): db update when something created the new table first', () => {
    const db = useDevDatabase();

    it(
      'is refused, and moving the rows into the old table and dropping the new one lets the rename run',
      async () => {
        const journey = await begin(createTempDir, db.connectionString, 'D2.01');
        await execute(
          journey,
          `CREATE TABLE "people" (id int PRIMARY KEY, email text NOT NULL, nick text, score int NOT NULL);
           INSERT INTO "people" (id, email, nick, score) VALUES (3, 'carol@example.com', 'ca', 30)`,
        );
        await emit(journey, MOVED_PSL, 'D2.02');

        const refused = await refusal(journey, [], 'D2.03');
        expect(refused, 'D2.03: both tables').toEqual(
          planningFailure({
            summary: 'Cannot rename table "users" to "people": the database has both tables',
            why: 'The table of model "public.User" changes from "users" to "people", and the database has both table "users" and table "people". One of two things happened, and each has its own fix. If the rename was half done by hand, or something created table "people" before db update ran, table "users" holds the rows of model "public.User": move into table "users" the rows of table "people" that it does not already hold, drop table "people", and run again. If table "users" was renamed to "people" by hand and the name "users" then used for another table, table "people" holds the rows of model "public.User": drop table "users", and run again; to keep the rows of that other table, first move them into a table the contract has, since db update drops every table the contract does not have.',
            location: {
              namespaceId: 'public',
              entityKind: 'table',
              entityName: 'users',
            },
          }),
        );

        await execute(
          journey,
          'INSERT INTO "users" (id, email, nick, score) SELECT id, email, nick, score FROM "people"; DROP TABLE "people"',
        );
        const planned = await planAndApply(journey, [], 'D2.04');
        expect(planned, 'D2.04: the rename').toEqual([
          {
            label: 'Rename table "users" to "people"',
            operationClass: 'widening',
          },
          {
            label: 'Rename primary key "users_pkey" to "people_pkey" on "people"',
            operationClass: 'widening',
          },
          {
            label: 'Rename unique constraint "users_email_key" to "people_email_key" on "people"',
            operationClass: 'widening',
          },
        ]);
        expect(await tableNames(journey), 'D2.05: only the new table').toEqual(['people']);
        expect(await people(journey), 'D2.05: every row, the moved one too').toEqual([
          { id: 1, email: 'alice@example.com', nick: 'al', score: 10 },
          { id: 2, email: 'bob@example.com', nick: null, score: 20 },
          { id: 3, email: 'carol@example.com', nick: 'ca', score: 30 },
        ]);
        await expectSettled(journey, 'D2.06');
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('Journey D3 (Postgres): db update when the table was renamed by hand and its old name used again', () => {
    const db = useDevDatabase();

    it(
      'is refused, and dropping the reused table leaves the renamed table in place',
      async () => {
        const journey = await begin(createTempDir, db.connectionString, 'D3.01');
        await execute(
          journey,
          `ALTER TABLE "users" RENAME TO "people";
           CREATE TABLE "users" (note text);
           INSERT INTO "users" (note) VALUES ('kept')`,
        );
        await emit(journey, MOVED_PSL, 'D3.02');

        const refused = await refusal(journey, [], 'D3.03');
        expect(refused, 'D3.03: both tables').toEqual(
          planningFailure({
            summary: 'Cannot rename table "users" to "people": the database has both tables',
            why: 'The table of model "public.User" changes from "users" to "people", and the database has both table "users" and table "people". One of two things happened, and each has its own fix. If the rename was half done by hand, or something created table "people" before db update ran, table "users" holds the rows of model "public.User": move into table "users" the rows of table "people" that it does not already hold, drop table "people", and run again. If table "users" was renamed to "people" by hand and the name "users" then used for another table, table "people" holds the rows of model "public.User": drop table "users", and run again; to keep the rows of that other table, first move them into a table the contract has, since db update drops every table the contract does not have.',
            location: {
              namespaceId: 'public',
              entityKind: 'table',
              entityName: 'users',
            },
          }),
        );

        await execute(journey, 'DROP TABLE "users"');
        const planned = await planAndApply(journey, [], 'D3.04');
        expect(planned, 'D3.04: nothing left to rename').toEqual([
          {
            label: 'Rename primary key "users_pkey" to "people_pkey" on "people"',
            operationClass: 'widening',
          },
          {
            label: 'Rename unique constraint "users_email_key" to "people_email_key" on "people"',
            operationClass: 'widening',
          },
        ]);
        expect(await tableNames(journey), 'D3.05: only the renamed table').toEqual(['people']);
        expect(await people(journey), 'D3.05: the rows of the renamed table').toEqual([
          { id: 1, email: 'alice@example.com', nick: 'al', score: 10 },
          { id: 2, email: 'bob@example.com', nick: null, score: 20 },
        ]);
        await expectSettled(journey, 'D3.06');
      },
      timeouts.spinUpPpgDev,
    );
  });
});
