/**
 * Journeys (MongoDB): collection changes of models that share a collection.
 *
 * A variant cannot gain its own `@@map`: MongoDB variants share their base model's collection, and the contract refuses a different one.
 *
 * - C1: one of two root models that share a collection moves to its own collection: planned as before this work, with no rename and no question; its documents stay in the shared collection, and the validator change stops on them (both commands).
 * - C2: two models in their own collections merge into one new collection: no rename, and the question about both old collections (both commands).
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
  operationLabels,
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

const MERGE_WHY = (model: string, collection: string) =>
  `Drop collection ${collection} would lose the data of model "${model}". The destination stores models "Admin" and "User" in collection "people", and the origin stores them in different collections, so their storage is being merged. Keeping their documents is a data migration, which a plan does not write. With migration plan, write this change as a hand-written migration instead: run prisma migration new, and in the operations of the migration.ts it writes, rewrite the documents of models "Admin" and "User" into collection "people" yourself, with the other operations of the change. Then run that migration.ts to emit its ops.json.`;

describe('Journeys (MongoDB): shared collections', {
  timeout: timeouts.spinUpMongoMemoryServer,
}, () => {
  const project = useMongoJourneys('mongo-shared-collections');

  it.each(COMMANDS)(
    'C1: one of two root models that share a collection moves to its own: no rename and no question, its documents stay where they are, and the validator change stops on them (%s)',
    async (command) => {
      const journey = project(`c1_${id(command)}`);
      await begin(journey, command, rootsPsl('people', 'people'), 'C1.01');
      await journey.db.collection('people').insertMany([{ admin: 'Root' }, { user: 'Ada' }]);
      await useSchema(journey, rootsPsl('people', 'users'), 'C1.02');
      const labels =
        command === 'db update'
          ? await update(journey, ['--dry-run'], 'C1.03')
          : operationLabels(
              await runMigrationPlan(journey.ctx, [
                '--name',
                'move',
                ...(journey.origin === undefined ? [] : ['--from', journey.origin]),
                '--json',
              ]),
            );
      const applied =
        command === 'db update'
          ? await runDbUpdate(journey.ctx, ['--no-interactive', '--json'])
          : await runMigrate(journey.ctx, ['--json']);
      expect({
        labels,
        stopped: applied.exitCode !== 0,
        code: engineError(applied)?.code,
        collections: await collections(journey.db),
        people: await documents(journey.db, 'people'),
        users: await documents(journey.db, 'users'),
      }).toEqual({
        labels: ['Create collection users', 'Update validator on people (removed: user)'],
        stopped: true,
        code: 'MIGRATION.PRECHECK_FAILED',
        collections: ['people', 'users'],
        people: [{ admin: 'Root' }, { user: 'Ada' }],
        users: [],
      });
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
