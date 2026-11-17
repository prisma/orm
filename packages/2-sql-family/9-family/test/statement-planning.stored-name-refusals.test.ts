import { describe, expect, it } from 'vitest';
import { planStatements } from '../src/core/migrations/statement-planning';
import {
  ALL_CLASSES,
  contractOf,
  fakeTarget,
  type ModelSpec,
  rejection,
  renameField,
  renameModel,
} from './statement-fixtures';

const ignoringCase = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();

const ORDER =
  'A rename onto a name another rename frees, or takes, needs an order or a temporary name that the plan does not work out';

function refusal(
  origin: Record<string, ModelSpec>,
  destination: Record<string, ModelSpec>,
  target: ReturnType<typeof fakeTarget>,
  statements: Parameters<typeof planStatements>[0]['statements'] = [],
) {
  return rejection(
    planStatements({
      policy: ALL_CLASSES,
      statements,
      fromContract: contractOf(origin),
      contract: contractOf(destination),
      target,
    }),
  );
}

const table = (name: string): ModelSpec => ({ table: name, fields: { id: 'id' } });
const usersAndAccounts = fakeTarget(['app.users', 'app.accounts']);
const usersLocation = { namespaceId: 'app', entityKind: 'table', entityName: 'users' };

describe('planStatements refuses a table rename no statement asks for', () => {
  it('when two tables swap names', () => {
    expect(
      refusal(
        { User: table('users'), Account: table('accounts') },
        { User: table('accounts'), Account: table('users') },
        usersAndAccounts,
      ),
    ).toEqual({
      kind: 'unsupportedOperation',
      summary:
        'Cannot rename table "users" to "accounts": table "accounts" is renamed in the same plan',
      why: `The table of model "app.User" changes from "users" to "accounts", and the table of model "app.Account" changes from "accounts" to "users". ${ORDER}, and without the renames the plan would read the rows of table "accounts" as rows of model "app.User". Make the change in two plans: first give model "app.User" the table "prisma_swap_accounts" and model "app.Account" the table "prisma_swap_users", tables nothing uses, and plan and apply that; then give model "app.User" the table "accounts" and model "app.Account" the table "users", and plan again.`,
      location: usersLocation,
    });
  });

  it('when one table takes the name another table leaves', () => {
    expect(
      refusal(
        { User: table('users'), Account: table('accounts') },
        { User: table('accounts'), Account: table('members') },
        usersAndAccounts,
      ),
    ).toEqual({
      kind: 'unsupportedOperation',
      summary:
        'Cannot rename table "users" to "accounts": table "accounts" is renamed in the same plan',
      why: `The table of model "app.User" changes from "users" to "accounts", and the table of model "app.Account" changes from "accounts" to "members". ${ORDER}, and without the renames the plan would read the rows of table "accounts" as rows of model "app.User". Make the change in two plans: first give model "app.User" the table "prisma_swap_accounts" and model "app.Account" the table "prisma_swap_members", tables nothing uses, and plan and apply that; then give model "app.User" the table "accounts" and model "app.Account" the table "members", and plan again.`,
      location: usersLocation,
    });
  });

  it('when it takes the table of a removed model', () => {
    expect(
      refusal(
        { User: table('users'), Account: table('accounts') },
        { User: table('accounts') },
        usersAndAccounts,
      ),
    ).toEqual({
      kind: 'unsupportedOperation',
      summary:
        'Cannot rename table "users" to "accounts": the schema being planned from already has a table "accounts"',
      why: 'The table of model "app.User" changes from "users" to "accounts", and the schema being planned from already has table "accounts", the table of model "app.Account". Without the rename the plan would read the rows of table "accounts" as rows of model "app.User". Make the change in two plans: first remove table "accounts" or give it a name nothing uses, such as "prisma_swap_accounts", and plan and apply that; then make this change and plan again.',
      location: usersLocation,
    });
  });

  it('when it takes a name the schema has in another case where the target ignores case', () => {
    expect(
      refusal(
        { User: table('users'), Account: table('Accounts') },
        { User: table('accounts') },
        fakeTarget(['app.users', 'app.Accounts'], {}, ['widening'], ignoringCase),
      ),
    ).toEqual({
      kind: 'unsupportedOperation',
      summary:
        'Cannot rename table "users" to "accounts": the schema being planned from already has a table "accounts", as "Accounts"',
      why: 'The table of model "app.User" changes from "users" to "accounts", and the schema being planned from already has table "Accounts", the table of model "app.Account". Without the rename the plan would read the rows of table "Accounts" as rows of model "app.User". Make the change in two plans: first remove table "Accounts" or give it a name nothing uses, such as "prisma_swap_Accounts", and plan and apply that; then make this change and plan again.',
      location: usersLocation,
    });
  });

  it('when it takes the name a model rename statement frees', () => {
    expect(
      refusal(
        { User: table('users'), Account: table('accounts') },
        { User: table('accounts'), Person: table('people') },
        usersAndAccounts,
        [renameModel('Account', 'Person')],
      ),
    ).toEqual({
      kind: 'unsupportedOperation',
      summary:
        'Cannot rename table "users" to "accounts": table "accounts" is renamed in the same plan',
      why: `The table of model "app.User" changes from "users" to "accounts", and model "app.Account" is renamed to "app.Person", which renames table "accounts" to "people". ${ORDER}, and without the renames the plan would read the rows of table "accounts" as rows of model "app.User". Make the change in two plans: first give model "app.User" the table "prisma_swap_accounts" and model "app.Person" the table "prisma_swap_people", tables nothing uses, and plan and apply that with the same statements; then give model "app.User" the table "accounts" and model "app.Person" the table "people", and plan again without them.`,
      location: usersLocation,
    });
  });

  it('when a model rename statement takes the name it frees', () => {
    expect(
      refusal(
        { User: table('users'), Account: table('accounts') },
        { User: table('app_users'), Person: table('users') },
        usersAndAccounts,
        [renameModel('Account', 'Person')],
      ),
    ).toEqual({
      kind: 'unsupportedOperation',
      summary:
        'Cannot rename table "users" to "app_users": another rename in the same plan takes table name "users"',
      why: `The table of model "app.User" changes from "users" to "app_users", and model "app.Account" is renamed to "app.Person", which renames table "accounts" to "users". ${ORDER}. Make the change in two plans: first give model "app.User" the table "prisma_swap_app_users" and model "app.Person" the table "prisma_swap_users", tables nothing uses, and plan and apply that with the same statements; then give model "app.User" the table "app_users" and model "app.Person" the table "users", and plan again without them.`,
      location: usersLocation,
    });
  });
});

