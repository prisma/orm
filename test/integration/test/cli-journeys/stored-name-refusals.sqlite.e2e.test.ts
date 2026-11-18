/**
 * Stored-name changes the plan refuses, and the advice followed to the end (SQLite).
 *
 * The SQLite twin of `stored-name-refusals.e2e.test.ts`, driven through a file database and the SQLite facade config. A model or field that keeps its name while its table or column changes is planned as a rename, unless the rename's new name is taken: by another model's or field's old name (a swap), by a rename statement (a chain, in either direction), or by a model or field the change removes (a takeover). Each journey runs once through `migration plan` and `db migrate`, and once through `db update`.
 *
 * Each refusal is asserted whole: no statement is named in it. Its advice is then followed as printed, in two plans through names nothing uses, and the rows are read back under the right names.
 *
 * The swapped models and fields differ in shape, so that the destination's storage differs from the origin's.
 */

import { describe, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import { timeouts } from '../utils/journey-test-helpers';
import { COMMANDS, sqliteJourney } from '../utils/stored-name-journeys';
import {
  ACCOUNT_ROW,
  expectAdviceKeepsRows,
  fields,
  MODELS_SEED,
  models,
  type RefusalScenario,
  USER_ROW,
} from '../utils/stored-name-refusal-scenarios';

const SCENARIOS: readonly RefusalScenario[] = [
  {
    name: 'two models swap tables',
    from: models('users', 'accounts'),
    seed: MODELS_SEED,
    to: models('accounts', 'users'),
    args: [],
    conflict: {
      summary:
        'Cannot rename table "accounts" to "users": table "users" is renamed in the same plan',
      why: 'The table of model "Account" changes from "accounts" to "users", and the table of model "User" changes from "users" to "accounts". A rename onto a name another rename frees, or takes, needs an order or a temporary name that the plan does not work out, and without the renames the plan would read the rows of table "users" as rows of model "Account". Make the change in two plans: first give model "Account" the table "prisma_swap_users" and model "User" the table "prisma_swap_accounts", tables nothing uses, and plan and apply that; then give model "Account" the table "users" and model "User" the table "accounts", and plan again.',
      location: { entityKind: 'table', entityName: 'accounts' },
    },
    steps: [
      {
        psl: models('prisma_swap_accounts', 'prisma_swap_users'),
        args: [],
        operations: [
          { label: 'Rename table accounts to prisma_swap_users', operationClass: 'widening' },
          { label: 'Rename table users to prisma_swap_accounts', operationClass: 'widening' },
        ],
      },
      {
        psl: models('accounts', 'users'),
        args: [],
        operations: [
          { label: 'Rename table prisma_swap_users to users', operationClass: 'widening' },
          { label: 'Rename table prisma_swap_accounts to accounts', operationClass: 'widening' },
        ],
      },
    ],
    tables: { accounts: [USER_ROW], users: [ACCOUNT_ROW] },
  },
  {
    name: 'two fields swap columns',
    from: fields('  a String @map("x")\n  b Int    @map("y")'),
    seed: `INSERT INTO "users" (id, x, y) VALUES (1, 'ax', 7)`,
    to: fields('  a String @map("y")\n  b Int    @map("x")'),
    args: [],
    conflict: {
      summary: 'Cannot rename column "users"."x" to "y": column "y" is renamed in the same plan',
      why: 'The column of field "User.a" changes from "x" to "y", and the column of field "User.b" changes from "y" to "x". A rename onto a name another rename frees, or takes, needs an order or a temporary name that the plan does not work out, and without the renames the plan would read the values of column "y" as values of field "User.a". Make the change in two plans: first give field "User.a" the column "prisma_swap_y" and field "User.b" the column "prisma_swap_x", columns nothing uses, and plan and apply that; then give field "User.a" the column "y" and field "User.b" the column "x", and plan again.',
      location: { entityKind: 'table', entityName: 'users', column: 'x' },
    },
    steps: [
      {
        psl: fields('  a String @map("prisma_swap_y")\n  b Int    @map("prisma_swap_x")'),
        args: [],
        operations: [
          { label: 'Rename column x on users to prisma_swap_y', operationClass: 'widening' },
          { label: 'Rename column y on users to prisma_swap_x', operationClass: 'widening' },
        ],
      },
      {
        psl: fields('  a String @map("y")\n  b Int    @map("x")'),
        args: [],
        operations: [
          { label: 'Rename column prisma_swap_y on users to y', operationClass: 'widening' },
          { label: 'Rename column prisma_swap_x on users to x', operationClass: 'widening' },
        ],
      },
    ],
    tables: { users: [{ id: 1, y: 'ax', x: 7 }] },
  },
  {
    name: 'a rename statement takes the table a changed @@map frees',
    from: models('users', 'accounts'),
    seed: MODELS_SEED,
    to: models('people', undefined, 'users'),
    args: ['--rename', 'Account:Member'],
    conflict: {
      summary:
        'Cannot rename table "users" to "people": another rename in the same plan takes table name "users"',
      why: 'The table of model "User" changes from "users" to "people", and model "Account" is renamed to "Member", which renames table "accounts" to "users". A rename onto a name another rename frees, or takes, needs an order or a temporary name that the plan does not work out. Make the change in two plans: first give model "User" the table "prisma_swap_people" and model "Member" the table "prisma_swap_users", tables nothing uses, and plan and apply that with the same statements; then give model "User" the table "people" and model "Member" the table "users", and plan again without them.',
      location: { entityKind: 'table', entityName: 'users' },
    },
    steps: [
      {
        psl: models('prisma_swap_people', undefined, 'prisma_swap_users'),
        args: ['--rename', 'Account:Member'],
        operations: [
          { label: 'Rename table users to prisma_swap_people', operationClass: 'widening' },
          { label: 'Rename table accounts to prisma_swap_users', operationClass: 'widening' },
        ],
      },
      {
        psl: models('people', undefined, 'users'),
        args: [],
        operations: [
          { label: 'Rename table prisma_swap_users to users', operationClass: 'widening' },
          { label: 'Rename table prisma_swap_people to people', operationClass: 'widening' },
        ],
      },
    ],
    tables: { people: [USER_ROW], users: [ACCOUNT_ROW] },
  },
  {
    name: 'a changed @@map takes the table a rename statement frees',
    from: models('users', 'accounts'),
    seed: MODELS_SEED,
    to: models('accounts', undefined, 'members'),
    args: ['--rename', 'Account:Member'],
    conflict: {
      summary:
        'Cannot rename table "users" to "accounts": table "accounts" is renamed in the same plan',
      why: 'The table of model "User" changes from "users" to "accounts", and model "Account" is renamed to "Member", which renames table "accounts" to "members". A rename onto a name another rename frees, or takes, needs an order or a temporary name that the plan does not work out, and without the renames the plan would read the rows of table "accounts" as rows of model "User". Make the change in two plans: first give model "User" the table "prisma_swap_accounts" and model "Member" the table "prisma_swap_members", tables nothing uses, and plan and apply that with the same statements; then give model "User" the table "accounts" and model "Member" the table "members", and plan again without them.',
      location: { entityKind: 'table', entityName: 'users' },
    },
    steps: [
      {
        psl: models('prisma_swap_accounts', undefined, 'prisma_swap_members'),
        args: ['--rename', 'Account:Member'],
        operations: [
          { label: 'Rename table users to prisma_swap_accounts', operationClass: 'widening' },
          { label: 'Rename table accounts to prisma_swap_members', operationClass: 'widening' },
        ],
      },
      {
        psl: models('accounts', undefined, 'members'),
        args: [],
        operations: [
          { label: 'Rename table prisma_swap_members to members', operationClass: 'widening' },
          { label: 'Rename table prisma_swap_accounts to accounts', operationClass: 'widening' },
        ],
      },
    ],
    tables: { accounts: [USER_ROW], members: [ACCOUNT_ROW] },
  },
  {
    name: 'a rename statement takes the column a changed @map frees',
    from: fields('  a String @map("x")\n  b String'),
    seed: `INSERT INTO "users" (id, x, b) VALUES (1, 'ax', 'bb')`,
    to: fields('  a String @map("y")\n  c String @map("x")'),
    args: ['--rename', 'User.b:User.c'],
    conflict: {
      summary:
        'Cannot rename column "users"."x" to "y": another rename in the same plan takes column name "x"',
      why: 'The column of field "User.a" changes from "x" to "y", and field "User.b" is renamed to "User.c", which renames column "b" to "x". A rename onto a name another rename frees, or takes, needs an order or a temporary name that the plan does not work out. Make the change in two plans: first give field "User.a" the column "prisma_swap_y" and field "User.c" the column "prisma_swap_x", columns nothing uses, and plan and apply that with the same statements; then give field "User.a" the column "y" and field "User.c" the column "x", and plan again without them.',
      location: { entityKind: 'table', entityName: 'users', column: 'x' },
    },
    steps: [
      {
        psl: fields('  a String @map("prisma_swap_y")\n  c String @map("prisma_swap_x")'),
        args: ['--rename', 'User.b:User.c'],
        operations: [
          { label: 'Rename column b on users to prisma_swap_x', operationClass: 'widening' },
          { label: 'Rename column x on users to prisma_swap_y', operationClass: 'widening' },
        ],
      },
      {
        psl: fields('  a String @map("y")\n  c String @map("x")'),
        args: [],
        operations: [
          { label: 'Rename column prisma_swap_y on users to y', operationClass: 'widening' },
          { label: 'Rename column prisma_swap_x on users to x', operationClass: 'widening' },
        ],
      },
    ],
    tables: { users: [{ id: 1, y: 'ax', x: 'bb' }] },
  },
  {
    name: 'a changed @map takes the column a rename statement frees',
    from: fields('  a String @map("x")\n  b String'),
    seed: `INSERT INTO "users" (id, x, b) VALUES (1, 'ax', 'bb')`,
    to: fields('  a String @map("b")\n  c String'),
    args: ['--rename', 'User.b:User.c'],
    conflict: {
      summary: 'Cannot rename column "users"."x" to "b": column "b" is renamed in the same plan',
      why: 'The column of field "User.a" changes from "x" to "b", and field "User.b" is renamed to "User.c", which renames column "b" to "c". A rename onto a name another rename frees, or takes, needs an order or a temporary name that the plan does not work out, and without the renames the plan would read the values of column "b" as values of field "User.a". Make the change in two plans: first give field "User.a" the column "prisma_swap_b" and field "User.c" the column "prisma_swap_c", columns nothing uses, and plan and apply that with the same statements; then give field "User.a" the column "b" and field "User.c" the column "c", and plan again without them.',
      location: { entityKind: 'table', entityName: 'users', column: 'x' },
    },
    steps: [
      {
        psl: fields('  a String @map("prisma_swap_b")\n  c String @map("prisma_swap_c")'),
        args: ['--rename', 'User.b:User.c'],
        operations: [
          { label: 'Rename column b on users to prisma_swap_c', operationClass: 'widening' },
          { label: 'Rename column x on users to prisma_swap_b', operationClass: 'widening' },
        ],
      },
      {
        psl: fields('  a String @map("b")\n  c String'),
        args: [],
        operations: [
          { label: 'Rename column prisma_swap_b on users to b', operationClass: 'widening' },
          { label: 'Rename column prisma_swap_c on users to c', operationClass: 'widening' },
        ],
      },
    ],
    tables: { users: [{ id: 1, b: 'ax', c: 'bb' }] },
  },
  {
    name: 'a changed @@map takes the table of a removed model',
    from: models('users', 'accounts'),
    seed: MODELS_SEED,
    to: models('accounts', undefined),
    args: [],
    conflict: {
      summary:
        'Cannot rename table "users" to "accounts": the schema being planned from already has a table "accounts"',
      why: 'The table of model "User" changes from "users" to "accounts", and the schema being planned from already has table "accounts", the table of model "Account". Without the rename the plan would read the rows of table "accounts" as rows of model "User". Make the change in two plans: first remove table "accounts" or give it a name nothing uses, such as "prisma_swap_accounts", and plan and apply that; then make this change and plan again.',
      location: { entityKind: 'table', entityName: 'users' },
    },
    steps: [
      {
        psl: models('users', 'prisma_swap_accounts'),
        args: [],
        operations: [
          { label: 'Rename table accounts to prisma_swap_accounts', operationClass: 'widening' },
        ],
      },
      {
        psl: models('accounts', undefined),
        args: ['--delete', 'Account'],
        operations: [
          { label: 'Rename table users to accounts', operationClass: 'widening' },
          { label: 'Drop table "prisma_swap_accounts"', operationClass: 'destructive' },
        ],
      },
    ],
    tables: { accounts: [USER_ROW] },
  },
  {
    name: 'a changed @map takes the column of a removed field',
    from: fields('  a String @map("x")\n  b String @map("y")'),
    seed: `INSERT INTO "users" (id, x, y) VALUES (1, 'ax', 'by')`,
    to: fields('  a String @map("y")'),
    args: [],
    conflict: {
      summary:
        'Cannot rename column "users"."x" to "y": the schema being planned from already has a column "y" on table "users"',
      why: 'The column of field "User.a" changes from "x" to "y", and the schema being planned from already has column "y" on table "users", the column of field "User.b". Without the rename the plan would read the values of column "y" as values of field "User.a". Make the change in two plans: first remove column "y" or give it a name nothing uses, such as "prisma_swap_y", and plan and apply that; then make this change and plan again.',
      location: { entityKind: 'table', entityName: 'users', column: 'x' },
    },
    steps: [
      {
        psl: fields('  a String @map("x")\n  b String @map("prisma_swap_y")'),
        args: [],
        operations: [
          { label: 'Rename column y on users to prisma_swap_y', operationClass: 'widening' },
        ],
      },
      {
        psl: fields('  a String @map("y")'),
        args: ['--delete', 'User.b'],
        operations: [
          { label: 'Rename column x on users to y', operationClass: 'widening' },
          { label: 'Drop column "prisma_swap_y" from "users"', operationClass: 'destructive' },
        ],
      },
    ],
    tables: { users: [{ id: 1, y: 'ax' }] },
  },
];

withTempDir(({ createTempDir }) => {
  describe.each(
    SCENARIOS.flatMap((scenario) => COMMANDS.map((command) => ({ scenario, command }))),
  )('Journey (SQLite): $scenario.name, with $command', ({ scenario, command }) => {
    it(
      'is refused with no statement named, and the advice, followed, keeps every row under the right name',
      async () => {
        const journey = sqliteJourney(createTempDir, command);
        await expectAdviceKeepsRows(journey, scenario);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
