/**
 * Enum members that keep their names while their stored values change (SQLite).
 *
 * The SQLite twin of `enum-stored-values.e2e.test.ts`, driven through a file database and the SQLite facade config. SQLite has no list columns, so `Status` types an optional `status` of `Task` and an optional `state` of `Note`. Each journey runs once through `migration plan` and `db migrate`, and once through `db update`.
 *
 * - V1: `ARCHIVED` changes from `archived` to `old`. Every column is rewritten with no question.
 * - V2: a chain: `ACTIVE` takes `archived`, the value `ARCHIVED` had, and `ARCHIVED` takes `old`. The rewrites run last value first.
 * - V3: `ACTIVE` and `ARCHIVED` swap values. The plan is refused with no statement named, and the advice is followed: two plans through a value no member stores.
 * - V4: `ARCHIVED` is removed and `ACTIVE` takes its value. The plan is refused, since the rows of both would merge, and the advice is followed: remove `ARCHIVED` in one plan, then change `ACTIVE`.
 * - V5: the same change, where `Status` types the required `status` of `Ticket`. The advice is followed with `--delete Status.ARCHIVED`: the first plan fails its precheck while rows hold `archived`, and applies once those rows are deleted (`migration plan`) or set to `active` (`db update`), as the advice says.
 *
 * Each journey reads every row back, and ends with `db verify --schema-only` clean and a further plan empty.
 */

import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import { engineError, parseJsonOutput, runMigrate, timeouts } from '../utils/journey-test-helpers';
import {
  COMMANDS,
  emit,
  execute,
  expectSettled,
  planAndApply,
  planningFailure,
  refusal,
  rows,
  run,
  type StoredNameJourney,
  sqliteJourney,
  start,
} from '../utils/stored-name-journeys';

function contractWith(members: string): string {
  return `// use prisma-8

enum Status {
  @@type("sqlite/text@1")
${members}}

model Task {
  id     Int      @id
  status Status?
  @@map("task")
}

model Note {
  id    Int     @id
  state Status?
  @@map("note")
}
`;
}

const members = (active: string, archived: string | undefined) =>
  `  ACTIVE = "${active}"\n${archived === undefined ? '' : `  ARCHIVED = "${archived}"\n`}`;

const FROM_PSL = contractWith(members('active', 'archived'));

const SEED = `INSERT INTO "task" (id, status) VALUES (1, 'archived'), (2, 'active'), (3, NULL);
INSERT INTO "note" (id, state) VALUES (1, 'archived'), (2, 'active')`;

function ticketContract(members: string): string {
  return `// use prisma-8

enum Status {
  @@type("sqlite/text@1")
${members}}

model Ticket {
  id     Int    @id
  status Status
  @@map("ticket")
}
`;
}

const PLAN_ONE = [
  {
    label: 'Remove value "archived" from column "status" of "ticket"',
    operationClass: 'destructive',
  },
];

const PLAN_TWO = [
  {
    label: 'Replace value "active" with "archived" in column "status" of "ticket"',
    operationClass: 'widening',
  },
];

const TICKET_SEED = `INSERT INTO "ticket" (id, status) VALUES (1, 'archived'), (2, 'active')`;

async function data(journey: StoredNameJourney) {
  return {
    task: await rows(journey, 'SELECT id, status FROM "task" ORDER BY id'),
    note: await rows(journey, 'SELECT id, state FROM "note" ORDER BY id'),
  };
}

