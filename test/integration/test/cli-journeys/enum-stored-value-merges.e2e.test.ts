/**
 * An enum member that keeps its name and takes the stored value of a removed member (Postgres).
 *
 * The Postgres twin of `enum-stored-value-merges.sqlite.e2e.test.ts`. `Status` types an optional `status` and a list `tags` of `Task`, and an optional `state` of `Note`. Each journey runs once through `migration plan` and `db migrate`, and once through `db update`.
 *
 * - V4: `ARCHIVED` is removed and `ACTIVE` takes its value. The plan is refused, since the rows of both would merge, and the advice is followed: remove `ARCHIVED` in one plan, then change `ACTIVE`.
 * - V5: the same change, where `Status` types the required `status` of `Ticket`. The advice is followed with `--delete Status.ARCHIVED`: the first plan fails its precheck while rows hold `archived`, and applies once those rows are deleted (`migration plan`) or set to `active` (`db update`), as the advice says.
 *
 * The journeys V1 to V3, where members keep their names and change stored values with no other member removed, are in `enum-stored-values.e2e.test.ts`.
 *
 * Each journey reads every row back, and ends with `db verify --schema-only` clean and a further plan empty.
 */

import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  engineError,
  parseJsonOutput,
  runMigrate,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';
import {
  COMMANDS,
  emit,
  execute,
  expectSettled,
  planAndApply,
  planningFailure,
  postgresJourney,
  refusal,
  rows,
  run,
  type StoredNameJourney,
  start,
} from '../utils/stored-name-journeys';

function contractWith(members: string): string {
  return `// use prisma-8

enum Status {
  @@type("pg/text@1")
${members}}

model Task {
  id     Int      @id
  status Status?
  tags   Status[]
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

const SEED = `INSERT INTO "task" (id, status, tags) VALUES (1, 'archived', '{archived,active}'), (2, 'active', '{}'), (3, NULL, '{}');
INSERT INTO "note" (id, state) VALUES (1, 'archived'), (2, 'active')`;

async function data(journey: StoredNameJourney) {
  return {
    task: await rows(journey, 'SELECT id, status, tags FROM "task" ORDER BY id'),
    note: await rows(journey, 'SELECT id, state FROM "note" ORDER BY id'),
  };
}

function ticketContract(members: string): string {
  return `// use prisma-8

enum Status {
  @@type("pg/text@1")
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
    label: 'Drop check constraint "ticket_status_check_28420b15" on "ticket"',
    operationClass: 'widening',
  },
  {
    label: 'Remove value "archived" from column "status" of "ticket"',
    operationClass: 'destructive',
  },
  {
    label: 'Add check constraint "ticket_status_check_24c8121c" on "ticket"',
    operationClass: 'additive',
  },
];

const PLAN_TWO = [
  {
    label: 'Drop check constraint "ticket_status_check_24c8121c" on "ticket"',
    operationClass: 'widening',
  },
  {
    label: 'Replace value "active" with "archived" in column "status" of "ticket"',
    operationClass: 'widening',
  },
  {
    label: 'Add check constraint "ticket_status_check_846b23e8" on "ticket"',
    operationClass: 'additive',
  },
];

const TICKET_SEED = `INSERT INTO "ticket" (id, status) VALUES (1, 'archived'), (2, 'active')`;

withTempDir(({ createTempDir }) => {
  describe.each(COMMANDS)(
    'Journey V4 (Postgres): a member takes the value of a removed member, with %s',
    (command) => {
      const db = useDevDatabase();

      it(
        'is refused, and removing the member first, then changing the other, keeps each row apart',
        async () => {
          const journey = postgresJourney(db.connectionString, createTempDir, command);
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
              label: 'Drop check constraint "note_state_check_ec4dc490" on "note"',
              operationClass: 'widening',
            },
            {
              label: 'Drop check constraint "task_status_check_28420b15" on "task"',
              operationClass: 'widening',
            },
            {
              label: 'Drop check constraint "task_tags_check_9073a7e8" on "task"',
              operationClass: 'widening',
            },
            {
              label: 'Remove value "archived" from column "state" of "note"',
              operationClass: 'destructive',
            },
            {
              label: 'Remove value "archived" from column "status" of "task"',
              operationClass: 'destructive',
            },
            {
              label: 'Remove value "archived" from column "tags" of "task"',
              operationClass: 'destructive',
            },
            {
              label: 'Add check constraint "note_state_check_740f57c9" on "note"',
              operationClass: 'additive',
            },
            {
              label: 'Add check constraint "task_status_check_24c8121c" on "task"',
              operationClass: 'additive',
            },
            {
              label: 'Add check constraint "task_tags_check_f6b6c5e7" on "task"',
              operationClass: 'additive',
            },
          ]);
          await emit(journey, merged, 'V4.05');
          const second = await planAndApply(journey, [], 'V4.05');
          expect(second, 'V4.05: plan 2 of the advice').toEqual([
            {
              label: 'Drop check constraint "note_state_check_740f57c9" on "note"',
              operationClass: 'widening',
            },
            {
              label: 'Drop check constraint "task_status_check_24c8121c" on "task"',
              operationClass: 'widening',
            },
            {
              label: 'Drop check constraint "task_tags_check_f6b6c5e7" on "task"',
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
            {
              label: 'Replace value "active" with "archived" in column "tags" of "task"',
              operationClass: 'widening',
            },
            {
              label: 'Add check constraint "note_state_check_68dff72a" on "note"',
              operationClass: 'additive',
            },
            {
              label: 'Add check constraint "task_status_check_846b23e8" on "task"',
              operationClass: 'additive',
            },
            {
              label: 'Add check constraint "task_tags_check_b2f52b8f" on "task"',
              operationClass: 'additive',
            },
          ]);

          expect(await data(journey), 'V4.06: the removed value is gone, the other moved').toEqual({
            task: [
              { id: 1, status: null, tags: ['archived'] },
              { id: 2, status: 'archived', tags: [] },
              { id: 3, status: null, tags: [] },
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
    'Journey V5 (Postgres): a member takes the value of a removed member that a required column holds, with %s',
    (command) => {
      const db = useDevDatabase();

      it(
        'is refused, and the rows the advice names are dealt with before the first plan applies',
        async () => {
          const journey = postgresJourney(db.connectionString, createTempDir, command);
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
