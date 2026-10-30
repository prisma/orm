import mongoRuntimeAdapter from '@internal/adapter-mongo/runtime';
import mongoRuntimeDriver from '@internal/driver-mongo/runtime';
import type {
  AnyMongoTypeMaps,
  MongoContract,
  MongoContractWithTypeMaps,
} from '@internal/mongo-contract';
import type { MongoExecutionContext } from '@internal/mongo-query-ast/execution';
import { MongoFieldFilter, type MongoFilterExpr } from '@internal/mongo-query-ast/execution';
import {
  createMongoExecutionContext,
  createMongoExecutionStack,
  createMongoRuntime,
  type MongoRuntime,
} from '@internal/mongo-runtime';
import mongoRuntimeTarget from '@internal/target-mongo/runtime';
import { timeouts } from '@repo/test-utils';
import { MongoClient, ObjectId } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FieldExpression, FieldOperation } from '../../src/field-accessor';
import { mongoOrm } from '../../src/mongo-orm';

const objectId = { kind: 'scalar', codecId: 'mongo/objectId@1' } as const;
const text = { kind: 'scalar', codecId: 'mongo/string@1' } as const;

function valueObjectRef(entityName: string) {
  return {
    kind: 'valueObject',
    plane: 'storage',
    namespaceId: '__unbound__',
    entityKind: 'valueObject',
    entityName,
  };
}

const contractJson = {
  target: 'mongo',
  targetFamily: 'mongo',
  storageHash: 'value-objects-hash',
  roots: { places: { model: 'Place', namespace: '__unbound__' } },
  storage: {
    namespaces: {
      __unbound__: {
        id: '__unbound__',
        entries: {
          collection: { places: {} },
          valueObject: {
            Stop: {
              fields: {
                label: { type: text, nullable: false, many: false },
                placeId: { type: objectId, nullable: false, many: false },
              },
            },
            Address: {
              fields: {
                city: { type: text, nullable: false, many: false },
                landmark: { type: valueObjectRef('Stop'), nullable: false, many: false },
              },
            },
          },
        },
      },
    },
  },
  domain: {
    namespaces: {
      __unbound__: {
        models: {
          Place: {
            storage: {
              collection: 'places',
              fields: {
                _id: { field: '_id' },
                address: { field: 'address' },
                stops: { field: 'stops' },
              },
            },
            fields: {
              _id: { type: objectId, nullable: false, many: false },
              address: { type: valueObjectRef('Address'), nullable: false, many: false },
              stops: {
                type: valueObjectRef('Stop'),
                nullable: false,
                many: { elementNullable: false },
              },
            },
            relations: {},
          },
        },
      },
    },
  },
  capabilities: {},
  extensions: {},
  profileHash: 'value-objects-profile',
  meta: {},
};

interface Places {
  create(row: Record<string, unknown>): Promise<{ readonly _id: unknown }>;
  where(filter: MongoFilterExpr | Record<string, unknown>): {
    first(): Promise<unknown>;
    update(
      operations: (field: (path: string) => FieldExpression) => FieldOperation[],
    ): Promise<unknown>;
  };
}

function placesOf(orm: unknown): Places {
  return (orm as { readonly places: Places }).places;
}

const contract = contractJson as unknown as MongoContractWithTypeMaps<
  MongoContract,
  AnyMongoTypeMaps
>;

describe('value objects in the Mongo ORM', { timeout: timeouts.spinUpMongoMemoryServer }, () => {
  let replSet: MongoMemoryReplSet;
  let client: MongoClient;
  let runtime: MongoRuntime;
  let context: MongoExecutionContext<typeof contract>;
  const dbName = 'orm_value_objects_test';

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    client = new MongoClient(replSet.getUri());
    await client.connect();
    const stack = createMongoExecutionStack({
      target: mongoRuntimeTarget,
      adapter: mongoRuntimeAdapter,
      driver: mongoRuntimeDriver,
    });
    context = createMongoExecutionContext({ contract, stack });
    const driver = stack.driver.create();
    await driver.connect({ kind: 'url', url: replSet.getUri(), dbName });
    runtime = createMongoRuntime({ context, adapter: stack.adapter.create(stack), driver });
  }, timeouts.spinUpMongoMemoryServer);

  beforeEach(async () => {
    await client.db(dbName).dropDatabase();
  });

  afterAll(async () => {
    await Promise.allSettled([runtime?.close(), client?.close(), replSet?.stop()]);
  }, timeouts.spinUpMongoMemoryServer);

  it('writes and reads a nested and a list value object through the codecs of their members', async () => {
    const places = placesOf(mongoOrm({ context, runtime }));
    const landmarkId = new ObjectId().toHexString();
    const stopId = new ObjectId().toHexString();
    const created = await places.create({
      address: { city: 'Lyon', landmark: { label: 'Fourvière', placeId: landmarkId } },
      stops: [{ label: 'Bellecour', placeId: stopId }],
    });

    const stored = await client.db(dbName).collection('places').findOne({});
    const read = await places.where({ _id: created._id }).first();

    expect({ stored, read }).toEqual({
      stored: {
        _id: expect.any(ObjectId),
        address: {
          city: 'Lyon',
          landmark: { label: 'Fourvière', placeId: new ObjectId(landmarkId) },
        },
        stops: [{ label: 'Bellecour', placeId: new ObjectId(stopId) }],
      },
      read: {
        _id: created._id,
        address: { city: 'Lyon', landmark: { label: 'Fourvière', placeId: landmarkId } },
        stops: [{ label: 'Bellecour', placeId: stopId }],
      },
    });
  });

  it('filters and updates by a dot path into a nested value object', async () => {
    const places = placesOf(mongoOrm({ context, runtime }));
    const landmarkId = new ObjectId().toHexString();
    await places.create({
      address: { city: 'Lyon', landmark: { label: 'Fourvière', placeId: landmarkId } },
      stops: [],
    });

    await places
      .where(MongoFieldFilter.eq('address.landmark.placeId', landmarkId))
      .update((p) => [p('address.landmark.label').set('Basilique')]);

    const stored = await client.db(dbName).collection('places').findOne({});
    expect(stored?.['address']).toEqual({
      city: 'Lyon',
      landmark: { label: 'Basilique', placeId: new ObjectId(landmarkId) },
    });
  });

  it('filters by a dot path through a list index into a list of value objects', async () => {
    const places = placesOf(mongoOrm({ context, runtime }));
    const firstId = new ObjectId().toHexString();
    const secondId = new ObjectId().toHexString();
    await places.create({
      address: { city: 'Paris', landmark: { label: 'Louvre', placeId: secondId } },
      stops: [
        { label: 'Châtelet', placeId: secondId },
        { label: 'Bastille', placeId: firstId },
      ],
    });
    await places.create({
      address: { city: 'Lyon', landmark: { label: 'Fourvière', placeId: firstId } },
      stops: [
        { label: 'Bellecour', placeId: firstId },
        { label: 'Terreaux', placeId: secondId },
      ],
    });

    const found = await places.where(MongoFieldFilter.eq('stops.1.placeId', secondId)).first();
    expect(found).toMatchObject({
      stops: [{ label: 'Bellecour' }, { label: 'Terreaux' }],
    });
  });
});
