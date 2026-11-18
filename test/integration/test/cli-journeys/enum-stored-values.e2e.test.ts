/**
 * Enum members that keep their names while their stored values change (Postgres).
 *
 * The Postgres twin of `enum-stored-values.sqlite.e2e.test.ts`. `Status` types an optional `status` and a list `tags` of `Task`, and an optional `state` of `Note`. Each journey runs once through `migration plan` and `db migrate`, and once through `db update`.
 *
 * - V1: `ARCHIVED` changes from `archived` to `old`. Every column is rewritten with no question.
 * - V2: a chain: `ACTIVE` takes `archived`, the value `ARCHIVED` had, and `ARCHIVED` takes `old`. The rewrites run last value first.
 * - V3: `ACTIVE` and `ARCHIVED` swap values. The plan is refused with no statement named, and the advice is followed: two plans through a value no member stores.
 *
 * V4 and V5, where a member takes the value of a removed member, are in `enum-stored-value-merges.e2e.test.ts`.
 *
 * Each journey reads every row back, and ends with `db verify --schema-only` clean and a further plan empty.
 */

import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import { timeouts, useDevDatabase } from '../utils/journey-test-helpers';
import {
  COMMANDS,
  emit,
  expectSettled,
  planAndApply,
  planningFailure,
  postgresJourney,
  refusal,
  rows,
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

withTempDir(({ createTempDir }) => {
  describe.each(COMMANDS)(
    'Journey V1 (Postgres): a member that keeps its name changes its stored value, with %s',
    (command) => {
      const db = useDevDatabase();

      it(
        'rewrites the value in every column with no question',
        async () => {
          const journey = postgresJourney(db.connectionString, createTempDir, command);
          await start(journey, FROM_PSL, SEED, 'V1.01');
          await emit(journey, contractWith(members('active', 'old')), 'V1.02');

          const planned = await planAndApply(journey, [], 'V1.03');
          expect(planned, 'V1.03: a rewrite per column').toEqual([
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
              label: 'Replace value "archived" with "old" in column "state" of "note"',
              operationClass: 'widening',
            },
            {
              label: 'Replace value "archived" with "old" in column "status" of "task"',
              operationClass: 'widening',
            },
            {
              label: 'Replace value "archived" with "old" in column "tags" of "task"',
              operationClass: 'widening',
            },
            {
              label: 'Add check constraint "note_state_check_f5529f02" on "note"',
              operationClass: 'additive',
            },
            {
              label: 'Add check constraint "task_status_check_a39b85d7" on "task"',
              operationClass: 'additive',
            },
            {
              label: 'Add check constraint "task_tags_check_a8fe834a" on "task"',
              operationClass: 'additive',
            },
          ]);
          expect(await data(journey), 'V1.04: the rows hold the new value').toEqual({
            task: [
              { id: 1, status: 'old', tags: ['old', 'active'] },
              { id: 2, status: 'active', tags: [] },
              { id: 3, status: null, tags: [] },
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
    'Journey V2 (Postgres): a member takes the value another member leaves, with %s',
    (command) => {
      const db = useDevDatabase();

      it(
        'rewrites the values last first, with no question',
        async () => {
          const journey = postgresJourney(db.connectionString, createTempDir, command);
          await start(journey, FROM_PSL, SEED, 'V2.01');
          await emit(journey, contractWith(members('archived', 'old')), 'V2.02');

          const planned = await planAndApply(journey, [], 'V2.03');
          expect(planned, 'V2.03: archived to old, then active to archived').toEqual([
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
              label: 'Replace value "archived" with "old" in column "state" of "note"',
              operationClass: 'widening',
            },
            {
              label: 'Replace value "archived" with "old" in column "status" of "task"',
              operationClass: 'widening',
            },
            {
              label: 'Replace value "archived" with "old" in column "tags" of "task"',
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
              label: 'Add check constraint "note_state_check_20e1120a" on "note"',
              operationClass: 'additive',
            },
            {
              label: 'Add check constraint "task_status_check_8c003e9e" on "task"',
              operationClass: 'additive',
            },
            {
              label: 'Add check constraint "task_tags_check_17486129" on "task"',
              operationClass: 'additive',
            },
          ]);
          expect(await data(journey), 'V2.04: each row keeps its member').toEqual({
            task: [
              { id: 1, status: 'old', tags: ['old', 'archived'] },
              { id: 2, status: 'archived', tags: [] },
              { id: 3, status: null, tags: [] },
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
    'Journey V3 (Postgres): two members swap stored values, with %s',
    (command) => {
      const db = useDevDatabase();

      it(
        'is refused, and two plans through a value no member stores swap the rows',
        async () => {
          const journey = postgresJourney(db.connectionString, createTempDir, command);
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
              label: 'Replace value "active" with "prisma_swap" in column "state" of "note"',
              operationClass: 'widening',
            },
            {
              label: 'Replace value "active" with "prisma_swap" in column "status" of "task"',
              operationClass: 'widening',
            },
            {
              label: 'Replace value "active" with "prisma_swap" in column "tags" of "task"',
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
            {
              label: 'Replace value "archived" with "active" in column "tags" of "task"',
              operationClass: 'widening',
            },
            {
              label: 'Add check constraint "note_state_check_ac1811ae" on "note"',
              operationClass: 'additive',
            },
            {
              label: 'Add check constraint "task_status_check_370b73fc" on "task"',
              operationClass: 'additive',
            },
            {
              label: 'Add check constraint "task_tags_check_3770ca12" on "task"',
              operationClass: 'additive',
            },
          ]);
          await emit(journey, swapped, 'V3.05');
          const second = await planAndApply(journey, [], 'V3.05');
          expect(second, 'V3.05: plan 2 of the advice').toEqual([
            {
              label: 'Drop check constraint "note_state_check_ac1811ae" on "note"',
              operationClass: 'widening',
            },
            {
              label: 'Drop check constraint "task_status_check_370b73fc" on "task"',
              operationClass: 'widening',
            },
            {
              label: 'Drop check constraint "task_tags_check_3770ca12" on "task"',
              operationClass: 'widening',
            },
            {
              label: 'Replace value "prisma_swap" with "archived" in column "state" of "note"',
              operationClass: 'widening',
            },
            {
              label: 'Replace value "prisma_swap" with "archived" in column "status" of "task"',
              operationClass: 'widening',
            },
            {
              label: 'Replace value "prisma_swap" with "archived" in column "tags" of "task"',
              operationClass: 'widening',
            },
            {
              label: 'Add check constraint "note_state_check_195a491f" on "note"',
              operationClass: 'additive',
            },
            {
              label: 'Add check constraint "task_status_check_f769e62d" on "task"',
              operationClass: 'additive',
            },
            {
              label: 'Add check constraint "task_tags_check_8c282d5d" on "task"',
              operationClass: 'additive',
            },
          ]);

          expect(await data(journey), 'V3.06: each row keeps its member').toEqual({
            task: [
              { id: 1, status: 'active', tags: ['active', 'archived'] },
              { id: 2, status: 'archived', tags: [] },
              { id: 3, status: null, tags: [] },
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
});
