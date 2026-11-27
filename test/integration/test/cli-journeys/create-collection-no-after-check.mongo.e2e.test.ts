/**
 * Journey (MongoDB): a migration emitted before a create had an after-check stops at a collection
 * that already exists, and its by-hand route is followed to the end: the operations that did not
 * run are applied by hand, and `db sign` records the migration's contract. On a database whose
 * change policy permits only migrations, the advice offers no such route.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import {
  engineError,
  latestMigrationDirName,
  parseJsonOutput,
  runDbSign,
  runMigrate,
  runMigrationPlan,
  runMigrationStatus,
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

const notePsl = `// use prisma-8

model Note {
  id   ObjectId @id @map("_id")
  text String

  @@map("notes")
}
`;

const noteAndItemsPsl = `${notePsl}
${itemsPsl.replace('// use prisma-8\n', '')}`;

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
    const status = parseJsonOutput<{
      readonly summary: string;
      readonly spaces: readonly { readonly migrations: readonly { readonly status: unknown }[] }[];
    }>(await runMigrationStatus(ctx, ['--json']));
    const migrated = await runMigrate(ctx, ['--json']);

    expect({
      stopped: stopped.exitCode,
      advice,
      unsigned: engineError(unsigned)?.summary,
      signed: signed.exitCode,
      status: {
        summary: status.summary,
        marks: status.spaces[0]?.migrations.map((migration) => migration.status),
      },
      migrated: migrated.exitCode,
      items: await documents(db, 'items'),
    }).toEqual({
      stopped: 2,
      advice: expect.stringContaining(
        "Otherwise leave the migration as it is, apply the operations of this migration that did not run by hand, then run db sign with the name of this migration's directory. db sign checks the collections, their validators and their indexes against the contract this migration leads to, not the documents, so first check yourself that the documents are as the operations you applied leave them. It then records the database at that contract, so the next run starts after this migration. migration status then shows the database as up to date, but does not mark this migration as applied, since no run of it is recorded.",
      ),
      unsigned:
        "Operation collection.items.create stopped: collection items already exists, and this migration's create has no after-check that lets a run skip it",
      signed: 0,
      status: { summary: 'Up to date', marks: [null] },
      migrated: 0,
      items: [{ t: 'keep' }],
    });
    await expectSettled(journey, 'L1.03');
  });

  it('L2: on a database whose change policy permits only migrations, the advice offers no db sign route and says no recovery remains when the first two do not apply', async () => {
    const journey = project('l2_migrate_only');
    const { ctx, db } = journey;
    await useSchema(journey, notePsl, 'L2.01');
    const first = await runMigrationPlan(ctx, ['--name', 'notes', '--json']);
    expect(first.exitCode, `L2.02: ${first.stderr}`).toBe(0);
    const manifest = JSON.parse(
      readFileSync(
        join(ctx.testDir, 'migrations/app', latestMigrationDirName(ctx), 'migration.json'),
        'utf-8',
      ),
    );
    const refs = join(ctx.testDir, 'migrations/app/refs');
    mkdirSync(refs, { recursive: true });
    writeFileSync(
      join(refs, 'production.json'),
      JSON.stringify({ hash: manifest.to, invariants: [], policies: { change: ['migrate'] } }),
    );
    const recorded = await runMigrate(ctx, [
      '--to',
      'production',
      '--permit-policy-change',
      '--json',
    ]);
    expect(recorded.exitCode, `L2.03: ${recorded.stderr}`).toBe(0);
    await useSchema(journey, noteAndItemsPsl, 'L2.04');
    const second = await runMigrationPlan(ctx, ['--name', 'items', '--json']);
    expect(second.exitCode, `L2.05: ${second.stderr}`).toBe(0);
    withoutCreateAfterCheck(join(ctx.testDir, 'migrations/app', latestMigrationDirName(ctx)));
    await db.createCollection('items');
    await db.collection('items').insertOne({ t: 'keep' });

    const stopped = await runMigrate(ctx, ['--json']);
    const advice = engineError(stopped)?.why;

    expect({
      stopped: stopped.exitCode,
      advice,
      items: await documents(db, 'items'),
    }).toEqual({
      stopped: 2,
      advice: expect.stringContaining(
        "If items holds nothing you need, drop it, then run the command again; operations that already ran are skipped. This database's change policy permits only migrations, so it cannot be signed past this create by hand. When neither of those two ways applies, this database's change policy permits no recovery for this create.",
      ),
      items: [{ t: 'keep' }],
    });
    expect(advice).not.toMatch(/db sign|permit-policy-change|reconcile/);
  });
});
