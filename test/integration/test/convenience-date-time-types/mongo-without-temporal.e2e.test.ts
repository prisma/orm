/**
 * Journey: a MongoDB schema written with the convenience date and time types, run with no global `Temporal`. `contract emit`, `db init` and `db verify` run as child processes with no `Temporal`, through the fallback the MongoDB target's control entry sets. An application with no `Temporal` then writes and reads the default types: `DateTime` reads a JavaScript `Date`, and `Date`, `Time` and `Duration` read strings. The client generates `now()` values for them in that process, and no process gains a global `Temporal`. Reading a Temporal type in that application raises `RUNTIME.TEMPORAL_UNAVAILABLE`, and reading a calendar date stored at another time than midnight UTC raises `RUNTIME.DECODE_FAILED`, naming the field.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { timeouts } from '@repo/test-utils';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { join, resolve } from 'pathe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixtureAppDir, writeProjectManifest } from '../utils/cli-test-helpers';
import { writeMongoPslConfig } from '../utils/journey-workspace-helpers';
import {
  type ChildRun,
  childOutput,
  NO_GLOBAL_TEMPORAL,
  runNodeWithoutTemporal,
} from '../utils/node-without-temporal';

const BIN_PATH = resolve(
  import.meta.dirname,
  '../../../../packages/1-framework/3-tooling/cli/dist/bin.mjs',
);

const SCHEMA = `// use prisma-8

model Event {
  id         ObjectId               @id @map("_id")
  label      String
  at         DateTime
  textAt     DateTime(as: string)
  day        Date
  opensAt    Time
  lasts      Duration
  createdDay Date                   @onCreate(now())
  clock      Time                   @onCreate(now())
  updatedAt  DateTime               @onCreate(now()) @onUpdate(now())
  settledAt  DateTime(as: temporal)?

  @@map("events")
}
`;

const APP_SCRIPT = `
import { readFileSync } from 'node:fs';

const { default: mongo } = await import('@internal/mongo/runtime');
const { contractFromJson } = await import('@internal/mongo/static');
const db = mongo({
  contract: contractFromJson(JSON.parse(readFileSync('output/contract.json', 'utf8'))),
  url: process.env.JOURNEY_DB_URL,
});
const described = (row) =>
  Object.fromEntries(
    Object.entries(row)
      .filter(([name]) => name !== 'id' && name !== 'settledAt')
      .map(([name, value]) => [
        name,
        value instanceof Date
          ? { kind: 'Date', value: value.toISOString() }
          : { kind: value === null ? 'null' : typeof value, value },
      ]),
  );
try {
  const events = db.orm.events;
  if (process.env.JOURNEY_STEP === 'read-temporal') {
    let temporalRead;
    try {
      await events.where({ label: 'a' }).first();
      temporalRead = 'read';
    } catch (error) {
      temporalRead = error.code;
    }
    process.stdout.write(JSON.stringify({ temporalRead }));
    process.exit(0);
  }
  if (process.env.JOURNEY_STEP === 'read-calendar') {
    let calendarRead;
    try {
      await events.where({ label: 'b' }).first();
      calendarRead = 'read';
    } catch (error) {
      calendarRead = { code: error.code, message: error.message };
    }
    process.stdout.write(JSON.stringify({ calendarRead }));
    process.exit(0);
  }
  await events.create({
    label: 'a',
    at: new Date('2024-02-29T10:00:00.123Z'),
    textAt: '2024-02-29T15:30:00+05:30',
    day: '2024-02-29',
    opensAt: '09:30',
    lasts: 'PT1H30M',
    settledAt: null,
  });
  const read = await events.where({ label: 'a' }).first();
  process.stdout.write(JSON.stringify({ row: described(read) }));
} finally {
  await db.close();
}
`;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIME = /^\d{2}:\d{2}:\d{2}\.\d{3}$/;

describe('Journey: the MongoDB convenience date and time types in processes with no Temporal', {
  timeout: timeouts.spinUpMongoMemoryServer,
}, () => {
  let replSet: MongoMemoryReplSet;
  const created: string[] = [];

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      instanceOpts: [
        { launchTimeout: timeouts.spinUpMongoMemoryServer, storageEngine: 'wiredTiger' },
      ],
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
  }, timeouts.spinUpMongoMemoryServer);

  afterAll(async () => {
    for (const dir of created.splice(0)) await rm(dir, { recursive: true, force: true });
    await replSet?.stop().catch(() => {});
  }, timeouts.spinUpMongoMemoryServer);

  function setupProject(): { readonly testDir: string; readonly dbUrl: string } {
    const testDir = join(
      fixtureAppDir,
      `test-mongo-without-temporal-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    created.push(testDir);
    mkdirSync(join(testDir, 'output'), { recursive: true });
    writeProjectManifest(testDir);
    const url = new URL(replSet.getUri());
    url.pathname = '/without_temporal';
    const dbUrl = url.toString();
    writeMongoPslConfig(testDir, dbUrl);
    writeFileSync(join(testDir, 'contract.prisma'), SCHEMA, 'utf-8');
    return { testDir, dbUrl };
  }

  const runBin = (testDir: string, argv: readonly string[]): Promise<ChildRun> =>
    runNodeWithoutTemporal([BIN_PATH, ...argv], { cwd: testDir });

  it('emit, create and verify the collections, and an application reads the default types', async () => {
    const { testDir, dbUrl } = setupProject();

    const emit = await runBin(testDir, ['contract', 'emit']);
    expect(emit, childOutput(emit)).toMatchObject({ exitCode: 0, ...NO_GLOBAL_TEMPORAL });
    const fields = JSON.parse(readFileSync(join(testDir, 'output/contract.json'), 'utf-8')).domain
      .namespaces.__unbound__.models.Event.fields;
    expect(fields.settledAt.type.codecId).toBe('mongo/date-instant@1');

    const init = await runBin(testDir, ['db', 'init']);
    expect(init, childOutput(init)).toMatchObject({ exitCode: 0, ...NO_GLOBAL_TEMPORAL });
    const verify = await runBin(testDir, ['db', 'verify', '--schema-only', '--json']);
    expect(verify, childOutput(verify)).toMatchObject({ exitCode: 0, ...NO_GLOBAL_TEMPORAL });

    const script = join(testDir, 'app.mjs');
    writeFileSync(script, APP_SCRIPT, 'utf-8');
    const before = Date.now();
    const run = await runNodeWithoutTemporal([script], {
      cwd: testDir,
      env: { JOURNEY_DB_URL: dbUrl },
    });
    const after = Date.now();
    expect(run, childOutput(run)).toMatchObject({ exitCode: 0, ...NO_GLOBAL_TEMPORAL });

    const client = new MongoClient(dbUrl);
    try {
      const collection = client.db().collection('events');
      const { _id: _ignored, ...written } = (await collection.findOne({ label: 'a' })) ?? {};
      await collection.insertOne({
        ...written,
        label: 'b',
        day: new Date('2024-02-29T09:30:00.000Z'),
      });
      await collection.updateOne(
        { label: 'a' },
        { $set: { settledAt: new Date('2024-02-29T10:00:00.000Z') } },
      );
    } finally {
      await client.close();
    }
    const readCalendar = await runNodeWithoutTemporal([script], {
      cwd: testDir,
      env: { JOURNEY_DB_URL: dbUrl, JOURNEY_STEP: 'read-calendar' },
    });
    expect(readCalendar, childOutput(readCalendar)).toMatchObject({
      exitCode: 0,
      ...NO_GLOBAL_TEMPORAL,
    });
    const readTemporal = await runNodeWithoutTemporal([script], {
      cwd: testDir,
      env: { JOURNEY_DB_URL: dbUrl, JOURNEY_STEP: 'read-temporal' },
    });
    expect(readTemporal, childOutput(readTemporal)).toMatchObject({
      exitCode: 0,
      ...NO_GLOBAL_TEMPORAL,
    });

    const { row } = JSON.parse(run.stdout);
    const { temporalRead } = JSON.parse(readTemporal.stdout);
    const { calendarRead } = JSON.parse(readCalendar.stdout);
    expect({ row, temporalRead, calendarRead }).toEqual({
      row: {
        label: { kind: 'string', value: 'a' },
        at: { kind: 'Date', value: '2024-02-29T10:00:00.123Z' },
        textAt: { kind: 'string', value: '2024-02-29T10:00:00.000Z' },
        day: { kind: 'string', value: '2024-02-29' },
        opensAt: { kind: 'string', value: '09:30:00.000' },
        lasts: { kind: 'string', value: 'PT1H30M' },
        createdDay: { kind: 'string', value: expect.stringMatching(ISO_DATE) },
        clock: { kind: 'string', value: expect.stringMatching(ISO_TIME) },
        updatedAt: { kind: 'Date', value: expect.any(String) },
      },
      temporalRead: 'RUNTIME.TEMPORAL_UNAVAILABLE',
      calendarRead: {
        code: 'RUNTIME.DECODE_FAILED',
        message: expect.stringMatching(
          /^Failed to decode field day of the document with _id \w+ in collection 'events' with codec 'mongo\/date-string@1': Codec 'mongo\/date-string@1' cannot read 2024-02-29T09:30:00.000Z: a calendar date is stored as a BSON date at midnight UTC\./,
        ),
      },
    });
    const updatedAt = new Date(row.updatedAt.value).getTime();
    expect(updatedAt).toBeGreaterThanOrEqual(before);
    expect(updatedAt).toBeLessThanOrEqual(after);
  });
});
