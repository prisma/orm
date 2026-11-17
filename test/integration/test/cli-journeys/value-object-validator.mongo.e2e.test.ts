/**
 * A value object change updates the MongoDB collection validator, now that value objects are storage entities.
 *
 * `User.address` holds an `Address` subdocument, and the `users` validator lists its members. Adding `zip` to `Address` changes the storage hash and the validator. Journey M1 plans the change with `migration plan` and applies it with `migrate`; journey M2 applies it with `db update`. Each ends with `db verify` clean and a further plan empty.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { timeouts } from '@repo/test-utils';
import { type Db, MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { fixtureAppDir, writeProjectManifest } from '../utils/cli-test-helpers';
import {
  getMigrationDirs,
  type JourneyContext,
  latestMigrationDirName,
  parseJsonOutput,
  readEmittedContractStorageHash,
  runContractEmit,
  runDbUpdate,
  runDbVerify,
  runMigrate,
  runMigrationPlan,
} from '../utils/journey-test-helpers';
import { writeMongoPslConfig } from '../utils/journey-workspace-helpers';

function contractWith(addressMembers: string): string {
  return `// use prisma-8

type Address {
${addressMembers}}

model User {
  id      ObjectId @id @map("_id")
  address Address?
  @@map("users")
}
`;
}

const ADDRESS = contractWith('  street String\n  city   String\n');
const ADDRESS_WITH_ZIP = contractWith('  street String\n  city   String\n  zip    String?\n');

function withDatabase(baseUri: string, dbName: string): string {
  const url = new URL(baseUri);
  url.pathname = `/${dbName}`;
  return url.toString();
}

function setupProject(connectionString: string): JourneyContext {
  const testDir = join(
    fixtureAppDir,
    `test-mongo-value-object-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const outputDir = join(testDir, 'output');
  mkdirSync(outputDir, { recursive: true });
  mkdirSync(join(testDir, 'migrations'), { recursive: true });
  writeProjectManifest(testDir);
  const configPath = writeMongoPslConfig(testDir, connectionString);
  return { testDir, configPath, outputDir };
}

async function emit(ctx: JourneyContext, psl: string, label: string): Promise<void> {
  writeFileSync(join(ctx.testDir, 'contract.prisma'), psl, 'utf-8');
  const emitted = await runContractEmit(ctx);
  expect(emitted.exitCode, `${label}: emit: ${emitted.stderr}`).toBe(0);
}

interface AddressSchema {
  readonly properties?: Record<string, unknown>;
  readonly required?: readonly string[];
}

/** The members the `users` validator lists for `address`, and which of them it requires. */
async function addressInValidator(db: Db): Promise<{ members: string[]; required: string[] }> {
  const [collection] = await db.listCollections({ name: 'users' }).toArray();
  const schema = (
    collection as {
      options?: { validator?: { $jsonSchema?: { properties?: Record<string, unknown> } } };
    }
  )?.options?.validator?.$jsonSchema?.properties?.['address'];
  const objectSchemas = [schema, ...((schema as { oneOf?: unknown[] })?.oneOf ?? [])].filter(
    (entry): entry is AddressSchema =>
      typeof entry === 'object' && entry !== null && 'properties' in entry,
  );
  const [object] = objectSchemas;
  return {
    members: Object.keys(object?.properties ?? {}).sort(),
    required: [...(object?.required ?? [])].sort(),
  };
}

async function markerHash(db: Db): Promise<unknown> {
  const marker = await db
    .collection('_prisma_migrations')
    .findOne({ space: 'app', storageHash: { $exists: true } });
  return marker?.['storageHash'];
}

