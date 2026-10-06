import mongoAdapter, { MongoControlAdapterImpl } from '@internal/adapter-mongo/control';
import { MongoControlDriver } from '@internal/driver-mongo/control';
import { mongoFamilyDescriptor } from '@internal/family-mongo/control';
import { createControlStack } from '@internal/framework-components/control';
import { buildFabricatedMigrationEdge } from '@internal/migration-tools/aggregate';
import type { MongoContract } from '@internal/mongo-contract';
import { interpretPslDocumentToMongoContract } from '@internal/mongo-contract-psl';
import { mongoContextInput } from '@internal/mongo-contract-psl/test';
import { MongoSchemaIR } from '@internal/mongo-schema-ir';
import { withSeedDiagnostics } from '@internal/psl-parser/interpret';
import { bindPslSchema, contractSourceContextFromControlStack } from '@internal/psl-parser/test';
import {
  MongoMigrationPlanner,
  MongoMigrationRunner,
  mongoTargetDescriptor,
} from '@internal/target-mongo/control';
import { timeouts } from '@repo/test-utils';
import { type Db, MongoClient, MongoServerError } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const schema = `
  type Entry {
    value String
  }

  model Lists {
    id ObjectId @id @map("_id")
    strings String[]
    nullableStrings String?[]
    optionalStrings String[]?
    optionalNullableStrings String?[]?
    entries Entry[]
    nullableEntries Entry?[]
    optionalEntries Entry[]?
    optionalNullableEntries Entry?[]?

    @@map("lists")
  }
`;

let replSet: MongoMemoryReplSet;
let client: MongoClient;
let db: Db;

beforeAll(async () => {
  const stack = createControlStack({
    family: mongoFamilyDescriptor,
    target: mongoTargetDescriptor,
    adapter: mongoAdapter,
  });
  const bound = bindPslSchema(schema, {
    sourceId: 'nullable-lists.prisma',
    context: contractSourceContextFromControlStack(stack),
  });
  const interpreted = withSeedDiagnostics(
    interpretPslDocumentToMongoContract({
      documents: bound.documents,
      symbolTable: bound.symbolTable,
      sources: bound.sources,
      binder: bound.binder,
      ...mongoContextInput(bound.context),
    }),
    bound.seedDiagnostics,
  );
  if (!interpreted.ok) {
    throw new Error(JSON.stringify(interpreted.failure));
  }
  const contract = interpreted.value as unknown as MongoContract;
  const planned = new MongoMigrationPlanner().plan({
    contract,
    schema: new MongoSchemaIR([]),
    policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
    fromContract: null,
    frameworkComponents: [],
    snapshotsImportPath: '../../snapshots',
  });
  if (planned.kind !== 'success') {
    throw new Error(JSON.stringify(planned));
  }

  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  client = new MongoClient(replSet.getUri());
  await client.connect();
  db = client.db('runner_nullable_lists_test');
  const runner = new MongoMigrationRunner(
    new MongoControlAdapterImpl().createRunnerDependencies(new MongoControlDriver(db, client)),
  );
  const { plan } = planned;
  const applied = await runner.execute({
    plan,
    migrationEdges: [
      buildFabricatedMigrationEdge({
        currentMarkerStorageHash: plan.origin?.storageHash,
        destinationStorageHash: plan.destination.storageHash,
        operationCount: plan.operations.length,
      }),
    ],
    destinationContract: contract,
    policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
    frameworkComponents: [],
  });
  expect(applied.ok).toBe(true);
}, timeouts.spinUpMongoMemoryServer);

afterAll(async () => {
  await client?.close();
  await replSet?.stop();
}, timeouts.spinUpMongoMemoryServer);

beforeEach(async () => {
  await db.collection('lists').deleteMany({});
});

const fields = [
  { field: 'strings', nullable: false, elementNullable: false, item: 'value' },
  { field: 'nullableStrings', nullable: false, elementNullable: true, item: 'value' },
  { field: 'optionalStrings', nullable: true, elementNullable: false, item: 'value' },
  { field: 'optionalNullableStrings', nullable: true, elementNullable: true, item: 'value' },
  { field: 'entries', nullable: false, elementNullable: false, item: { value: 'value' } },
  { field: 'nullableEntries', nullable: false, elementNullable: true, item: { value: 'value' } },
  { field: 'optionalEntries', nullable: true, elementNullable: false, item: { value: 'value' } },
  {
    field: 'optionalNullableEntries',
    nullable: true,
    elementNullable: true,
    item: { value: 'value' },
  },
];

const baseline = Object.fromEntries(fields.map(({ field }) => [field, []]));

async function expectValidationFailure(operation: Promise<unknown>) {
  await expect(operation).rejects.toBeInstanceOf(MongoServerError);
  await expect(operation).rejects.toMatchObject({ code: 121 });
}

describe.each(fields)(
  'Mongo nullable list validator: $field',
  ({ field, nullable, elementNullable, item }) => {
    it.each([
      { name: 'empty list', value: [], accepted: true, omitted: false },
      { name: 'nonempty list', value: [item], accepted: true, omitted: false },
      { name: 'null item', value: [item, null], accepted: elementNullable, omitted: false },
      { name: 'explicit null', value: null, accepted: nullable, omitted: false },
      { name: 'omitted field', value: undefined, accepted: nullable, omitted: true },
      { name: 'non-array container', value: 42, accepted: false, omitted: false },
      { name: 'wrong item type', value: [42], accepted: false, omitted: false },
    ])('$name on insert and update', async ({ value, accepted, omitted }) => {
      const collection = db.collection('lists');
      const document: Record<string, unknown> = { ...baseline };
      if (omitted) {
        delete document[field];
      } else {
        document[field] = value;
      }
      const readAll = () => collection.find({}, { projection: { _id: 0 } }).toArray();

      const insert = collection.insertOne({ ...document });
      if (accepted) {
        await insert;
        expect(await readAll()).toEqual([document]);
        await collection.deleteMany({});
      } else {
        await expectValidationFailure(insert);
        expect(await readAll()).toEqual([]);
      }

      const { insertedId } = await collection.insertOne({ ...baseline });
      const update = collection.updateOne(
        { _id: insertedId },
        omitted ? { $unset: { [field]: '' } } : { $set: { [field]: value } },
      );
      if (accepted) {
        await update;
        expect(await readAll()).toEqual([document]);
      } else {
        await expectValidationFailure(update);
        expect(await readAll()).toEqual([baseline]);
      }
    });
  },
);
