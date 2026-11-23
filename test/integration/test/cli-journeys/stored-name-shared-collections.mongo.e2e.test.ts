/**
 * Journeys (MongoDB): collection changes of models that share a collection.
 *
 * A variant cannot gain its own `@@map`: MongoDB variants share their base model's collection, and the contract refuses a different one.
 *
 * - C1: one of two root models that share a collection moves to its own collection: its documents stay behind and are asked about, and the `--delete` route is followed with them deleted (both commands).
 * - C2: two models in their own collections merge into one new collection: no rename, and the question about both old collections (both commands).
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

const MERGE_WHY = (model: string, collection: string) =>
  `Drop collection ${collection} would lose the data of model "${model}". The destination stores models "Admin" and "User" in collection "people", and the origin stores them in different collections, so their storage is being merged. Keeping their documents is a data migration, which a plan does not write. With migration plan, write this change as a hand-written migration instead: run prisma migration new, and in the operations of the migration.ts it writes, rewrite the documents of models "Admin" and "User" into collection "people" yourself, with the other operations of the change. Then run that migration.ts to emit its ops.json.`;

describe('Journeys (MongoDB): shared collections', {
  timeout: timeouts.spinUpMongoMemoryServer,
}, () => {
  const project = useMongoJourneys('mongo-shared-collections');

  it.each(COMMANDS)(
    'C1: one of two root models that share a collection moves to its own: no document moves, and the documents left behind are asked about (%s)',
    async (command) => {
      const journey = project(`c1_${id(command)}`);
      await begin(journey, command, rootsPsl('people', 'people'), 'C1.01');
      await journey.db.collection('people').insertMany([{ admin: 'Root' }, { user: 'Ada' }]);
      await useSchema(journey, rootsPsl('people', 'users'), 'C1.02');
      const question = await refused(journey, command, [], 'C1.03');
      expect({
        code: question.code,
        unanswered: question.meta?.['unanswered'],
        why: question.why,
      }).toEqual({
        code: 'CLI.CONSENT_REQUIRED',
        unanswered: [{ subject: 'User', verbs: ['delete'] }],
        why: 'Update validator on people (removed: user) would lose the data of model "User". The origin stores models "Admin" and "User" in collection "people", and no discriminator tells their documents apart, so the plan cannot move to collection "users" the documents of model "User": they stay in collection "people", where they are read as documents of model "Admin". Keeping their documents is a data migration, which a plan does not write. With migration plan, write this change as a hand-written migration instead: run prisma migration new, and in the operations of the migration.ts it writes, rewrite the documents of model "User" into collection "users" yourself, with the other operations of the change. Then run that migration.ts to emit its ops.json. Answered with --delete, the plan leaves them where they are; if the new validator of collection "people" does not accept them, its change stops the apply until you delete or move them in the database.',
      });

      await journey.db.collection('people').deleteMany({ user: { $exists: true } });
      expect({
        labels: await apply(journey, command, ['--delete', 'User'], 'C1.04'),
        collections: await collections(journey.db),
        people: await documents(journey.db, 'people'),
      }).toEqual({
        labels: ['Create collection users', 'Update validator on people (removed: user)'],
        collections: ['people', 'users'],
        people: [{ admin: 'Root' }],
      });
      await expectSettled(journey, 'C1.05');
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
});