const columns = (fields: Record<string, string>): ModelSpec => ({ table: 'users', fields });
const usersWith = (names: readonly string[], sameName?: typeof ignoringCase) =>
  fakeTarget(['app.users'], { 'app.users': names }, ['widening'], sameName);
const columnLocation = (column: string) => ({ ...usersLocation, column });

describe('planStatements refuses a column rename no statement asks for', () => {
  it('when two columns swap names', () => {
    expect(
      refusal(
        { User: columns({ a: 'x', b: 'y' }) },
        { User: columns({ a: 'y', b: 'x' }) },
        usersWith(['x', 'y']),
      ),
    ).toEqual({
      kind: 'unsupportedOperation',
      summary: 'Cannot rename column "users"."x" to "y": column "y" is renamed in the same plan',
      why: `The column of field "app.User.a" changes from "x" to "y", and the column of field "app.User.b" changes from "y" to "x". ${ORDER}, and without the renames the plan would read the values of column "y" as values of field "app.User.a". Make the change in two plans: first give field "app.User.a" the column "prisma_swap_y" and field "app.User.b" the column "prisma_swap_x", columns nothing uses, and plan and apply that; then give field "app.User.a" the column "y" and field "app.User.b" the column "x", and plan again.`,
      location: columnLocation('x'),
    });
  });

  it('when one column takes the name another column leaves', () => {
    expect(
      refusal(
        { User: columns({ a: 'x', b: 'y' }) },
        { User: columns({ a: 'y', b: 'z' }) },
        usersWith(['x', 'y']),
      ),
    ).toEqual({
      kind: 'unsupportedOperation',
      summary: 'Cannot rename column "users"."x" to "y": column "y" is renamed in the same plan',
      why: `The column of field "app.User.a" changes from "x" to "y", and the column of field "app.User.b" changes from "y" to "z". ${ORDER}, and without the renames the plan would read the values of column "y" as values of field "app.User.a". Make the change in two plans: first give field "app.User.a" the column "prisma_swap_y" and field "app.User.b" the column "prisma_swap_z", columns nothing uses, and plan and apply that; then give field "app.User.a" the column "y" and field "app.User.b" the column "z", and plan again.`,
      location: columnLocation('x'),
    });
  });

  it('when it takes the column of a removed field', () => {
    expect(
      refusal(
        { User: columns({ a: 'x', old: 'y' }) },
        { User: columns({ a: 'y' }) },
        usersWith(['x', 'y']),
      ),
    ).toEqual({
      kind: 'unsupportedOperation',
      summary:
        'Cannot rename column "users"."x" to "y": the schema being planned from already has a column "y" on table "users"',
      why: 'The column of field "app.User.a" changes from "x" to "y", and the schema being planned from already has column "y" on table "users", the column of field "app.User.old". Without the rename the plan would read the values of column "y" as values of field "app.User.a". Make the change in two plans: first remove column "y" or give it a name nothing uses, such as "prisma_swap_y", and plan and apply that; then make this change and plan again.',
      location: columnLocation('x'),
    });
  });

  it('when it takes a name the table has in another case where the target ignores case', () => {
    expect(
      refusal(
        { User: columns({ a: 'x', old: 'Y' }) },
        { User: columns({ a: 'y' }) },
        usersWith(['x', 'Y'], ignoringCase),
      ),
    ).toEqual({
      kind: 'unsupportedOperation',
      summary:
        'Cannot rename column "users"."x" to "y": the schema being planned from already has a column "y" on table "users", as "Y"',
      why: 'The column of field "app.User.a" changes from "x" to "y", and the schema being planned from already has column "Y" on table "users", the column of field "app.User.old". Without the rename the plan would read the values of column "Y" as values of field "app.User.a". Make the change in two plans: first remove column "Y" or give it a name nothing uses, such as "prisma_swap_Y", and plan and apply that; then make this change and plan again.',
      location: columnLocation('x'),
    });
  });

  it('when it takes the name a field rename statement frees', () => {
    expect(
      refusal(
        { User: columns({ a: 'x', b: 'y' }) },
        { User: columns({ a: 'y', c: 'z' }) },
        usersWith(['x', 'y']),
        [renameField('User', 'b', 'c')],
      ),
    ).toEqual({
      kind: 'unsupportedOperation',
      summary: 'Cannot rename column "users"."x" to "y": column "y" is renamed in the same plan',
      why: `The column of field "app.User.a" changes from "x" to "y", and field "app.User.b" is renamed to "app.User.c", which renames column "y" to "z". ${ORDER}, and without the renames the plan would read the values of column "y" as values of field "app.User.a". Make the change in two plans: first give field "app.User.a" the column "prisma_swap_y" and field "app.User.c" the column "prisma_swap_z", columns nothing uses, and plan and apply that with the same statements; then give field "app.User.a" the column "y" and field "app.User.c" the column "z", and plan again without them.`,
      location: columnLocation('x'),
    });
  });

  it('when a field rename statement takes the name it frees', () => {
    expect(
      refusal(
        { User: columns({ a: 'x', b: 'w' }) },
        { User: columns({ a: 'y', c: 'x' }) },
        usersWith(['x', 'w']),
        [renameField('User', 'b', 'c')],
      ),
    ).toEqual({
      kind: 'unsupportedOperation',
      summary:
        'Cannot rename column "users"."x" to "y": another rename in the same plan takes column name "x"',
      why: `The column of field "app.User.a" changes from "x" to "y", and field "app.User.b" is renamed to "app.User.c", which renames column "w" to "x". ${ORDER}. Make the change in two plans: first give field "app.User.a" the column "prisma_swap_y" and field "app.User.c" the column "prisma_swap_x", columns nothing uses, and plan and apply that with the same statements; then give field "app.User.a" the column "y" and field "app.User.c" the column "x", and plan again without them.`,
      location: columnLocation('x'),
    });
  });
});
