import { MongoCollection, type MongoContract } from '@internal/mongo-contract';
import { createCollection, setValidation } from '@internal/target-mongo/migration';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { useStatementsDatabase } from './runner-statements-fixtures';

const members = {
  bsonType: 'object',
  required: ['name'],
  properties: { _id: {}, name: { bsonType: 'string' } },
  additionalProperties: false,
};
const users = {
  bsonType: 'object',
  required: ['email'],
  properties: { _id: {}, email: { bsonType: 'string' } },
  additionalProperties: false,
};
const createMembers = createCollection('members', {
  validator: { $jsonSchema: members },
  validationLevel: 'strict',
  validationAction: 'error',
});
/** A contract that stores only collections, each with the validator given. */
function validated(
  storageHash: string,
  schemas: Readonly<Record<string, Record<string, unknown>>>,
): MongoContract {
  const collection = Object.fromEntries(
    Object.entries(schemas).map(([name, jsonSchema]) => [
      name,
      new MongoCollection({
        validator: { jsonSchema, validationLevel: 'strict', validationAction: 'error' },
      }),
    ]),
  );
  return {
    target: 'mongo',
    targetFamily: 'mongo',
    profileHash: 'p1',
    capabilities: {},
    extensions: {},
    meta: {},
    roots: {},
    models: {},
    storage: {
      storageHash,
      namespaces: {
        __unbound__: { id: '__unbound__', kind: 'mongo-namespace', entries: { collection } },
      },
    },
  } as unknown as MongoContract;
}

const from = validated('from', {});
const to = validated('to', { users, members });

describe('a migration that creates a collection, run again', {
  timeout: timeouts.spinUpMongoMemoryServer,
}, () => {
  const { db, initMarker, runOperations } = useStatementsDatabase('create_collection_reruns');

  const membersOptions = async () =>
    (await db().listCollections({ name: 'members' }, { nameOnly: false }).toArray())[0]?.options;

  it('skips the creation it already made and finishes after a later operation stopped', async () => {
    await db().collection('users').insertOne({ email: 'a@example.com', stray: true });
    await initMarker(from);
    const operations = [
      createMembers,
      setValidation('users', users, {
        validationLevel: 'strict',
        validationAction: 'error',
        checkDocuments: true,
      }),
    ];
    const first = await runOperations(operations, from, to);
    await db()
      .collection('users')
      .updateMany({}, { $unset: { stray: '' } });
    const second = await runOperations(operations, from, to);
    expect({ first: first.ok, second: second.ok, members: await membersOptions() }).toEqual({
      first: false,
      second: true,
      members: {
        validator: { $jsonSchema: members },
        validationLevel: 'strict',
        validationAction: 'error',
      },
    });
  });

  it('stops at the precheck when the collection was made another way, without the validator', async () => {
    await db().createCollection('members');
    await initMarker(from);
    const result = await runOperations([createMembers], from, to);
    expect({ ok: result.ok, members: await membersOptions() }).toEqual({ ok: false, members: {} });
  });
});