withTempDir(({ createTempDir }) => {
  describe.each(COMMANDS)(
    'Journey V1 (SQLite): a member that keeps its name changes its stored value, with %s',
    (command) => {
      it(
        'rewrites the value in every column with no question',
        async () => {
          const journey = sqliteJourney(createTempDir, command);
          await start(journey, FROM_PSL, SEED, 'V1.01');
          await emit(journey, contractWith(members('active', 'old')), 'V1.02');

          const planned = await planAndApply(journey, [], 'V1.03');
          expect(planned, 'V1.03: a rewrite per column').toEqual([
            {
              label: 'Replace value "archived" with "old" in column "state" of "note"',
              operationClass: 'widening',
            },
            {
              label: 'Replace value "archived" with "old" in column "status" of "task"',
              operationClass: 'widening',
            },
          ]);
          expect(await data(journey), 'V1.04: the rows hold the new value').toEqual({
            task: [
              { id: 1, status: 'old' },
              { id: 2, status: 'active' },
              { id: 3, status: null },
            ],
            note: [
              { id: 1, state: 'old' },
              { id: 2, state: 'active' },
            ],
          });
          await expectSettled(journey, 'V1.05');
        },
        timeouts.spinUpPpgDev,
      );
    },
  );

  describe.each(COMMANDS)(
    'Journey V2 (SQLite): a member takes the value another member leaves, with %s',
    (command) => {
      it(
        'rewrites the values last first, with no question',
        async () => {
          const journey = sqliteJourney(createTempDir, command);
          await start(journey, FROM_PSL, SEED, 'V2.01');
          await emit(journey, contractWith(members('archived', 'old')), 'V2.02');

          const planned = await planAndApply(journey, [], 'V2.03');
          expect(planned, 'V2.03: archived to old, then active to archived').toEqual([
            {
              label: 'Replace value "archived" with "old" in column "state" of "note"',
              operationClass: 'widening',
            },
            {
              label: 'Replace value "archived" with "old" in column "status" of "task"',
              operationClass: 'widening',
            },
            {
              label: 'Replace value "active" with "archived" in column "state" of "note"',
              operationClass: 'widening',
            },
            {
              label: 'Replace value "active" with "archived" in column "status" of "task"',
              operationClass: 'widening',
            },
          ]);
          expect(await data(journey), 'V2.04: each row keeps its member').toEqual({
            task: [
              { id: 1, status: 'old' },
              { id: 2, status: 'archived' },
              { id: 3, status: null },
            ],
            note: [
              { id: 1, state: 'old' },
              { id: 2, state: 'archived' },
            ],
          });
          await expectSettled(journey, 'V2.05');
        },
        timeouts.spinUpPpgDev,
      );
    },
  );

  describe.each(COMMANDS)(
    'Journey V3 (SQLite): two members swap stored values, with %s',
    (command) => {
      it(
        'is refused, and two plans through a value no member stores swap the rows',
        async () => {
          const journey = sqliteJourney(createTempDir, command);
          await start(journey, FROM_PSL, SEED, 'V3.01');
          const swapped = contractWith(members('archived', 'active'));
          await emit(journey, swapped, 'V3.02');

          const refused = await refusal(journey, [], 'V3.03');
          expect(refused, 'V3.03: a cycle').toEqual(
            planningFailure({
              summary:
                'Cannot change the stored values of enum "Status": enum values "Status.ACTIVE" and "Status.ARCHIVED" move stored values in a cycle, "active" to "archived" and "archived" to "active", and a rewrite of one would overwrite the other before it is read',
              why: 'The plan rewrites a changed stored value in every row that holds it, one value after another, and no order of the rewrites moves values in a cycle. Make the change in two plans: first give "Status.ACTIVE" a stored value no member stores, such as "prisma_swap", and give "Status.ARCHIVED" the stored value "active", and plan and apply that; then give "Status.ACTIVE" the stored value "archived", and plan again.',
            }),
          );

          await emit(journey, contractWith(members('prisma_swap', 'active')), 'V3.04');
          const first = await planAndApply(journey, [], 'V3.04');
          expect(first, 'V3.04: plan 1 of the advice').toEqual([
            {
              label: 'Replace value "active" with "prisma_swap" in column "state" of "note"',
              operationClass: 'widening',
            },
            {
              label: 'Replace value "active" with "prisma_swap" in column "status" of "task"',
              operationClass: 'widening',
            },
            {
              label: 'Replace value "archived" with "active" in column "state" of "note"',
              operationClass: 'widening',
            },
            {
              label: 'Replace value "archived" with "active" in column "status" of "task"',
              operationClass: 'widening',
            },
          ]);
          await emit(journey, swapped, 'V3.05');
          const second = await planAndApply(journey, [], 'V3.05');
          expect(second, 'V3.05: plan 2 of the advice').toEqual([
            {
              label: 'Replace value "prisma_swap" with "archived" in column "state" of "note"',
              operationClass: 'widening',
            },
            {
              label: 'Replace value "prisma_swap" with "archived" in column "status" of "task"',
              operationClass: 'widening',
            },
          ]);

          expect(await data(journey), 'V3.06: each row keeps its member').toEqual({
            task: [
              { id: 1, status: 'active' },
              { id: 2, status: 'archived' },
              { id: 3, status: null },
            ],
            note: [
              { id: 1, state: 'active' },
              { id: 2, state: 'archived' },
            ],
          });
          await expectSettled(journey, 'V3.07');
        },
        timeouts.spinUpPpgDev,
      );
    },
  );

  describe.each(COMMANDS)(
    'Journey V4 (SQLite): a member takes the value of a removed member, with %s',
    (command) => {
      it(
        'is refused, and removing the member first, then changing the other, keeps each row apart',
        async () => {
          const journey = sqliteJourney(createTempDir, command);
          await start(journey, FROM_PSL, SEED, 'V4.01');
          const merged = contractWith(members('archived', undefined));
          await emit(journey, merged, 'V4.02');

          const refused = await refusal(journey, [], 'V4.03');
          expect(refused, 'V4.03: a merge').toEqual(
            planningFailure({
              summary:
                'Cannot change the stored value of enum value "Status.ACTIVE" from "active" to "archived": the origin enum stores "archived" as enum value "Status.ARCHIVED"',
              why: 'A changed stored value is rewritten in every row that holds it, so the rows of "Status.ACTIVE" would hold "archived" as the rows of "Status.ARCHIVED" do, and their data would merge. Make the change in two plans: first remove enum value "Status.ARCHIVED", and plan and apply that; then give "Status.ACTIVE" the stored value "archived", and plan again. The first plan asks about the rows that hold "archived". If you answer it with --delete Status.ARCHIVED, a column that takes no NULL cannot keep those rows: before that plan applies, delete them in the database, or set them to "active" there to merge their data with the data of "Status.ACTIVE" on purpose.',
            }),
          );

          await emit(journey, contractWith(members('active', undefined)), 'V4.04');
          const first = await planAndApply(journey, ['--delete', 'Status.ARCHIVED'], 'V4.04');
          expect(first, 'V4.04: plan 1 of the advice').toEqual([
            {
              label: 'Remove value "archived" from column "state" of "note"',
              operationClass: 'destructive',
            },
            {
              label: 'Remove value "archived" from column "status" of "task"',
              operationClass: 'destructive',
            },
          ]);
          await emit(journey, merged, 'V4.05');
          const second = await planAndApply(journey, [], 'V4.05');
          expect(second, 'V4.05: plan 2 of the advice').toEqual([
            {
              label: 'Replace value "active" with "archived" in column "state" of "note"',
              operationClass: 'widening',
            },
            {
              label: 'Replace value "active" with "archived" in column "status" of "task"',
              operationClass: 'widening',
            },
          ]);

          expect(await data(journey), 'V4.06: the removed value is gone, the other moved').toEqual({
            task: [
              { id: 1, status: null },
              { id: 2, status: 'archived' },
              { id: 3, status: null },
            ],
            note: [
              { id: 1, state: null },
              { id: 2, state: 'archived' },
            ],
          });
          await expectSettled(journey, 'V4.07');
        },
        timeouts.spinUpPpgDev,
      );
    },
  );

  describe.each(COMMANDS)(
    'Journey V5 (SQLite): a member takes the value of a removed member that a required column holds, with %s',
    (command) => {
      it(
        'is refused, and the rows the advice names are dealt with before the first plan applies',
        async () => {
          const journey = sqliteJourney(createTempDir, command);
          await start(journey, ticketContract(members('active', 'archived')), TICKET_SEED, 'V5.01');
          const merged = ticketContract(members('archived', undefined));
          await emit(journey, merged, 'V5.02');
          expect(await refusal(journey, [], 'V5.03'), 'V5.03: a merge').toEqual(
            planningFailure({
              summary:
                'Cannot change the stored value of enum value "Status.ACTIVE" from "active" to "archived": the origin enum stores "archived" as enum value "Status.ARCHIVED"',
              why: 'A changed stored value is rewritten in every row that holds it, so the rows of "Status.ACTIVE" would hold "archived" as the rows of "Status.ARCHIVED" do, and their data would merge. Make the change in two plans: first remove enum value "Status.ARCHIVED", and plan and apply that; then give "Status.ACTIVE" the stored value "archived", and plan again. The first plan asks about the rows that hold "archived". If you answer it with --delete Status.ARCHIVED, a column that takes no NULL cannot keep those rows: before that plan applies, delete them in the database, or set them to "active" there to merge their data with the data of "Status.ACTIVE" on purpose.',
            }),
          );

          await emit(journey, ticketContract(members('active', undefined)), 'V5.04');
          const answer = ['--delete', 'Status.ARCHIVED'];
          if (command === 'migration plan') {
            const planned = await run(journey, answer);
            expect(planned.exitCode, `V5.04: plan 1: ${planned.stderr}`).toBe(0);
            expect(
              parseJsonOutput<{ operations: { label: string; operationClass: string }[] }>(
                planned,
              ).operations.map(({ label, operationClass }) => ({ label, operationClass })),
              'V5.04: plan 1 of the advice',
            ).toEqual(PLAN_ONE);
            const held = await runMigrate(journey, ['--json']);
            expect(engineError(held)?.code, 'V5.05: rows still hold the value').toBe(
              'MIGRATION.PRECHECK_FAILED',
            );
            await execute(journey, `DELETE FROM "ticket" WHERE status = 'archived'`);
            const migrate = await runMigrate(journey);
            expect(migrate.exitCode, `V5.06: plan 1 applies: ${migrate.stderr}`).toBe(0);
          } else {
            const held = await run(journey, answer);
            expect(engineError(held)?.code, 'V5.05: rows still hold the value').toBe(
              'MIGRATION.PRECHECK_FAILED',
            );
            await execute(
              journey,
              `UPDATE "ticket" SET status = 'active' WHERE status = 'archived'`,
            );
            expect(await planAndApply(journey, answer, 'V5.06'), 'V5.06: plan 1 applies').toEqual(
              PLAN_ONE,
            );
          }

          await emit(journey, merged, 'V5.07');
          expect(await planAndApply(journey, [], 'V5.07'), 'V5.07: plan 2 of the advice').toEqual(
            PLAN_TWO,
          );
          expect(
            await rows(journey, 'SELECT id, status FROM "ticket" ORDER BY id'),
            'V5.08: the rows that held the removed value are deleted, or merged on purpose',
          ).toEqual(
            command === 'migration plan'
              ? [{ id: 2, status: 'archived' }]
              : [
                  { id: 1, status: 'archived' },
                  { id: 2, status: 'archived' },
                ],
          );
          await expectSettled(journey, 'V5.09');
        },
        timeouts.spinUpPpgDev,
      );
    },
  );
});
