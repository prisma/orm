/**
 * Journeys (MongoDB): more stored-name refusals, each route followed to the end, and the documents read back under the right names.
 *
 * - T1: a field takes the stored name of a field the destination removes: the field is removed first (both commands).
 * - T2: a new required field is stored under the old name of a renamed field: the rename comes first (both commands).
 * - T3: two collections that move along a chain with no statement, through names nothing uses (both commands).
 * - T4: a new model takes the collection name a rename frees: the rename comes first (both commands).
 * - T5: `--rename` of a model that shares its collection with another root model: the route that plans without the statement and moves the documents in that plan's `migration.ts`, followed to the end (`migration plan`).
 * - T6: the same route with a field `@map` change of the model that stays: the move goes right after the create, so the rename does not reach the moved documents; and a stop at the validator change is finished by removing the stray document and running the migration again, with no edit (`migration plan`).
 * - T7: a variant delete beside a model that moves out: the two plans the route gives, with the documents of the model that moves read back, including one that holds the variant's discriminator value (`migration plan`).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import {
  latestMigrationDirName,
  runMigrate,
  runMigrationPlan,
  selfEmitMigration,
} from '../utils/journey-test-helpers';
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

/** Where the call that creates `collection` ends in a `migration.ts`, after its trailing comma. */
function createCallRange(text: string, collection: string): { start: number; end: number } {
  const start = text.indexOf(`createCollection('${collection}'`);
  if (start === -1) throw new Error(`migration.ts creates no collection ${collection}`);
  let depth = 0;
  for (let index = text.indexOf('(', start); index < text.length; index += 1) {
    if (text[index] === '(') depth += 1;
    if (text[index] === ')') depth -= 1;
    if (depth === 0) return { start, end: text.indexOf(',', index) + 1 };
  }
  throw new Error('unbalanced createCollection call');
}

