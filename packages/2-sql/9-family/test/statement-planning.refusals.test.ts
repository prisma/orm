import { describe, expect, it } from 'vitest';
import { planStatements } from '../src/core/migrations/statement-planning';
import {
  ALL_CLASSES,
  contractOf,
  fakeTarget,
  rejection,
  renameField,
  renameModel,
} from './statement-fixtures';

const profile = contractOf({ Profile: { table: 'Profile' } });
const user = contractOf({ User: { table: 'User' } });
const userWithName = contractOf({ User: { table: 'User', fields: { id: 'id', name: 'name' } } });
const userWithFullName = contractOf({
  User: { table: 'User', fields: { id: 'id', fullName: 'fullName' } },
});

describe('statement refusals say what to do next', () => {
  it.each([
    {
      case: 'a table whose control policy is not managed',
      input: {
        statements: [renameModel('Profile', 'User')],
        fromContract: profile,
        contract: contractOf({ User: { table: 'User', control: 'external' } }),
        target: fakeTarget(['app.Profile']),
      },
      why: 'Statements rename only tables, and columns of tables, whose control policy is "managed"; table "User" is "external". Make the change in the database yourself and leave out this statement.',
    },
    {
      case: 'a rename whose operations the policy does not allow',
      input: {
        policy: { allowedOperationClasses: ['additive'] as const },
        statements: [renameModel('Profile', 'User')],
        fromContract: profile,
        contract: user,
        target: fakeTarget(['app.Profile']),
      },
      why: 'The rename produces a "widening" operation, and this command plans only "additive" operations. Leave out this statement, or make the change with a command that allows "widening" operations, such as migration plan.',
    },
    {
      case: 'a model stored in no table',
      input: {
        statements: [renameModel('Profile', 'User')],
        fromContract: contractOf({ Profile: { table: null } }),
        contract: user,
        target: fakeTarget([]),
      },
      why: 'A model rename renames the model\'s table, and model "app.Profile" has none in its contract. Leave out this statement.',
    },
    {
      case: 'a model moved to another namespace',
      input: {
        statements: [renameModel('User', 'User', 'auth', 'billing')],
        fromContract: contractOf({ User: { table: 'User', namespace: 'auth' } }),
        contract: contractOf({ User: { table: 'User', namespace: 'billing' } }),
        target: fakeTarget(['auth.User']),
      },
      why: 'The model\'s table would move from namespace "auth" to namespace "billing". Leave out this statement and move the table yourself in a hand-written migration, or keep the model in namespace "auth".',
    },
    {
      case: 'a table the schema being planned from does not have',
      input: {
        statements: [renameModel('Profile', 'User')],
        fromContract: profile,
        contract: user,
        target: fakeTarget([]),
      },
      why: 'The database has no table "Profile", although the contract it was last updated to names it, so the database has drifted from that contract. Inspect it with prisma db schema, or leave out this statement.',
    },
    {
      case: 'a table name another table already holds',
      input: {
        statements: [renameModel('Profile', 'User')],
        fromContract: profile,
        contract: user,
        target: fakeTarget(['app.Profile', 'app.User']),
      },
      why: 'A rename cannot replace a table that already exists. Rename or drop table "User" first, or leave out this statement.',
    },
    {
      case: 'a field of a model stored in no table',
      input: {
        statements: [renameField('User', 'name', 'fullName')],
        fromContract: contractOf({ User: { table: null, fields: { name: 'name' } } }),
        contract: contractOf({ User: { table: null, fields: { fullName: 'fullName' } } }),
        target: fakeTarget([]),
      },
      why: 'A field rename renames the field\'s column, and model "app.User" has no table in its contract. Leave out this statement.',
    },
    {
      case: 'a field that has a column on one side only',
      input: {
        statements: [renameField('User', 'posts', 'title')],
        fromContract: contractOf({ User: { table: 'User', fields: { posts: null } } }),
        contract: contractOf({ User: { table: 'User', fields: { title: 'title' } } }),
        target: fakeTarget(['app.User']),
      },
      why: 'A field rename renames a column or changes nothing in storage, and this field gains or loses its column. Leave out this statement and plan the change without it.',
    },
    {
      case: 'a column the schema being planned from does not have',
      input: {
        statements: [renameField('User', 'name', 'fullName')],
        fromContract: userWithName,
        contract: userWithFullName,
        target: fakeTarget(['app.User'], { 'app.User': ['id'] }),
      },
      why: 'The database has no column "name" on table "User", although the contract it was last updated to names it, so the database has drifted from that contract. Inspect it with prisma db schema, or leave out this statement.',
    },
    {
      case: 'a column of a table the schema being planned from does not have',
      input: {
        statements: [renameField('User', 'name', 'fullName')],
        fromContract: userWithName,
        contract: userWithFullName,
        target: fakeTarget([]),
      },
      why: 'The database has no table "User", although the contract it was last updated to names it, so the database has drifted from that contract. Inspect it with prisma db schema, or leave out this statement.',
    },
    {
      case: 'a column name another column already holds',
      input: {
        statements: [renameField('User', 'name', 'fullName')],
        fromContract: userWithName,
        contract: userWithFullName,
        target: fakeTarget(['app.User'], { 'app.User': ['name', 'fullName'] }),
      },
      why: 'A rename cannot replace a column that already exists. Rename or drop column "fullName" of table "User" first, or leave out this statement.',
    },
    {
      case: 'a plan with no origin contract',
      input: {
        statements: [renameModel('Profile', 'User')],
        fromContract: null,
        contract: user,
        target: fakeTarget([]),
      },
      why: 'A statement names models and fields of the origin contract, and this plan has none. Plan from a contract that has the old names, or leave out the statement.',
    },
  ])('refuses $case with a next step', ({ input, why }) => {
    expect(rejection(planStatements({ policy: ALL_CLASSES, ...input })).why).toBe(why);
  });
});
