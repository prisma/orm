/**
 * Journeys (MongoDB): stored-name changes the plan refuses, each refusal's route followed to the
 * end, and the documents found under the right names afterwards.
 *
 * - R1: two collections that swap names, through names nothing uses (both commands).
 * - R2: two fields that swap stored names, through stored names nothing uses (both commands).
 * - R3: a collection rename onto the collection of a removed model: the model is removed first (both commands).
 * - R4: a chain between a collection rename and a model rename statement, in both directions (migration plan).
 * - R5: an enum value chain, through a value no member stores (both commands).
 * - R6: `--rename` of a model that shares its collection with another root model, and its leave-out route: nothing is asked, and the documents stay (both commands).
 * - R7: the JSON error of a refusal with no statement carries no statement.
 */

import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import {
  engineError,
  runDbUpdate,
  runMigrate,
  runMigrationPlan,
} from '../utils/journey-test-helpers';
import {
  apply,
  begin,
  type Command,
  collections,
  documents,
  expectSettled,
  type MongoJourney,
  operationLabels,
  refused,
  useMongoJourneys,
  useSchema,
} from '../utils/mongo-stored-name-journeys';
import { planningFailure } from '../utils/stored-name-journeys';

const COMMANDS: readonly Command[] = ['migration plan', 'db update'];

/** Root models, each in the collection given, with a field named after the model unless a field is given, so that no two collections have the same shape and the storage hash follows a swap. */
const modelsPsl = (collections: Readonly<Record<string, string | readonly [string, string]>>) =>
  `// use prisma-8
${Object.entries(collections)
  .map(([model, place]) => {
    const [collection, field] = typeof place === 'string' ? [place, model.toLowerCase()] : place;
    return `
model ${model} {
  id ObjectId @id @map("_id")
  ${field} String

  @@map("${collection}")
}
`;
  })
  .join('')}`;

const userFieldsPsl = (a: string, b: string) => `// use prisma-8

model User {
  id ObjectId @id @map("_id")
  a  String?  @map("${a}")
  b  Int?     @map("${b}")

  @@map("users")
}
`;

const statusPsl = (a: string, b: string) => `// use prisma-8

enum Status {
  A = "${a}"
  B = "${b}"
}

model User {
  id     ObjectId @id @map("_id")
  status Status?

  @@map("users")
}
`;

const id = (command: Command) => (command === 'db update' ? 'update' : 'plan');

async function seedNames(
  journey: MongoJourney,
  byCollection: Readonly<Record<string, readonly [model: string, value: string]>>,
) {
  for (const [collection, [model, value]] of Object.entries(byCollection)) {
    await journey.db.collection(collection).insertOne({ [model.toLowerCase()]: value });
  }
}

