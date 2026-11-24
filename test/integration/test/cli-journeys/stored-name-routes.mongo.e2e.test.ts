/**
 * Journeys (MongoDB): more stored-name refusals, each route followed to the end, and the documents read back under the right names.
 *
 * - T1: a field takes the stored name of a field the destination removes: the field is removed first (both commands).
 * - T2: a new required field is stored under the old name of a renamed field: the rename comes first (both commands).
 * - T3: two collections that move along a chain with no statement, through names nothing uses (both commands).
 * - T4: a new model takes the collection name a rename frees: the rename comes first (both commands).
 */

import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import {
  apply,
  begin,
  type Command,
  collections,
  documents,
  expectSettled,
  refused,
  useMongoJourneys,
  useSchema,
} from '../utils/mongo-stored-name-journeys';
import { planningFailure } from '../utils/stored-name-journeys';

const COMMANDS: readonly Command[] = ['migration plan', 'db update'];

const id = (command: Command) => (command === 'db update' ? 'update' : 'plan');

const usersPsl = (fields: string) => `// use prisma-8

model User {
  id ObjectId @id @map("_id")
${fields}

  @@map("users")
}
`;

/** Root models, each in the collection given, with a field named after the model. */
const modelsPsl = (stored: Readonly<Record<string, string>>) =>
  `// use prisma-8
${Object.entries(stored)
  .map(
    ([model, collection]) => `
model ${model} {
  id ObjectId @id @map("_id")
  ${model.toLowerCase()} String

  @@map("${collection}")
}
`,
  )
  .join('')}`;