/** Adds, right after the creation of `to`, the move the route describes: copy the documents `filter` selects from `from` into `to`, then delete them from `from`. */
function withMoveAfterCreate(text: string, from: string, to: string, filter: string): string {
  const imported = text.replace(
    /import \{([^}]*)\} from '([^']*migration)';/,
    (_, names: string, module: string) =>
      `import { ${names.trim().replace(/,$/, '')}, dataTransform, deleteDocuments, rawAggregate } from '${module}';`,
  );
  const { end } = createCallRange(imported, to);
  const move = `\n      dataTransform('move documents to ${to}', { run: () => rawAggregate('${from}', [{ $match: ${filter} }, { $merge: { into: '${to}' } }]) }),\n      deleteDocuments({ collection: '${from}', filter: ${filter} }),`;
  return `${imported.slice(0, end)}${move}${imported.slice(end)}`;
}

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
          why: 'The stored name of field "User.a" changes from "x" to "y", and the documents already hold field "y", the stored name of field "User.b". Without the rename the plan would read the values of field "y" as values of field "User.a". Make the change in two plans: first remove field "User.b", or keep it and change its stored name (@map) to a name nothing uses, such as "prisma_swap_y", and plan and apply that; then make this change and plan again.',
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

  it('T5: --rename of a model that shares its collection is refused, and the documents move in the migration of the plan without the statement', async () => {
    const journey = project('t5_plan');
    const shared = (user: string, collection: string) => `// use prisma-8

model Admin {
  id    ObjectId @id @map("_id")
  admin String

  @@map("users")
}

model ${user} {
  id   ObjectId @id @map("_id")
  user String

  @@map("${collection}")
}
`;
    await begin(journey, 'migration plan', shared('User', 'users'), 'T5.01');
    await journey.db.collection('users').insertMany([{ admin: 'Root' }, { user: 'Ada' }]);
    await useSchema(journey, shared('Member', 'members'), 'T5.02');
    const error = await refused(journey, 'migration plan', ['--rename', 'User:Member'], 'T5.03');
    expect({ code: error.code, why: error.why }).toEqual({
      code: 'MIGRATION.PLANNING_FAILED',
      why: 'Cannot rename model "User" to "Member": collection "users" also stores model "Admin"',
    });

    const planned = await runMigrationPlan(journey.ctx, [
      '--name',
      'move',
      ...(journey.origin === undefined ? [] : ['--from', journey.origin]),
      '--json',
    ]);
    expect(planned.exitCode, `T5.04: ${planned.stderr}`).toBe(0);
    const dir = join(journey.ctx.testDir, 'migrations/app', latestMigrationDirName(journey.ctx));
    const path = join(dir, 'migration.ts');
    const filter = '{ user: { $exists: true } }';
    const written = withMoveAfterCreate(readFileSync(path, 'utf-8'), 'users', 'members', filter);
    writeFileSync(path, written);
    const emitted = await selfEmitMigration(journey.ctx, ['--dir', dir]);
    expect(emitted.exitCode, `T5.05: ${emitted.stdout}${emitted.stderr}`).toBe(0);
    const applied = await runMigrate(journey.ctx);
    expect(applied.exitCode, `T5.06: ${applied.stdout}${applied.stderr}`).toBe(0);
    expect({
      users: await documents(journey.db, 'users'),
      members: await documents(journey.db, 'members'),
    }).toEqual({ users: [{ admin: 'Root' }], members: [{ user: 'Ada' }] });
    await expectSettled(journey, 'T5.07');
  });

  it('T6: the documents move right after the create, before a rename of the staying model reaches them, and a stop after the create is finished by running the migration again', async () => {
    const journey = project('t6_plan');
    const shared = (user: string, collection: string, adminEmail: string) => `// use prisma-8

model Admin {
  id    ObjectId @id @map("_id")
  admin String
  email String  @map("${adminEmail}")

  @@map("users")
}

model ${user} {
  id    ObjectId @id @map("_id")
  user  String
  email String

  @@map("${collection}")
}
`;
    await begin(journey, 'migration plan', shared('User', 'users', 'email'), 'T6.01');
    await journey.db.collection('users').insertMany([
      { admin: 'Root', email: 'root@example.com' },
      { user: 'Ada', email: 'ada@example.com' },
    ]);
    await journey.db
      .collection('users')
      .insertOne({ stray: true }, { bypassDocumentValidation: true });
    await useSchema(journey, shared('Member', 'members', 'mail'), 'T6.02');
    const planned = await runMigrationPlan(journey.ctx, [
      '--name',
      'move',
      ...(journey.origin === undefined ? [] : ['--from', journey.origin]),
      '--json',
    ]);
    expect(planned.exitCode, `T6.03: ${planned.stderr}`).toBe(0);
    const dir = join(journey.ctx.testDir, 'migrations/app', latestMigrationDirName(journey.ctx));
    const path = join(dir, 'migration.ts');
    const filter = '{ user: { $exists: true } }';
    writeFileSync(
      path,
      withMoveAfterCreate(readFileSync(path, 'utf-8'), 'users', 'members', filter),
    );
    expect((await selfEmitMigration(journey.ctx, ['--dir', dir])).exitCode, 'T6.04').toBe(0);

    const stopped = await runMigrate(journey.ctx);
    expect(stopped.exitCode, 'T6.05: the validator change stops on the stray document').not.toBe(0);
    await journey.db.collection('users').deleteMany({ stray: true });
    const finished = await runMigrate(journey.ctx);
    expect(finished.exitCode, `T6.06: ${finished.stdout}${finished.stderr}`).toBe(0);
    const [members] = await journey.db
      .listCollections({ name: 'members' }, { nameOnly: false })
      .toArray();
    expect({
      users: await documents(journey.db, 'users'),
      members: await documents(journey.db, 'members'),
      validated: members?.options?.['validator'] !== undefined,
    }).toEqual({
      users: [{ admin: 'Root', mail: 'root@example.com' }],
      members: [{ user: 'Ada', email: 'ada@example.com' }],
      validated: true,
    });
  });

  it("T7: a variant delete beside a model that moves out is refused, and following the two plans moves that model's documents, even those holding the variant's value, before the delete", async () => {
    const journey = project('t7_plan');
    const tasks = (admins: string, bug: boolean) => `// use prisma-8

model Admin {
  id    ObjectId @id @map("_id")
  admin String
  type  String

  @@map("${admins}")
}

model Task {
  id   ObjectId @id @map("_id")
  type String

  @@discriminator(type)
  @@map("tasks")
}
${
  bug
    ? `
model Bug {
  id  ObjectId @id @map("_id")
  sev String

  @@base(Task, "bug")
}
`
    : ''
}
model Feat {
  id   ObjectId @id @map("_id")
  area String

  @@base(Task, "feat")
}
`;
    await begin(journey, 'migration plan', tasks('tasks', true), 'T7.01');
    await journey.db.collection('tasks').insertMany([
      { type: 'bug', sev: 'high' },
      { type: 'feat', area: 'ui' },
      { type: 'bug', admin: 'Root' },
    ]);
    await useSchema(journey, tasks('admins', false), 'T7.02');
    const error = await refused(journey, 'migration plan', ['--delete', 'Bug'], 'T7.03');
    expect(error.meta?.['conflicts']).toEqual([
      {
        kind: 'unsupportedOperation',
        summary:
          'Cannot delete the documents of variant "Bug": the documents of model "Admin" in collection "tasks" can hold type "bug"',
        why: 'Collection "tasks" stores several models and no discriminator tells their documents apart, so deleting the documents with that value would delete the documents of "Admin" too. A model that moves out of collection "tasks" leaves its documents in it, so make the change in two plans. First move model "Admin" to collection "admins", keep variant "Bug" as it is, and plan that with migration plan. Write that first contract as this one with variant "Bug" kept, so its plan changes collection "admins" as this plan does, which the steps below expect.\n\nIn the operations of the migration.ts it writes, right after the creation of collection "admins" and before the plan\'s own operations on collection "tasks", add a dataTransform. Its run copies the documents of model "Admin" into collection "admins":\n\n  rawAggregate("tasks", [\n    { $match: <a filter that selects only those documents> },\n    { $merge: { into: "admins" } },\n  ])\n\nAfter it, add the operation that deletes the documents of model "Admin" from collection "tasks":\n\n  deleteDocuments({ collection: "tasks", filter: <the same filter> })\n\nThe filter must tell those documents apart from the other documents of collection "tasks", which can hold the same values in the fields they share, a discriminator value among them. Filter by a field only model "Admin" stores.\n\nRun that migration.ts to emit its ops.json, and apply it with db migrate.\n\nIf the apply stops, fix what stopped it and run db migrate again.\n\nUnder db update, apply that change, then move the documents out of collection "tasks" by hand.\n\nThen make the change to variant "Bug" and plan again. Or keep variant "Bug" in the contract.',
      },
    ]);

    await useSchema(journey, tasks('admins', true), 'T7.04');
    const planned = await runMigrationPlan(journey.ctx, [
      '--name',
      'move',
      ...(journey.origin === undefined ? [] : ['--from', journey.origin]),
      '--json',
    ]);
    expect(planned.exitCode, `T7.05: ${planned.stderr}`).toBe(0);
    const dir = join(journey.ctx.testDir, 'migrations/app', latestMigrationDirName(journey.ctx));
    const path = join(dir, 'migration.ts');
    const filter = '{ admin: { $exists: true } }';
    writeFileSync(
      path,
      withMoveAfterCreate(readFileSync(path, 'utf-8'), 'tasks', 'admins', filter),
    );
    expect((await selfEmitMigration(journey.ctx, ['--dir', dir])).exitCode, 'T7.06').toBe(0);
    const moved = await runMigrate(journey.ctx);
    expect(moved.exitCode, `T7.07: ${moved.stdout}${moved.stderr}`).toBe(0);
    journey.origin = latestMigrationDirName(journey.ctx);

    await useSchema(journey, tasks('admins', false), 'T7.08');
    await apply(journey, 'migration plan', ['--delete', 'Bug'], 'T7.09');
    expect({
      tasks: await documents(journey.db, 'tasks'),
      admins: await documents(journey.db, 'admins'),
    }).toEqual({
      tasks: [{ type: 'feat', area: 'ui' }],
      admins: [{ type: 'bug', admin: 'Root' }],
    });
    await expectSettled(journey, 'T7.10');
  });
});
