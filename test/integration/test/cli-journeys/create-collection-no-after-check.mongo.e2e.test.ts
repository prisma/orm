/**
 * Journey (MongoDB): a migration emitted before a create had an after-check stops at a collection
 * that already exists, and its by-hand route is followed to the end: the operations that did not
 * run are applied by hand, and `db sign` records the migration's contract.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import {
  engineError,
  latestMigrationDirName,
  runDbSign,
  runMigrate,
  runMigrationPlan,
} from '../utils/journey-test-helpers';
import { attestMigration } from '../utils/journey-workspace-helpers';
import {
  documents,
  expectSettled,
  useMongoJourneys,
  useSchema,
} from '../utils/mongo-stored-name-journeys';

const itemsPsl = `// use prisma-8

model Item {
  id    ObjectId @id @map("_id")
  title String   @map("t")

  @@index([title])
  @@map("items")
}
`;

interface Operation {
  readonly id: string;
  readonly label: string;
  readonly operationClass: 'additive' | 'widening' | 'destructive' | 'data';
  postcheck: readonly unknown[];
  readonly execute: readonly { readonly command: Record<string, unknown> }[];
}

/** Empties the after-check of the migration's create, as migrations emitted before this release have it, and attests the migration again. */
function withoutCreateAfterCheck(dir: string): Operation {
  const ops: Operation[] = JSON.parse(readFileSync(join(dir, 'ops.json'), 'utf-8'));
  const create = ops.find(({ id }) => id === 'collection.items.create');
  if (create === undefined) throw new Error(JSON.stringify(ops.map(({ id }) => id)));
  create.postcheck = [];
  writeFileSync(join(dir, 'ops.json'), JSON.stringify(ops, null, 2));
  const manifest = JSON.parse(readFileSync(join(dir, 'migration.json'), 'utf-8'));
  writeFileSync(
    join(dir, 'migration.json'),
    JSON.stringify(attestMigration(manifest, ops), null, 2),
  );
  return create;
}

describe('Journey (MongoDB): a create with no after-check finds its collection', {
  timeout: timeouts.spinUpMongoMemoryServer,
}, () => {
  const project = useMongoJourneys('mongo-create-no-after-check');

  it('L1: the operations that did not run are applied by hand, and db sign records the migration, so the next db migrate has nothing to do', async () => {
    const journey = project('l1_sign');
    const { ctx, db } = journey;
    await useSchema(journey, itemsPsl, 'L1.01');
    const planned = await runMigrationPlan(ctx, ['--name', 'init', '--json']);
    expect(planned.exitCode, `L1.02: ${planned.stderr}`).toBe(0);
    const name = latestMigrationDirName(ctx);
    const create = withoutCreateAfterCheck(join(ctx.testDir, 'migrations/app', name));
    await db.createCollection('items');
    await db.collection('items').insertOne({ t: 'keep' });

    const stopped = await runMigrate(ctx, ['--json']);
    const advice = engineError(stopped)?.why;
    const { validator, validationLevel, validationAction } = create.execute[0]?.command ?? {};
    await db.command({ collMod: 'items', validator, validationLevel, validationAction });
    await db.collection('items').createIndex({ t: 1 }, { name: 't_1' });
    const unsigned = await runMigrate(ctx, ['--json']);
    const signed = await runDbSign(ctx, [name, '--json']);
    const migrated = await runMigrate(ctx, ['--json']);

    expect({
      stopped: stopped.exitCode,
      advice,
      unsigned: engineError(unsigned)?.summary,
      signed: signed.exitCode,
      migrated: migrated.exitCode,
      items: await documents(db, 'items'),
    }).toEqual({
      stopped: 2,
      advice: expect.stringContaining(
        "Otherwise leave the migration as it is, apply the operations of this migration that did not run by hand, then run db sign with the name of this migration's directory: it checks that the database matches the contract this migration leads to and records the database there, so the next run starts after this migration.",
      ),
      unsigned:
        "Operation collection.items.create stopped: collection items already exists, and this migration's create has no after-check that lets a run skip it",
      signed: 0,
      migrated: 0,
      items: [{ t: 'keep' }],
    });
    await expectSettled(journey, 'L1.03');
  });
});
