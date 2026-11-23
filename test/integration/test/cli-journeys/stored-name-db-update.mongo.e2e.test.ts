/**
 * Journeys (MongoDB): `db update` against a database that does not match its last contract.
 *
 * - D1: a collection renamed by hand, with a field `@map` change, a removed field answered by `--delete`, and a field rename statement: nothing is planned for the collection.
 * - D2: the database has both the old and the new collection: refused, and its first fix followed to the end.
 */

import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import {
  begin,
  collections,
  documents,
  expectSettled,
  refused,
  update,
  useMongoJourneys,
  useSchema,
} from '../utils/mongo-stored-name-journeys';

const usersPsl = (collection: string, fields: string) => `// use prisma-8

model User {
  id    ObjectId @id @map("_id")
${fields}

  @@map("${collection}")
}
`;

describe('Journeys (MongoDB): db update against a database renamed by hand', {
  timeout: timeouts.spinUpMongoMemoryServer,
}, () => {
  const project = useMongoJourneys('mongo-stored-name-db-update');

  it('D1: db update after a collection renamed by hand plans the field @map change, the removed field and the field rename statement', async () => {
    const journey = project('d1_update');
    await begin(
      journey,
      'db update',
      usersPsl('users', '  email String\n  nick  String?\n  name  String?'),
      'D1.01',
    );
    await journey.db
      .collection('users')
      .insertOne({ email: 'a@example.com', nick: 'a', name: 'Ada' });
    await journey.db.collection('users').rename('app_users');
    await useSchema(
      journey,
      usersPsl('app_users', '  email    String  @map("mail")\n  fullName String?'),
      'D1.02',
    );
    expect({
      labels: await update(
        journey,
        ['--rename', 'User.name:User.fullName', '--delete', 'User.nick'],
        'D1.03',
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
    await expectSettled(journey, 'D1.04');
  });

  it('D2: db update when the database has both the old and the new collection is refused, and its first fix followed to the end', async () => {
    const journey = project('d2_update');
    await begin(journey, 'db update', usersPsl('users', '  email String'), 'D2.01');
    await journey.db.collection('users').insertOne({ email: 'a@example.com' });
    await journey.db.collection('app_users').insertOne({ email: 'b@example.com' });
    await useSchema(journey, usersPsl('app_users', '  email String'), 'D2.02');
    const why =
      'The collection of model "User" changes from "users" to "app_users", and the database has both collection "users" and collection "app_users". One of two things happened, and each has its own fix. If the rename was half done by hand, or the application wrote to collection "app_users" before db update ran, collection "users" holds the documents of model "User": move into collection "users" the documents of collection "app_users" that it does not already hold, and where both collections hold a document with the same _id, keep the version you want in collection "users"; then drop collection "app_users", and run again. If collection "users" was renamed to "app_users" by hand and the name "users" then used for another collection, collection "app_users" holds the documents of model "User": drop collection "users", and run again; to keep the documents of that other collection, first move them into a collection the contract has, since db update drops every collection the contract does not have.';
    expect(await refused(journey, 'db update', [], 'D2.03')).toEqual({
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
      labels: await update(journey, [], 'D2.04'),
      collections: await collections(journey.db),
      documents: await documents(journey.db, 'app_users'),
    }).toEqual({
      labels: ['Rename collection users to app_users'],
      collections: ['app_users'],
      documents: [{ email: 'a@example.com' }, { email: 'b@example.com' }],
    });
    await expectSettled(journey, 'D2.05');
  });
});
