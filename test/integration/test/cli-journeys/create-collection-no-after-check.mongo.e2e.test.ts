/**
 * Journey (MongoDB): a migration emitted before a create had an after-check stops at a collection
 * that already exists, and both routes that keep its documents are followed to the end: applying
 * the operations that did not run by hand and signing with `db sign`, and, on a database whose
 * change policy permits only migrations, the steps of "Moving a MongoDB collection aside" in the
 * error reference, also for a collection an earlier run created and moved documents into.
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
  runDbVerify,
  runMigrate,
  runMigrationPlan,
  runMigrationStatus,
  selfEmitMigration,
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

/** Notes, and items whose title is unique and stored under `key`. */
function noteAndUniqueItemsPsl(key: string): string {
  return `${notePsl}
model Item {
  id    ObjectId @id @map("_id")
  title String   @unique @map("${key}")

  @@map("items")
}
`;
}

interface Operation {
  readonly id: string;
  readonly label: string;
  readonly operationClass: 'additive' | 'widening' | 'destructive' | 'data';
  postcheck: readonly unknown[];
  readonly execute: readonly { readonly command: Record<string, unknown> }[];
}

/** Empties the after-check of the migration's create of `collection`, as migrations emitted before this release have it, and attests the migration again. */
function withoutCreateAfterCheck(dir: string, collection = 'items'): Operation {
  const ops: Operation[] = JSON.parse(readFileSync(join(dir, 'ops.json'), 'utf-8'));
  const create = ops.find(({ id }) => id === `collection.${collection}.create`);
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

const legacyPsl = `// use prisma-8

model LegacyOrder {
  id   ObjectId @id @map("_id")
  code String   @map("c")

  @@map("legacy")
}
`;

/** Legacy orders, and orders whose code is stored under `c`, unique when `unique` is set. */
function legacyAndOrdersPsl(unique: boolean): string {
  return `${legacyPsl}
model Order {
  id   ObjectId @id @map("_id")
  code String   ${unique ? '@unique ' : ''}@map("c")

  @@map("orders")
}
`;
}

/** Adds, before the other operations of a `migration.ts`, a move of every document of `from` into `to`: a copy, then a delete from `from`. */
function withMoveFirst(text: string, from: string, to: string): string {
  const imported = text.replace(
    /import \{([^}]*)\} from '([^']*migration)';/,
    (_, names: string, module: string) =>
      `import { ${names.trim().replace(/,$/, '')}, dataTransform, deleteDocuments, rawAggregate } from '${module}';`,
  );
  const start = imported.indexOf('return [') + 'return ['.length;
  const move = `\n      dataTransform('move documents to ${to}', { run: () => rawAggregate('${from}', [{ $match: {} }, { $merge: { into: '${to}' } }]) }),\n      deleteDocuments({ collection: '${from}', filter: {} }),`;
  return `${imported.slice(0, start)}${move}${imported.slice(start)}`;
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
        "Or, without moving the documents, leave the migration as it is, apply the operations of this migration that did not run by hand, then run db sign with the name of this migration's directory. db sign checks the collections, their validators and their indexes against the contract this migration leads to, not the documents, so first check yourself that the documents are as the operations you applied leave them. It then records the database at that contract, so the next run starts after this migration. migration status then shows the database as up to date, but does not mark this migration as applied, since no run of it is recorded.",
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

  it('L2: on a database whose change policy permits only migrations, the collection is moved aside, db migrate --to runs only this migration, a copy back the unique index stops keeps the documents, and the next db migrate renames the field of the copied documents', async () => {
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
    await useSchema(journey, noteAndUniqueItemsPsl('t'), 'L2.04');
    const second = await runMigrationPlan(ctx, ['--name', 'items', '--json']);
    expect(second.exitCode, `L2.05: ${second.stderr}`).toBe(0);
    const itemsMigration = latestMigrationDirName(ctx);
    withoutCreateAfterCheck(join(ctx.testDir, 'migrations/app', itemsMigration));
    await useSchema(journey, noteAndUniqueItemsPsl('name'), 'L2.06');
    const third = await runMigrationPlan(ctx, [
      '--name',
      'rename_title',
      '--from',
      itemsMigration,
      '--json',
    ]);
    expect(third.exitCode, `L2.07: ${third.stderr}`).toBe(0);
    await db.createCollection('items');
    await db.collection('items').insertMany([{ t: 'keep' }, { t: 'keep' }]);

    const stopped = await runMigrate(ctx, ['--json']);
    const advice = engineError(stopped)?.why;
    await db.collection('items').rename('items_kept');
    const migratedTo = await runMigrate(ctx, ['--to', itemsMigration, '--json']);
    const duplicates = await db
      .collection('items_kept')
      .aggregate([{ $group: { _id: '$t', n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }])
      .toArray();
    const stoppedCopy = await db
      .collection('items_kept')
      .aggregate([{ $merge: { into: 'items', whenMatched: 'fail' } }])
      .toArray()
      .then(
        () => 'copied',
        (error: { codeName?: string }) => error.codeName,
      );
    const afterStoppedCopy = {
      items: await db.collection('items').countDocuments(),
      kept: await db.collection('items_kept').countDocuments(),
    };
    const copiedIds = (await db.collection('items').find().toArray()).map(({ _id }) => _id);
    await db
      .collection('items_kept')
      .updateOne({ _id: { $nin: copiedIds } }, { $set: { t: 'keep 2' } });
    await db
      .collection('items_kept')
      .aggregate([{ $merge: { into: 'items', whenMatched: 'keepExisting' } }])
      .toArray();
    const afterCopy = {
      items: await db.collection('items').countDocuments(),
      kept: await db.collection('items_kept').countDocuments(),
    };
    await db.collection('items_kept').drop();
    const migrated = await runMigrate(ctx, ['--json']);
    const status = parseJsonOutput<{
      readonly summary: string;
      readonly spaces: readonly { readonly migrations: readonly { readonly status: unknown }[] }[];
    }>(await runMigrationStatus(ctx, ['--json']));
    const verified = await runDbVerify(ctx, ['--json']);

    expect({
      stopped: stopped.exitCode,
      advice,
      migratedTo: migratedTo.exitCode,
      duplicates,
      stoppedCopy,
      afterStoppedCopy,
      afterCopy,
      migrated: migrated.exitCode,
      status: {
        summary: status.summary,
        marks: status.spaces[0]?.migrations.map((migration) => migration.status),
      },
      verified: verified.exitCode,
      collections: (await db.listCollections({}, { nameOnly: true }).toArray())
        .map(({ name }) => name)
        .filter((collection) => !collection.startsWith('_prisma'))
        .sort(),
      items: (await documents(db, 'items')).map(({ name }) => name).sort(),
    }).toEqual({
      stopped: 2,
      advice: expect.stringContaining(
        `If items holds nothing you need, drop it, then run the command that stopped again, as you ran it; operations that already ran are skipped. This holds also if an earlier run of this command created items: an operation of that run may have moved documents into it from a collection it then deleted them from, and those documents are only in items. If items holds documents you need, you can keep them by moving the collection aside: stop the application's writes to it until every step is done, move it to items_kept, run db migrate --to ${itemsMigration} so this migration creates items with its options, apply to the documents in items_kept the changes that the operations after the create make, and copy them back. Follow every step under "Moving a MongoDB collection aside" in the error reference for MIGRATION.PRECHECK_FAILED, which keep the documents until the copy back is checked.`,
      ),
      migratedTo: 0,
      duplicates: [{ _id: 'keep', n: 2 }],
      stoppedCopy: 'DuplicateKey',
      afterStoppedCopy: { items: 1, kept: 2 },
      afterCopy: { items: 2, kept: 2 },
      migrated: 0,
      status: { summary: 'Up to date', marks: ['applied', 'applied', 'applied'] },
      verified: 0,
      collections: ['items', 'notes'],
      items: ['keep', 'keep 2'],
    });
    expect(advice).not.toMatch(/db sign|permit-policy-change|reconcile|policy/);
  });
  it('L3: a collection an earlier run created holds documents that run moved from a collection it then emptied, and moving it aside keeps every one of them', async () => {
    const journey = project('l3_moved_in');
    const { ctx, db } = journey;
    await useSchema(journey, legacyPsl, 'L3.01');
    const first = await runMigrationPlan(ctx, ['--name', 'legacy', '--json']);
    expect(first.exitCode, `L3.02: ${first.stderr}`).toBe(0);
    const recorded = await runMigrate(ctx, ['--json']);
    expect(recorded.exitCode, `L3.03: ${recorded.stderr}`).toBe(0);
    await db.collection('legacy').insertMany([{ c: 'a' }, { c: 'a' }, { c: 'b' }]);
    await useSchema(journey, legacyAndOrdersPsl(false), 'L3.04');
    const second = await runMigrationPlan(ctx, ['--name', 'orders', '--json']);
    expect(second.exitCode, `L3.05: ${second.stderr}`).toBe(0);
    const ordersMigration = latestMigrationDirName(ctx);
    withoutCreateAfterCheck(join(ctx.testDir, 'migrations/app', ordersMigration), 'orders');
    await useSchema(journey, legacyAndOrdersPsl(true), 'L3.06');
    const third = await runMigrationPlan(ctx, [
      '--name',
      'unique_code',
      '--from',
      ordersMigration,
      '--json',
    ]);
    expect(third.exitCode, `L3.07: ${third.stderr}`).toBe(0);
    const moveDir = join(ctx.testDir, 'migrations/app', latestMigrationDirName(ctx));
    const moveTs = join(moveDir, 'migration.ts');
    writeFileSync(moveTs, withMoveFirst(readFileSync(moveTs, 'utf-8'), 'legacy', 'orders'));
    const emitted = await selfEmitMigration(ctx, ['--dir', moveDir]);
    expect(emitted.exitCode, `L3.08: ${emitted.stdout}${emitted.stderr}`).toBe(0);

    const stoppedAtIndex = await runMigrate(ctx, ['--json']);
    const moved = {
      legacy: await db.collection('legacy').countDocuments(),
      orders: await db.collection('orders').countDocuments(),
    };
    await db.collection('orders').updateOne({ c: 'a' }, { $set: { c: 'a2' } });
    const stoppedAtCreate = await runMigrate(ctx, ['--json']);
    const advice = engineError(stoppedAtCreate)?.why;
    await db.collection('orders').rename('orders_kept');
    const migratedTo = await runMigrate(ctx, ['--to', ordersMigration, '--json']);
    const writtenAgain = await db
      .collection('orders_kept')
      .aggregate([
        { $lookup: { from: 'orders', localField: '_id', foreignField: '_id', as: 'written' } },
        { $match: { written: { $ne: [] } } },
        { $project: { _id: 1 } },
      ])
      .toArray();
    await db.command({ collMod: 'orders_kept', validator: {} });
    await db
      .collection('orders_kept')
      .aggregate([{ $merge: { into: 'orders', whenMatched: 'fail' } }])
      .toArray();
    const notCopied = await db
      .collection('orders_kept')
      .aggregate([
        { $lookup: { from: 'orders', localField: '_id', foreignField: '_id', as: 'written' } },
        { $match: { written: [] } },
        { $project: { _id: 1 } },
      ])
      .toArray();
    await db.collection('orders_kept').drop();
    const migrated = await runMigrate(ctx, ['--json']);
    const status = parseJsonOutput<{
      readonly spaces: readonly { readonly migrations: readonly { readonly status: unknown }[] }[];
    }>(await runMigrationStatus(ctx, ['--json']));
    const verified = await runDbVerify(ctx, ['--json']);

    expect({
      stoppedAtIndex: stoppedAtIndex.exitCode,
      moved,
      stoppedAtCreate: engineError(stoppedAtCreate)?.summary,
      migratedTo: migratedTo.exitCode,
      writtenAgain,
      notCopied,
      migrated: migrated.exitCode,
      marks: status.spaces[0]?.migrations.map((migration) => migration.status),
      verified: verified.exitCode,
      legacy: await documents(db, 'legacy'),
      orders: (await documents(db, 'orders')).map(({ c }) => c).sort(),
    }).toEqual({
      stoppedAtIndex: 2,
      moved: { legacy: 0, orders: 3 },
      stoppedAtCreate:
        "Operation collection.orders.create stopped: collection orders already exists, and this migration's create has no after-check that lets a run skip it",
      migratedTo: 0,
      writtenAgain: [],
      notCopied: [],
      migrated: 0,
      marks: ['applied', 'applied', 'applied'],
      verified: 0,
      legacy: [],
      orders: ['a', 'a2', 'b'],
    });
    expect(advice).toContain(
      'This holds also if an earlier run of this command created orders: an operation of that run may have moved documents into it from a collection it then deleted them from, and those documents are only in orders.',
    );
    expect(advice).not.toMatch(/writes them again|so drop it/);
  });
});
