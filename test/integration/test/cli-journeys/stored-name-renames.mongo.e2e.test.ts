/**
 * Journeys (MongoDB): a model, field or enum member that keeps its name and changes the name or
 * value it is stored under is renamed or replaced with no question, on both commands, and the
 * documents are read back under their new names.
 *
 * - S1: a `@@map` change renames the collection, with its documents and index.
 * - S2: a field `@map` change, on a root model and on a variant, renames the field.
 * - S3: an embedded model field `@map` change renames the key in both places the model is stored.
 * - S4: an enum member's new stored value replaces the old one in a scalar and a list.
 * - S5: a `@@map` change with a type change, a field rename statement and a removed field answered by `--delete`.
 * - S6: a script that still passes `--delete User` for a `@@map` change is refused as an unused consent.
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
  latestMigrationTs,
  refused,
  useFixture,
  useMongoJourneys,
  useSchema,
} from '../utils/mongo-stored-name-journeys';

const COMMANDS: readonly Command[] = ['migration plan', 'db update'];

const usersPsl = (
  map: string,
  fields = '  email String @unique\n  nick  String?',
) => `// use prisma-8

model User {
  id    ObjectId @id @map("_id")
${fields}

  @@map("${map}")
}
`;

const tasksPsl = (title: string, severity: string) => `// use prisma-8

model Task {
  id    ObjectId @id @map("_id")
  title String   @map("${title}")
  type  String

  @@discriminator(type)
  @@map("tasks")
}

model Bug {
  id       ObjectId @id @map("_id")
  severity String   @map("${severity}")

  @@base(Task, "bug")
}
`;

const statusPsl = (archived: string) => `// use prisma-8

enum Status {
  ACTIVE = "active"
  ARCHIVED = "${archived}"
}

model User {
  id     ObjectId @id @map("_id")
  status Status?
  tags   Status[]

  @@map("users")
}
`;

describe('Journeys (MongoDB): stored-name changes planned with no question', {
  timeout: timeouts.spinUpMongoMemoryServer,
}, () => {
  const project = useMongoJourneys('mongo-stored-names');

  it.each(COMMANDS)(
    'S1: a @@map change renames the collection with its documents and index (%s)',
    async (command) => {
      const journey = project(`s1_${command === 'db update' ? 'update' : 'plan'}`);
      await begin(journey, command, usersPsl('users'), 'S1.01');
      await journey.db.collection('users').insertMany([{ email: 'a@example.com', nick: 'a' }]);
      await useSchema(journey, usersPsl('app_users'), 'S1.02');
      const labels = await apply(journey, command, [], 'S1.03');
      expect({
        labels,
        ...(command === 'migration plan'
          ? {
              renders: latestMigrationTs(journey).includes(
                "renameCollection('users', 'app_users')",
              ),
            }
          : {}),
        collections: await collections(journey.db),
        documents: await documents(journey.db, 'app_users'),
        indexes: (await journey.db.collection('app_users').indexes()).map(({ key }) => key),
      }).toEqual({
        labels: ['Rename collection users to app_users'],
        ...(command === 'migration plan' ? { renders: true } : {}),
        collections: ['app_users'],
        documents: [{ email: 'a@example.com', nick: 'a' }],
        indexes: [{ _id: 1 }, { email: 1 }],
      });
      await expectSettled(journey, 'S1.04');
    },
  );

  it.each(COMMANDS)(
    'S2: a field @map change on a root model and on a variant renames the fields (%s)',
    async (command) => {
      const journey = project(`s2_${command === 'db update' ? 'update' : 'plan'}`);
      await begin(journey, command, tasksPsl('title', 'severity'), 'S2.01');
      await journey.db.collection('tasks').insertMany([
        { title: 'crash', type: 'bug', severity: 'high' },
        { title: 'slow', type: 'bug', severity: 'low' },
      ]);
      await useSchema(journey, tasksPsl('heading', 'level'), 'S2.02');
      expect({
        labels: await apply(journey, command, [], 'S2.03'),
        documents: await documents(journey.db, 'tasks'),
      }).toEqual({
        labels: [
          'Rename field severity to level in collection tasks in documents whose type is "bug"',
          'Rename field title to heading in collection tasks',
          'Update validator on tasks (added: heading, level; removed: title, severity)',
        ],
        documents: [
          { heading: 'crash', type: 'bug', level: 'high' },
          { heading: 'slow', type: 'bug', level: 'low' },
        ],
      });
      await expectSettled(journey, 'S2.04');
    },
  );

  it.each(COMMANDS)(
    'S3: an embedded model field @map change renames the key in both places the model is stored (%s)',
    async (command) => {
      const journey = project(`s3_${command === 'db update' ? 'update' : 'plan'}`);
      await useFixture(journey, 'contract-lines-two-places.ts', 'S3.01');
      await apply(journey, command, [], 'S3.02');
      await journey.db
        .collection('orders')
        .insertOne({ lines: [{ sku: 'A' }], returns: [{ sku: 'B' }] });
      await useFixture(journey, 'contract-lines-two-places-mapped.ts', 'S3.03');
      expect({
        labels: await apply(journey, command, [], 'S3.04'),
        documents: await documents(journey.db, 'orders'),
      }).toEqual({
        labels: [
          'Rename key "sku" to "code" at path "$[*]" in field lines of collection orders',
          'Rename key "sku" to "code" at path "$[*]" in field returns of collection orders',
          'Update validator on orders (changed: lines, returns)',
        ],
        documents: [{ lines: [{ code: 'A' }], returns: [{ code: 'B' }] }],
      });
      await expectSettled(journey, 'S3.05');
    },
  );

  it.each(COMMANDS)(
    'S4: an enum member that keeps its name has its new stored value written in a scalar and a list (%s)',
    async (command) => {
      const journey = project(`s4_${command === 'db update' ? 'update' : 'plan'}`);
      await begin(journey, command, statusPsl('archived'), 'S4.01');
      await journey.db.collection('users').insertMany([
        { status: 'archived', tags: ['archived', 'active'] },
        { status: 'active', tags: [] },
      ]);
      await useSchema(journey, statusPsl('retired'), 'S4.02');
      expect({
        labels: await apply(journey, command, [], 'S4.03'),
        documents: await documents(journey.db, 'users'),
      }).toEqual({
        labels: [
          'Replace value "archived" with "retired" in field status of collection users',
          'Replace value "archived" with "retired" in field tags of collection users',
          'Update validator on users (changed: status, tags)',
        ],
        documents: [
          { status: 'retired', tags: ['retired', 'active'] },
          { status: 'active', tags: [] },
        ],
      });
      await expectSettled(journey, 'S4.04');
    },
  );

  it.each(COMMANDS)(
    'S5: a @@map change with a type change, a field rename statement and a removed field answered by --delete (%s)',
    async (command) => {
      const journey = project(`s5_${command === 'db update' ? 'update' : 'plan'}`);
      await begin(
        journey,
        command,
        usersPsl('users', '  email String\n  nick  String?\n  score Int?\n  name  String?'),
        'S5.01',
      );
      await journey.db
        .collection('users')
        .insertMany([{ email: 'a@example.com', nick: 'a', score: 3, name: 'Ada' }]);
      await useSchema(
        journey,
        usersPsl('app_users', '  email    String\n  score    Float?\n  fullName String?'),
        'S5.02',
      );
      expect({
        labels: await apply(
          journey,
          command,
          ['--rename', 'User.name:User.fullName', '--delete', 'User.nick'],
          'S5.03',
        ),
        documents: await documents(journey.db, 'app_users'),
      }).toEqual({
        labels: [
          'Rename collection users to app_users',
          'Rename field name to fullName in collection app_users',
          'Cast field score in collection app_users from int to double',
          'Remove field nick from collection app_users',
          'Update validator on app_users (changed: score; added: fullName; removed: name, nick)',
        ],
        documents: [{ email: 'a@example.com', fullName: 'Ada', score: 3 }],
      });
      await expectSettled(journey, 'S5.04');
    },
  );

  it.each(COMMANDS)(
    'S6: --delete User for a @@map change answers no question and is refused as unused (%s)',
    async (command) => {
      const journey = project(`s6_${command === 'db update' ? 'update' : 'plan'}`);
      await begin(journey, command, usersPsl('users'), 'S6.01');
      await journey.db.collection('users').insertMany([{ email: 'a@example.com' }]);
      await useSchema(journey, usersPsl('app_users'), 'S6.02');
      const error = await refused(journey, command, ['--delete', 'User'], 'S6.03');
      expect({ code: error.code, collections: await collections(journey.db) }).toEqual({
        code: 'CLI.CONSENT_UNUSED',
        collections: ['users'],
      });
    },
  );
});