describe('Journeys (MongoDB): stored-name refusals and their routes', {
  timeout: timeouts.spinUpMongoMemoryServer,
}, () => {
  const project = useMongoJourneys('mongo-stored-name-refusals');

  it.each(COMMANDS)(
    'R1: two collections that swap names are refused, and swap through names nothing uses (%s)',
    async (command) => {
      const journey = project(`r1_${id(command)}`);
      await begin(journey, command, modelsPsl({ User: 'users', Account: 'accounts' }), 'R1.01');
      await seedNames(journey, { users: ['User', 'Ada'], accounts: ['Account', 'Acme'] });
      await useSchema(journey, modelsPsl({ User: 'accounts', Account: 'users' }), 'R1.02');
      expect(await refused(journey, command, [], 'R1.03')).toEqual(
        planningFailure({
          summary:
            'Cannot rename collection "accounts" to "users": collection "users" is renamed in the same plan',
          why: 'The collection of model "Account" changes from "accounts" to "users", and the collection of model "User" changes from "users" to "accounts". A rename onto a name another rename frees, or takes, needs an order or a temporary name that the plan does not work out, and without the renames the plan would read the documents of collection "users" as documents of model "Account". Make the change in two plans: first give model "Account" the collection "prisma_swap_users" and model "User" the collection "prisma_swap_accounts", collections nothing uses, and plan and apply that; then give model "Account" the collection "users" and model "User" the collection "accounts", and plan again.',
        }),
      );
      await useSchema(
        journey,
        modelsPsl({ User: 'prisma_swap_accounts', Account: 'prisma_swap_users' }),
        'R1.04',
      );
      await apply(journey, command, [], 'R1.05');
      await useSchema(journey, modelsPsl({ User: 'accounts', Account: 'users' }), 'R1.06');
      await apply(journey, command, [], 'R1.07');
      expect({
        collections: await collections(journey.db),
        users: await documents(journey.db, 'users'),
        accounts: await documents(journey.db, 'accounts'),
      }).toEqual({
        collections: ['accounts', 'users'],
        users: [{ account: 'Acme' }],
        accounts: [{ user: 'Ada' }],
      });
      await expectSettled(journey, 'R1.08');
    },
  );

  it.each(COMMANDS)(
    'R2: two fields that swap stored names are refused, and swap through stored names nothing uses (%s)',
    async (command) => {
      const journey = project(`r2_${id(command)}`);
      await begin(journey, command, userFieldsPsl('x', 'y'), 'R2.01');
      await journey.db.collection('users').insertOne({ x: 'first', y: 2 });
      await useSchema(journey, userFieldsPsl('y', 'x'), 'R2.02');
      expect(await refused(journey, command, [], 'R2.03')).toEqual(
        planningFailure({
          summary:
            'Cannot rename field "x" to "y" in collection "users": field "y" is renamed in the same plan',
          why: 'The stored name of field "User.a" changes from "x" to "y", and the stored name of field "User.b" changes from "y" to "x". A rename onto a name another rename frees, or takes, needs an order or a temporary name that the plan does not work out, and without the renames the plan would read the values of field "y" as values of field "User.a". Make the change in two plans: first give field "User.a" the stored name (@map) "prisma_swap_y" and field "User.b" the stored name (@map) "prisma_swap_x", stored names nothing uses, and plan and apply that; then give field "User.a" the stored name (@map) "y" and field "User.b" the stored name (@map) "x", and plan again.',
        }),
      );
      await useSchema(journey, userFieldsPsl('prisma_swap_y', 'prisma_swap_x'), 'R2.04');
      await apply(journey, command, [], 'R2.05');
      await useSchema(journey, userFieldsPsl('y', 'x'), 'R2.06');
      await apply(journey, command, [], 'R2.07');
      expect(await documents(journey.db, 'users')).toEqual([{ y: 'first', x: 2 }]);
      await expectSettled(journey, 'R2.08');
    },
  );

  it.each(COMMANDS)(
    'R3: a collection rename onto the collection of a removed model is refused, and the model is removed first (%s)',
    async (command) => {
      const journey = project(`r3_${id(command)}`);
      await begin(journey, command, modelsPsl({ User: 'users', Account: 'accounts' }), 'R3.01');
      await seedNames(journey, { users: ['User', 'Ada'], accounts: ['Account', 'Acme'] });
      await useSchema(journey, modelsPsl({ User: 'accounts' }), 'R3.02');
      expect(await refused(journey, command, [], 'R3.03')).toEqual(
        planningFailure({
          summary:
            'Cannot rename collection "users" to "accounts": the schema being planned from already has a collection "accounts"',
          why: 'The collection of model "User" changes from "users" to "accounts", and the schema being planned from already has collection "accounts", the collection of model "Account". Without the rename the plan would read the documents of collection "accounts" as documents of model "User". Make the change in two plans: first remove model "Account", or keep it and change its collection to a name nothing uses, such as "prisma_swap_accounts", and plan and apply that; then make this change and plan again.',
        }),
      );
      await useSchema(journey, modelsPsl({ User: 'users' }), 'R3.04');
      await apply(journey, command, ['--delete', 'Account'], 'R3.05');
      await useSchema(journey, modelsPsl({ User: 'accounts' }), 'R3.06');
      await apply(journey, command, [], 'R3.07');
      expect({
        collections: await collections(journey.db),
        accounts: await documents(journey.db, 'accounts'),
      }).toEqual({ collections: ['accounts'], accounts: [{ user: 'Ada' }] });
      await expectSettled(journey, 'R3.08');
    },
  );

  it('R4: a chain between a collection rename and a model rename statement is refused in both directions, and each route ends', async () => {
    const journey = project('r4_plan');
    await begin(
      journey,
      'migration plan',
      modelsPsl({ User: 'users', Account: 'accounts' }),
      'R4.01',
    );
    await seedNames(journey, { users: ['User', 'Ada'], accounts: ['Account', 'Acme'] });
    const statement = ['--rename', 'Account:Member'];

    await useSchema(
      journey,
      modelsPsl({ User: 'accounts', Member: ['members', 'account'] }),
      'R4.02',
    );
    expect(await refused(journey, 'migration plan', statement, 'R4.03')).toEqual(
      planningFailure({
        summary:
          'Cannot rename collection "users" to "accounts": collection "accounts" is renamed in the same plan',
        why: 'The collection of model "User" changes from "users" to "accounts", and model "Account" is renamed to "Member", which renames collection "accounts" to "members". A rename onto a name another rename frees, or takes, needs an order or a temporary name that the plan does not work out, and without the renames the plan would read the documents of collection "accounts" as documents of model "User". Make the change in two plans: first give model "User" the collection "prisma_swap_accounts" and model "Member" the collection "prisma_swap_members", collections nothing uses, and plan and apply that with the same statements; then give model "User" the collection "accounts" and model "Member" the collection "members", and plan again without them.',
      }),
    );
    await useSchema(
      journey,
      modelsPsl({ User: 'prisma_swap_accounts', Member: ['prisma_swap_members', 'account'] }),
      'R4.04',
    );
    await apply(journey, 'migration plan', statement, 'R4.05');
    await useSchema(
      journey,
      modelsPsl({ User: 'accounts', Member: ['members', 'account'] }),
      'R4.06',
    );
    await apply(journey, 'migration plan', [], 'R4.07');
    expect({
      accounts: await documents(journey.db, 'accounts'),
      members: await documents(journey.db, 'members'),
    }).toEqual({ accounts: [{ user: 'Ada' }], members: [{ account: 'Acme' }] });

    const back = ['--rename', 'Member:Account'];
    await useSchema(journey, modelsPsl({ User: 'people', Account: 'accounts' }), 'R4.08');
    expect(await refused(journey, 'migration plan', back, 'R4.09')).toEqual(
      planningFailure({
        summary:
          'Cannot rename collection "accounts" to "people": another rename in the same plan takes collection name "accounts"',
        why: 'The collection of model "User" changes from "accounts" to "people", and model "Member" is renamed to "Account", which renames collection "members" to "accounts". A rename onto a name another rename frees, or takes, needs an order or a temporary name that the plan does not work out. Make the change in two plans: first give model "User" the collection "prisma_swap_people" and model "Account" the collection "prisma_swap_accounts", collections nothing uses, and plan and apply that with the same statements; then give model "User" the collection "people" and model "Account" the collection "accounts", and plan again without them.',
      }),
    );
    await useSchema(
      journey,
      modelsPsl({ User: 'prisma_swap_people', Account: 'prisma_swap_accounts' }),
      'R4.10',
    );
    await apply(journey, 'migration plan', back, 'R4.11');
    await useSchema(journey, modelsPsl({ User: 'people', Account: 'accounts' }), 'R4.12');
    await apply(journey, 'migration plan', [], 'R4.13');
    expect({
      people: await documents(journey.db, 'people'),
      accounts: await documents(journey.db, 'accounts'),
    }).toEqual({ people: [{ user: 'Ada' }], accounts: [{ account: 'Acme' }] });
    await expectSettled(journey, 'R4.14');
  });

  it.each(COMMANDS)(
    'R5: an enum value chain is refused, and moves through a value no member stores (%s)',
    async (command) => {
      const journey = project(`r5_${id(command)}`);
      await begin(journey, command, statusPsl('a', 'b'), 'R5.01');
      await journey.db.collection('users').insertMany([{ status: 'a' }, { status: 'b' }]);
      await useSchema(journey, statusPsl('b', 'c'), 'R5.02');
      expect(await refused(journey, command, [], 'R5.03')).toEqual(
        planningFailure({
          summary:
            'Cannot change the stored values of enum "Status": enum values "Status.A" and "Status.B" move stored values along a chain, "a" to "b" and "b" to "c", and a rewrite of one would write a value another still has to read',
          why: 'MongoDB applies a migration\'s operations one at a time, without a transaction, and knows that an operation already ran only from the documents. A rewrite of a value that another rewrite of the same migration writes would act on what that one wrote when the migration runs again after a later operation stops. Make the change in two plans: first give "Status.A" a stored value no member stores, such as "prisma_swap_1"; give "Status.B" the stored value "c"; and plan and apply that; then give "Status.A" the stored value "b"; and plan again.',
        }),
      );
      await useSchema(journey, statusPsl('prisma_swap_1', 'c'), 'R5.04');
      await apply(journey, command, [], 'R5.05');
      await useSchema(journey, statusPsl('b', 'c'), 'R5.06');
      await apply(journey, command, [], 'R5.07');
      expect(await documents(journey.db, 'users')).toEqual([{ status: 'b' }, { status: 'c' }]);
      await expectSettled(journey, 'R5.08');
    },
  );

  it.each(COMMANDS)(
    'R6: --rename of a model that shares its collection with another root model is refused, and without it nothing is asked, the validator change stops on the documents that stay, and under db update the run finishes once they are deleted (%s)',
    async (command) => {
      const journey = project(`r6_${id(command)}`);
      await begin(journey, command, modelsPsl({ Admin: 'users', User: 'users' }), 'R6.01');
      await journey.db.collection('users').insertMany([{ user: 'Ada' }]);
      await useSchema(journey, modelsPsl({ Admin: 'users', Member: ['members', 'user'] }), 'R6.02');
      const error = await refused(journey, command, ['--rename', 'User:Member'], 'R6.03');
      expect({
        code: error.code,
        conflicts: error.meta?.['conflicts'],
        documents: await documents(journey.db, 'users'),
      }).toEqual({
        code: 'MIGRATION.PLANNING_FAILED',
        conflicts: [
          expect.objectContaining({
            kind: 'statementRefused',
            summary:
              'Cannot rename model "User" to "Member": collection "users" also stores model "Admin"',
            why: 'A collection rename moves every document of the collection, and the documents of model "Admin" do not move to collection "members". Moving the documents of one model out of a collection it shares with others is a data migration, which a plan does not write. Leave out this statement to plan the change without moving them: model "User" is then removed and nothing is asked, since nothing is deleted: its documents stay in collection "users", where model "Admin" still reads them, and model "Member" starts with no documents. If the new validator of collection "users" does not accept them, its change stops the apply in every database that holds them, until they are deleted or moved there. With migration plan, keep the documents by moving them in the migration that plan writes: plan the change without this statement, and in the operations of the migration.ts it writes, right after the creation of collection "members" and before any other operation on collection "users", add a dataTransform whose run copies the documents of model "User" into collection "members", such as rawAggregate("users", [{ $match: <a filter that selects only those documents> }, { $merge: { into: "members" } }]), and a deleteDocuments({ collection: "users", filter: <the same filter> }); then run that migration.ts to emit its ops.json, and apply it with db migrate. This works only when a filter can tell those documents apart from the other documents of collection "users", which can hold the same values in the fields they share, such as a discriminator value: filter by a field only model "User" stores. If the apply stops after collection "members" is created, do not drop it, since it holds the moved documents: remove its creation from that migration.ts, run the file again, fix what stopped the apply, and run db migrate again.',
          }),
        ],
        documents: [{ user: 'Ada' }],
      });

      const planned =
        command === 'migration plan'
          ? await runMigrationPlan(journey.ctx, [
              '--name',
              'leave-out',
              ...(journey.origin === undefined ? [] : ['--from', journey.origin]),
              '--json',
            ])
          : undefined;
      const run = () =>
        command === 'db update'
          ? runDbUpdate(journey.ctx, ['--no-interactive', '--json'])
          : runMigrate(journey.ctx, ['--json']);
      const stopped = await run();
      expect({
        planned: planned === undefined ? undefined : operationLabels(planned),
        code: engineError(stopped)?.code,
        users: await documents(journey.db, 'users'),
      }).toEqual({
        planned:
          command === 'migration plan'
            ? ['Create collection members', 'Update validator on users (removed: user)']
            : undefined,
        code: 'MIGRATION.PRECHECK_FAILED',
        users: [{ user: 'Ada' }],
      });

      if (command === 'db update') {
        await journey.db.collection('users').deleteMany({ user: { $exists: true } });
        const finished = await run();
        expect({
          exitCode: finished.exitCode,
          collections: await collections(journey.db),
          users: await documents(journey.db, 'users'),
          members: await documents(journey.db, 'members'),
        }).toEqual({ exitCode: 0, collections: ['members', 'users'], users: [], members: [] });
        await expectSettled(journey, 'R6.05');
      }
    },
  );

  it('R7: the JSON error of a refusal with no statement carries no statement', async () => {
    const journey = project('r7_update');
    await begin(journey, 'db update', userFieldsPsl('x', 'y'), 'R7.01');
    await useSchema(journey, userFieldsPsl('y', 'x'), 'R7.02');
    const error = await refused(journey, 'db update', [], 'R7.03');
    const text = JSON.stringify(error);
    expect({
      refusedStatement: text.includes('refusedStatement'),
      thisStatement: text.includes('this statement'),
    }).toEqual({ refusedStatement: false, thisStatement: false });
  });
});
