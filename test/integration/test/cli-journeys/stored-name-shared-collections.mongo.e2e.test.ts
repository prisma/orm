/**
 * Journeys (MongoDB): collection changes of models that share a collection, and `db update` against a database renamed by hand.
 *
 * A variant cannot gain its own `@@map`: MongoDB variants share their base model's collection, and the contract refuses a different one.
 *
 * - C1: one of two root models that share a collection moves to its own collection (both commands).
 * - C2: two models in their own collections merge into one new collection: no rename, and the question about both old collections (both commands).
 * - C3: `db update` after a collection renamed by hand, with a field `@map` change, a removed field answered by `--delete`, and a field rename statement.
 * - C4: `db update` when the database has both the old and the new collection, its advice followed to the end.
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
  update,
  useMongoJourneys,
  useSchema,
} from '../utils/mongo-stored-name-journeys';

const COMMANDS: readonly Command[] = ['migration plan', 'db update'];

const id = (command: Command) => (command === 'db update' ? 'update' : 'plan');

const rootsPsl = (admin: string, user: string) => `// use prisma-8

model Admin {
  id    ObjectId @id @map("_id")
  admin String

  @@map("${admin}")
}

model User {
  id   ObjectId @id @map("_id")
  user String

  @@map("${user}")
}
`;

const usersPsl = (collection: string, fields: string) => `// use prisma-8

model User {
  id    ObjectId @id @map("_id")
${fields}

  @@map("${collection}")
}
`;

const MERGE_WHY = (model: string, collection: string) =>
  `Drop collection ${collection} would lose the data of model "${model}". The destination stores models "Admin" and "User" in collection "people", and the origin stores them in different collections, so their storage is being merged. Keeping their documents is a data migration, which a plan does not write. With migration plan, write this change as a hand-written migration instead: run prisma migration new, and in the operations of the migration.ts it writes, rewrite the documents of models "Admin" and "User" into collection "people" yourself, with the other operations of the change. Then run that migration.ts to emit its ops.json.`;

describe('Journeys (MongoDB): shared collections and collections renamed by hand', {
  timeout: timeouts.spinUpMongoMemoryServer,
}, () => {
  const project = useMongoJourneys('mongo-shared-collections');

  it.each(COMMANDS)(
    'C1: one of two root models that share a collection moves to its own, and no document of the other moves (%s)',
    async (command) => {
      const journey = project(`c1_${id(command)}`);
      await begin(journey, command, rootsPsl('people', 'people'), 'C1.01');
      await journey.db.collection('people').insertMany([{ admin: 'Root' }]);
      await useSchema(journey, rootsPsl('people', 'users'), 'C1.02');
      expect({
        labels: await apply(journey, command, [], 'C1.03'),
        collections: await collections(journey.db),
        people: await documents(journey.db, 'people'),
      }).toEqual({
        labels: ['Create collection users', 'Update validator on people (removed: user)'],
        collections: ['people', 'users'],
        people: [{ admin: 'Root' }],
      });
      await expectSettled(journey, 'C1.04');
    },
  );

  it.each(COMMANDS)(
    'C2: two models in their own collections that merge into one new collection rename neither, and the old collections are asked about (%s)',
    async (command) => {
      const journey = project(`c2_${id(command)}`);
      await begin(journey, command, rootsPsl('admins', 'users'), 'C2.01');
      await useSchema(journey, rootsPsl('people', 'people'), 'C2.02');
      const question = await refused(journey, command, [], 'C2.03');
      expect({
        code: question.code,
        unanswered: question.meta?.['unanswered'],
        nextActions: question.nextActions,
        why: question.why,
      }).toEqual({
        code: 'CLI.CONSENT_REQUIRED',
        unanswered: [
          { subject: 'Admin', verbs: ['delete'] },
          { subject: 'User', verbs: ['delete'] },
        ],
        nextActions: [
          { kind: 'user-choice', label: 'Run the command again with --delete Admin' },
          { kind: 'user-choice', label: 'Run the command again with --delete User' },
        ],
        why: `${MERGE_WHY('Admin', 'admins')}\n${MERGE_WHY('User', 'users')}`,
      });
      expect({
        labels: await apply(journey, command, ['--delete', 'Admin', '--delete', 'User'], 'C2.04'),
        collections: await collections(journey.db),
      }).toEqual({
        labels: ['Create collection people', 'Drop collection admins', 'Drop collection users'],
        collections: ['people'],
      });
      await expectSettled(journey, 'C2.05');
    },
  );

  it('C3: db update after a collection renamed by hand plans the field @map change, the removed field and the field rename statement', async () => {
    const journey = project('c3_update');
    await begin(
      journey,
      'db update',
      usersPsl('users', '  email String\n  nick  String?\n  name  String?'),
      'C3.01',
    );
    await journey.db
      .collection('users')
      .insertOne({ email: 'a@example.com', nick: 'a', name: 'Ada' });
    await journey.db.collection('users').rename('app_users');
    await useSchema(
      journey,
      usersPsl('app_users', '  email    String  @map("mail")\n  fullName String?'),
      'C3.02',
    );
    expect({
      labels: await update(
        journey,
        ['--rename', 'User.name:User.fullName', '--delete', 'User.nick'],
        'C3.03',
      ),
      collections: await collections(journey.db),
      documents: await documents(journey.db, 'app_users'),
    }).toEqual({
      labels: [
        'Rename field name to fullName in collection app_users',
        'Rename field email to mail in collection app_users',
        'Remove field nick from collection app_users',
        'Update validator on app_users (added: fullName, mail; removed: email, name, nick)',
      ],
      collections: ['app_users'],
      documents: [{ mail: 'a@example.com', fullName: 'Ada' }],
    });
    await expectSettled(journey, 'C3.04');
  });

  it('C4: db update when the database has both the old and the new collection is refused, and its first fix followed to the end', async () => {
    const journey = project('c4_update');
    await begin(journey, 'db update', usersPsl('users', '  email String'), 'C4.01');
    await journey.db.collection('users').insertOne({ email: 'a@example.com' });
    await journey.db.collection('app_users').insertOne({ email: 'b@example.com' });
    await useSchema(journey, usersPsl('app_users', '  email String'), 'C4.02');
    const why =
      'The collection of model "User" changes from "users" to "app_users", and the database has both collection "users" and collection "app_users". One of two things happened, and each has its own fix. If the rename was half done by hand, or the application wrote to collection "app_users" before db update ran, collection "users" holds the documents of model "User": move into collection "users" the documents of collection "app_users" that it does not already hold, and where both collections hold a document with the same _id, keep the version you want in collection "users"; then drop collection "app_users", and run again. If collection "users" was renamed to "app_users" by hand and the name "users" then used for another collection, collection "app_users" holds the documents of model "User": drop collection "users", and run again; to keep the documents of that other collection, first move them into a collection the contract has, since db update drops every collection the contract does not have.';
    expect(await refused(journey, 'db update', [], 'C4.03')).toEqual({
      code: 'MIGRATION.PLANNING_FAILED',
      docsUrl:
        'https://docs.prisma.io/docs/orm/v8/reference/error-reference#MIGRATION.PLANNING_FAILED',
      meta: {
        conflicts: [
          {
            kind: 'unsupportedOperation',
            summary:
              'Cannot rename collection "users" to "app_users": the database has both collections',
            why,
          },
        ],
      },
      nextActions: [{ kind: 'user-choice', label: why }],
      severity: 'error',
      summary: 'Migration planning failed',
      why: 'Cannot rename collection "users" to "app_users": the database has both collections',
    });

    const written = await journey.db.collection('app_users').find().toArray();
    await journey.db.collection('users').insertMany(written);
    await journey.db.collection('app_users').drop();
    expect({
      labels: await update(journey, [], 'C4.04'),
      collections: await collections(journey.db),
      documents: await documents(journey.db, 'app_users'),
    }).toEqual({
      labels: ['Rename collection users to app_users'],
      collections: ['app_users'],
      documents: [{ email: 'a@example.com' }, { email: 'b@example.com' }],
    });
    await expectSettled(journey, 'C4.05');
  });
});