describe('Journeys (MongoDB): stored-name refusal routes', {
  timeout: timeouts.spinUpMongoMemoryServer,
}, () => {
  const project = useMongoJourneys('mongo-stored-name-routes');

  it.each(COMMANDS)(
    'T1: a field that takes the stored name of a removed field is refused, and the removed field goes first (%s)',
    async (command) => {
      const journey = project(`t1_${id(command)}`);
      const both = usersPsl('  a  String? @map("x")\n  b  Int?    @map("y")');
      await begin(journey, command, both, 'T1.01');
      await journey.db.collection('users').insertOne({ x: 'first', y: 2 });
      await useSchema(journey, usersPsl('  a  String? @map("y")'), 'T1.02');
      expect(await refused(journey, command, [], 'T1.03')).toEqual(
        planningFailure({
          summary:
            'Cannot rename field "x" to "y" in collection "users": the documents already hold field "y"',
          why: 'The stored name of field "User.a" changes from "x" to "y", and the documents already hold field "y", the stored name of field "User.b". Without the rename the plan would read the values of field "y" as values of field "User.a". Make the change in two plans: first remove field "User.b", or keep it and change its field name to a name nothing uses, such as "prisma_swap_y", and plan and apply that; then make this change and plan again.',
        }),
      );
      await useSchema(journey, usersPsl('  a  String? @map("x")'), 'T1.04');
      await apply(journey, command, ['--delete', 'User.b'], 'T1.05');
      await useSchema(journey, usersPsl('  a  String? @map("y")'), 'T1.06');
      await apply(journey, command, [], 'T1.07');
      expect(await documents(journey.db, 'users')).toEqual([{ y: 'first' }]);
      await expectSettled(journey, 'T1.08');
    },
  );

  it.each(COMMANDS)(
    'T2: a new required field under the old name of a renamed field is refused, and the rename goes first (%s)',
    async (command) => {
      const journey = project(`t2_${id(command)}`);
      await begin(journey, command, usersPsl('  email String @map("email")'), 'T2.01');
      await journey.db.collection('users').insertOne({ email: 'a@example.com' });
      const renamed = '  email  String @map("emailAddress")';
      await useSchema(journey, usersPsl(`${renamed}\n  legacy String @map("email")`), 'T2.02');
      const error = await refused(journey, command, [], 'T2.03');
      expect({ code: error.code, conflicts: error.meta?.['conflicts'] }).toEqual({
        code: 'MIGRATION.PLANNING_FAILED',
        conflicts: [
          {
            kind: 'unsupportedOperation',
            summary:
              'Cannot plan the migration: the migration writes a field that another of its operations reads (Rename field email to emailAddress in collection users; Fill field email in collection users where it is missing or null)',
            why: "MongoDB applies a migration's operations one at a time, without a transaction, and knows that an operation already ran only from the documents. An operation that reads a field another operation of the same migration writes acts on what that operation wrote: at once when it runs later, and when the migration runs again after a later operation stops. Make the change as two changes to the contract, and apply the first, by a migration or by db update, before you make the second: first make the rename, without the new required field; then add the new field.",
          },
        ],
      });
      await useSchema(journey, usersPsl(renamed), 'T2.04');
      await apply(journey, command, [], 'T2.05');
      await useSchema(journey, usersPsl(`${renamed}\n  legacy String @map("email")`), 'T2.06');
      await apply(journey, command, [], 'T2.07');
      expect(await documents(journey.db, 'users')).toEqual([
        { emailAddress: 'a@example.com', email: '' },
      ]);
      await expectSettled(journey, 'T2.08');
    },
  );

  it.each(COMMANDS)(
    'T3: two collections that move along a chain with no statement are refused, and move through names nothing uses (%s)',
    async (command) => {
      const journey = project(`t3_${id(command)}`);
      await begin(journey, command, modelsPsl({ User: 'users', Account: 'accounts' }), 'T3.01');
      await journey.db.collection('users').insertOne({ user: 'Ada' });
      await journey.db.collection('accounts').insertOne({ account: 'Acme' });
      await useSchema(journey, modelsPsl({ User: 'accounts', Account: 'members' }), 'T3.02');
      expect(await refused(journey, command, [], 'T3.03')).toEqual(
        planningFailure({
          summary:
            'Cannot rename collection "users" to "accounts": collection "accounts" is renamed in the same plan',
          why: 'The collection of model "User" changes from "users" to "accounts", and the collection of model "Account" changes from "accounts" to "members". A rename onto a name another rename frees, or takes, needs an order or a temporary name that the plan does not work out, and without the renames the plan would read the documents of collection "accounts" as documents of model "User". Make the change in two plans: first give model "User" the collection "prisma_swap_accounts" and model "Account" the collection "prisma_swap_members", collections nothing uses, and plan and apply that; then give model "User" the collection "accounts" and model "Account" the collection "members", and plan again.',
        }),
      );
      await useSchema(
        journey,
        modelsPsl({ User: 'prisma_swap_accounts', Account: 'prisma_swap_members' }),
        'T3.04',
      );
      await apply(journey, command, [], 'T3.05');
      await useSchema(journey, modelsPsl({ User: 'accounts', Account: 'members' }), 'T3.06');
      await apply(journey, command, [], 'T3.07');
      expect({
        collections: await collections(journey.db),
        accounts: await documents(journey.db, 'accounts'),
        members: await documents(journey.db, 'members'),
      }).toEqual({
        collections: ['accounts', 'members'],
        accounts: [{ user: 'Ada' }],
        members: [{ account: 'Acme' }],
      });
      await expectSettled(journey, 'T3.08');
    },
  );

  it.each(COMMANDS)(
    'T4: a new model in the collection name a rename frees is refused, and the rename goes first (%s)',
    async (command) => {
      const journey = project(`t4_${id(command)}`);
      await begin(journey, command, modelsPsl({ User: 'users' }), 'T4.01');
      await journey.db.collection('users').insertOne({ user: 'Ada' });
      await useSchema(journey, modelsPsl({ User: 'app_users', Legacy: 'users' }), 'T4.02');
      expect(await refused(journey, command, [], 'T4.03')).toEqual(
        planningFailure({
          summary:
            'Cannot rename collection "users" to "app_users": the destination stores model "Legacy" in collection "users", the name the rename frees',
          why: 'The collection of model "User" changes from "users" to "app_users", and the destination stores model "Legacy" in collection "users". MongoDB applies a migration\'s operations one at a time, without a transaction, and knows that an operation already ran only from the documents. A collection rename runs again only while its old collection exists and its new one does not. Once collection "users" exists again, a migration that stopped after the rename cannot be run again to finish it. Make the change in two plans: first rename collection "users" to "app_users" and leave collection "users" out of the contract, and plan and apply that; then add what the destination stores in collection "users", and plan again.',
        }),
      );
      await useSchema(journey, modelsPsl({ User: 'app_users' }), 'T4.04');
      await apply(journey, command, [], 'T4.05');
      await useSchema(journey, modelsPsl({ User: 'app_users', Legacy: 'users' }), 'T4.06');
      await apply(journey, command, [], 'T4.07');
      expect({
        collections: await collections(journey.db),
        app_users: await documents(journey.db, 'app_users'),
        users: await documents(journey.db, 'users'),
      }).toEqual({ collections: ['app_users', 'users'], app_users: [{ user: 'Ada' }], users: [] });
      await expectSettled(journey, 'T4.08');
    },
  );
});
