/**
 * Mongo parity for PSL scalar lists: the same PSL list schema yields matching
 * observable semantics on SQL and Mongo.
 *
 * The decoded-element-values assertion for Mongo runs against
 * `mongodb-memory-server`, which fails to spin up on some local sandboxes
 * (UnknownLinuxDistro "nixos"); it is written for CI, where the memory server
 * runs.
 */
import type { SerializeContract } from '@internal/contract/hashing';
import { emit } from '@internal/emitter';
import { mongoFamilyDescriptor } from '@internal/family-mongo/control';
import sql from '@internal/family-sql/control';
import { mongoContractCanonicalizationHooks } from '@internal/mongo-contract/canonicalization-hooks';
import { sqlContractCanonicalizationHooks } from '@internal/sql-contract/canonicalization-hooks';
import { type MongoTargetContract, mongoTargetDescriptor } from '@internal/target-mongo/control';
import postgres from '@internal/target-postgres/control';
import type { JsonObject } from '@internal/utils/json';
import { timeouts } from '@repo/test-utils';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  authorMongoContractFromPsl,
  authorSqlContractFromPsl,
  mongoStack,
  sqlStack,
} from './psl-list-authoring';

// The parity subject is the `tags String[]` list field; the id line differs
// only by each family's id convention (SQL integer id vs Mongo ObjectId `_id`).
const SQL_LIST_SCHEMA = `model Note {
  id   Int      @id
  tags String[]
}`;

const MONGO_LIST_SCHEMA = `model Note {
  id   ObjectId @id @map("_id")
  tags String[]
}`;

const sqlSerializeContract: SerializeContract = (contract) =>
  postgres.contractSerializer.serializeContract(
    contract as Parameters<typeof postgres.contractSerializer.serializeContract>[0],
  );

const mongoSerializeContract: SerializeContract = (contract) =>
  mongoTargetDescriptor.contractSerializer.serializeContract(contract as MongoTargetContract);

describe('PSL scalar-list Mongo parity', () => {
  it(
    'both SQL and Mongo author the same list schema with no diagnostics',
    async () => {
      const sqlResult = await authorSqlContractFromPsl(SQL_LIST_SCHEMA);
      const mongoResult = await authorMongoContractFromPsl(MONGO_LIST_SCHEMA);

      expect(sqlResult.diagnostics).toEqual([]);
      expect(sqlResult.ok).toBe(true);
      expect(mongoResult.diagnostics).toEqual([]);
      expect(mongoResult.ok).toBe(true);
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'both SQL and Mongo generate ReadonlyArray<string> for the list field',
    async () => {
      const sqlResult = await authorSqlContractFromPsl(SQL_LIST_SCHEMA);
      const mongoResult = await authorMongoContractFromPsl(MONGO_LIST_SCHEMA);
      if (!sqlResult.contract || !mongoResult.contract) {
        throw new Error('authoring produced no contract');
      }

      const sqlFamily = sql.create(sqlStack);
      const sqlEmitted = await emit(sqlResult.contract, sqlStack, sql.emission, {
        serializeContract: (c) => sqlSerializeContract(c) as unknown as JsonObject,
        deserializeContract: (json) => sqlFamily.deserializeContract(json),
        ...sqlContractCanonicalizationHooks,
      });
      const mongoFamily = mongoFamilyDescriptor.create(mongoStack);
      const mongoEmitted = await emit(
        mongoResult.contract,
        mongoStack,
        mongoFamilyDescriptor.emission,
        {
          serializeContract: (c) => mongoSerializeContract(c) as unknown as JsonObject,
          deserializeContract: (json) => mongoFamily.deserializeContract(json),
          ...mongoContractCanonicalizationHooks,
        },
      );

      // Both families render the list field as a `ReadonlyArray<...>` domain
      // type over their string element codec's output type — the observable
      // generated-type parity (the element codec id differs by family).
      expect(sqlEmitted.contractDts).toContain(
        "readonly tags: ReadonlyArray<CodecTypes['pg/text@1']['output']>",
      );
      expect(mongoEmitted.contractDts).toContain(
        "readonly tags: ReadonlyArray<CodecTypes['mongo/string@1']['output']>",
      );
    },
    timeouts.typeScriptCompilation,
  );

  describe('decoded element values round-trip on Mongo', () => {
    let replSet: MongoMemoryReplSet | undefined;
    let client: MongoClient | undefined;

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

    afterAll(async () => {
      try {
        await client?.close();
        await replSet?.stop();
      } catch {
        // ignore teardown failures
      }
    }, timeouts.spinUpMongoMemoryServer);

    it(
      'a list value inserted into Mongo round-trips element-for-element',
      async () => {
        if (!client) throw new Error('mongo client not initialised');

        const mongoResult = await authorMongoContractFromPsl(MONGO_LIST_SCHEMA);
        expect(mongoResult.ok).toBe(true);

        const tags = ['react', 'typescript', 'prisma'];
        const db = client.db('psl_list_parity');
        await db.dropDatabase();
        const collection = db.collection('Note');
        await collection.insertOne({ tags });

        const stored = await collection.findOne({});
        expect(stored?.['tags']).toEqual(tags);
      },
      timeouts.spinUpMongoMemoryServer,
    );
  });
});