describe('Journeys (MongoDB): a value object change updates the collection validator', {
  timeout: timeouts.spinUpMongoMemoryServer,
}, () => {
  let replSet: MongoMemoryReplSet;
  let client: MongoClient;
  const created = new Set<string>();

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      instanceOpts: [
        { launchTimeout: timeouts.spinUpMongoMemoryServer, storageEngine: 'wiredTiger' },
      ],
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    client = new MongoClient(replSet.getUri());
    await client.connect();
  }, timeouts.spinUpMongoMemoryServer);

  afterEach(async () => {
    for (const dir of created) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    created.clear();
  });

  afterAll(async () => {
    await client?.close().catch(() => {});
    await replSet?.stop().catch(() => {});
  }, timeouts.spinUpMongoMemoryServer);

  it('M1: migration plan and migrate add the member to the validator', async () => {
    const dbName = 'mongo_value_object_plan';
    const db = client.db(dbName);
    const ctx = setupProject(withDatabase(replSet.getUri(), dbName));
    created.add(ctx.testDir);
    await emit(ctx, ADDRESS, 'M1.01');
    const initial = await runMigrationPlan(ctx, ['--name', 'initial']);
    expect(initial.exitCode, `M1.02: plan initial: ${initial.stderr}`).toBe(0);
    expect((await runMigrate(ctx)).exitCode, 'M1.02: migrate initial').toBe(0);
    expect(await addressInValidator(db), 'M1.02: the validator').toEqual({
      members: ['city', 'street'],
      required: ['city', 'street'],
    });
    await db.collection('users').insertOne({ address: { street: 'Main St', city: 'Oslo' } });
    const origin = latestMigrationDirName(ctx);

    await emit(ctx, ADDRESS_WITH_ZIP, 'M1.03');
    const plan = await runMigrationPlan(ctx, ['--from', origin, '--name', 'zip', '--json']);
    expect(plan.exitCode, `M1.04: plan: ${plan.stderr}`).toBe(0);
    expect(
      parseJsonOutput<{ operations: readonly { label: string }[] }>(plan).operations.map(
        ({ label }) => label,
      ),
      'M1.04: the validator is updated',
    ).toEqual([expect.stringContaining('validator')]);
    const migrate = await runMigrate(ctx);
    expect(migrate.exitCode, `M1.05: migrate: ${migrate.stderr}`).toBe(0);

    expect(await addressInValidator(db), 'M1.05: the validator lists zip').toEqual({
      members: ['city', 'street', 'zip'],
      required: ['city', 'street'],
    });
    expect(await markerHash(db), 'M1.05: the marker').toBe(readEmittedContractStorageHash(ctx));
    await db
      .collection('users')
      .insertOne({ address: { street: 'Elm St', city: 'Bergen', zip: '5003' } });
    const verify = await runDbVerify(ctx);
    expect(verify.exitCode, `M1.06: db verify: ${verify.stderr}`).toBe(0);
    const count = getMigrationDirs(ctx).length;
    const fresh = await runMigrationPlan(ctx, ['--from', latestMigrationDirName(ctx), '--json']);
    expect(parseJsonOutput<{ noOp: boolean }>(fresh).noOp, 'M1.07: plan is empty').toBe(true);
    expect(getMigrationDirs(ctx), 'M1.07: nothing written').toHaveLength(count);
  });

  it('M2: db update adds the member to the validator', async () => {
    const dbName = 'mongo_value_object_update';
    const db = client.db(dbName);
    const ctx = setupProject(withDatabase(replSet.getUri(), dbName));
    created.add(ctx.testDir);
    await emit(ctx, ADDRESS, 'M2.01');
    const initial = await runDbUpdate(ctx);
    expect(initial.exitCode, `M2.02: db update initial: ${initial.stderr}`).toBe(0);
    await db.collection('users').insertOne({ address: { street: 'Main St', city: 'Oslo' } });

    await emit(ctx, ADDRESS_WITH_ZIP, 'M2.03');
    const update = await runDbUpdate(ctx, ['--json']);
    expect(update.exitCode, `M2.04: db update: ${update.stderr}`).toBe(0);
    expect(await addressInValidator(db), 'M2.04: the validator lists zip').toEqual({
      members: ['city', 'street', 'zip'],
      required: ['city', 'street'],
    });
    expect(await markerHash(db), 'M2.04: the marker').toBe(readEmittedContractStorageHash(ctx));
    const verify = await runDbVerify(ctx);
    expect(verify.exitCode, `M2.05: db verify: ${verify.stderr}`).toBe(0);
    const dryRun = await runDbUpdate(ctx, ['--dry-run', '--json']);
    expect(
      parseJsonOutput<{ plan: { operations: readonly unknown[] } }>(dryRun).plan.operations,
      'M2.06: nothing left to plan',
    ).toEqual([]);
  });
});
