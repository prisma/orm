import type { MongoContract } from '@internal/mongo-contract';
import type { MongoExecutionContext, RawMongoCommand } from '@internal/mongo-query-ast/execution';
import { blindCast } from '@internal/utils/casts';
import { describe, expect, it } from 'vitest';
import type { Contract } from '../../../1-foundation/mongo-contract/test/fixtures/orm-contract';
import ormContractJson from '../../../1-foundation/mongo-contract/test/fixtures/orm-contract.json';
import { mongoRaw } from '../src/mongo-raw';

function contextOf<TContract extends MongoContract>(
  contract: TContract,
): MongoExecutionContext<TContract> {
  return {
    contract,
    codecs: { get: () => undefined, has: () => false },
    applyMutationDefaults: () => [],
  };
}

// JSON import loses literal types; typed Contract .d.ts is the source of truth
const contract = blindCast<Contract, 'orm fixture JSON carries domain.namespaces envelope'>(
  ormContractJson,
);

describe('mongoRaw', () => {
  const raw = mongoRaw({ context: contextOf(contract) });

  describe('collection name resolution', () => {
    it('resolves root name to storage collection via contract', () => {
      const plan = raw.collection('tasks').aggregate([]).build();
      expect(plan.collection).toBe('tasks');
    });

    it('throws when root maps to a missing model', () => {
      const badContract = {
        ...ormContractJson,
        roots: { ghost: { namespace: '__unbound__', model: 'NoSuchModel' } },
      } as unknown as MongoContract;
      const badRaw = mongoRaw({ context: contextOf(badContract) });
      expect(() => badRaw.collection('ghost')).toThrow(
        'Unknown model "NoSuchModel" for root "ghost"',
      );
    });
  });

  describe('plan metadata', () => {
    it('sets lane to mongo-raw', () => {
      const plan = raw.collection('tasks').aggregate([]).build();
      expect(plan.meta.lane).toBe('mongo-raw');
    });

    it('sets target to mongo', () => {
      const plan = raw.collection('tasks').aggregate([]).build();
      expect(plan.meta.target).toBe('mongo');
    });

    it('sets storageHash from contract', () => {
      const plan = raw.collection('tasks').aggregate([]).build();
      expect(plan.meta.storageHash).toBe(contract.storage.storageHash);
    });
  });

  describe('aggregate', () => {
    it('produces a rawAggregate command', () => {
      const pipeline = [
        { $match: { status: 'active' } },
        { $group: { _id: '$dept', total: { $sum: '$amount' } } },
      ];
      const plan = raw.collection('tasks').aggregate(pipeline).build();
      expect(plan.command.kind).toBe('rawAggregate');
      const cmd = plan.command as Extract<RawMongoCommand, { kind: 'rawAggregate' }>;
      expect(cmd.pipeline).toEqual(pipeline);
    });
  });

  describe('insertOne', () => {
    it('produces a rawInsertOne command', () => {
      const doc = { name: 'Alice', email: 'alice@example.com' };
      const plan = raw.collection('users').insertOne(doc).build();
      expect(plan.command.kind).toBe('rawInsertOne');
      const cmd = plan.command as Extract<RawMongoCommand, { kind: 'rawInsertOne' }>;
      expect(cmd.document).toEqual(doc);
    });
  });

  describe('insertMany', () => {
    it('produces a rawInsertMany command', () => {
      const docs = [{ name: 'Alice' }, { name: 'Bob' }];
      const plan = raw.collection('users').insertMany(docs).build();
      expect(plan.command.kind).toBe('rawInsertMany');
      const cmd = plan.command as Extract<RawMongoCommand, { kind: 'rawInsertMany' }>;
      expect(cmd.documents).toEqual(docs);
    });
  });

  describe('updateOne', () => {
    it('produces a rawUpdateOne command', () => {
      const filter = { email: 'alice@example.com' };
      const update = { $set: { name: 'Alice B' } };
      const plan = raw.collection('users').updateOne(filter, update).build();
      expect(plan.command.kind).toBe('rawUpdateOne');
      const cmd = plan.command as Extract<RawMongoCommand, { kind: 'rawUpdateOne' }>;
      expect(cmd.filter).toEqual(filter);
      expect(cmd.update).toEqual(update);
    });
  });

  describe('updateMany', () => {
    it('produces a rawUpdateMany command with object update', () => {
      const filter = { status: 'inactive' };
      const update = { $set: { archived: true } };
      const plan = raw.collection('users').updateMany(filter, update).build();
      expect(plan.command.kind).toBe('rawUpdateMany');
      const cmd = plan.command as Extract<RawMongoCommand, { kind: 'rawUpdateMany' }>;
      expect(cmd.filter).toEqual(filter);
      expect(cmd.update).toEqual(update);
    });

    it('produces a rawUpdateMany command with pipeline update', () => {
      const filter = { firstName: { $exists: true } };
      const update = [{ $set: { fullName: { $concat: ['$firstName', ' ', '$lastName'] } } }];
      const plan = raw.collection('users').updateMany(filter, update).build();
      const cmd = plan.command as Extract<RawMongoCommand, { kind: 'rawUpdateMany' }>;
      expect(cmd.update).toEqual(update);
    });
  });

  describe('deleteOne', () => {
    it('produces a rawDeleteOne command', () => {
      const filter = { email: 'alice@example.com' };
      const plan = raw.collection('users').deleteOne(filter).build();
      expect(plan.command.kind).toBe('rawDeleteOne');
      const cmd = plan.command as Extract<RawMongoCommand, { kind: 'rawDeleteOne' }>;
      expect(cmd.filter).toEqual(filter);
    });
  });

  describe('deleteMany', () => {
    it('produces a rawDeleteMany command', () => {
      const filter = { status: 'expired' };
      const plan = raw.collection('tasks').deleteMany(filter).build();
      expect(plan.command.kind).toBe('rawDeleteMany');
      const cmd = plan.command as Extract<RawMongoCommand, { kind: 'rawDeleteMany' }>;
      expect(cmd.filter).toEqual(filter);
    });
  });

  describe('findOneAndUpdate', () => {
    it('produces a rawFindOneAndUpdate command', () => {
      const filter = { _id: 'counter1' };
      const update = { $inc: { count: 1 } };
      const plan = raw
        .collection('tasks')
        .findOneAndUpdate(filter, update, { upsert: true })
        .build();
      expect(plan.command.kind).toBe('rawFindOneAndUpdate');
      const cmd = plan.command as Extract<RawMongoCommand, { kind: 'rawFindOneAndUpdate' }>;
      expect(cmd.filter).toEqual(filter);
      expect(cmd.update).toEqual(update);
      expect(cmd.upsert).toBe(true);
    });

    it('defaults upsert to false', () => {
      const plan = raw
        .collection('tasks')
        .findOneAndUpdate({ _id: 'x' }, { $set: { v: 1 } })
        .build();
      const cmd = plan.command as Extract<RawMongoCommand, { kind: 'rawFindOneAndUpdate' }>;
      expect(cmd.upsert).toBe(false);
    });
  });

  describe('findOneAndDelete', () => {
    it('produces a rawFindOneAndDelete command', () => {
      const filter = { email: 'alice@example.com' };
      const plan = raw.collection('users').findOneAndDelete(filter).build();
      expect(plan.command.kind).toBe('rawFindOneAndDelete');
      const cmd = plan.command as Extract<RawMongoCommand, { kind: 'rawFindOneAndDelete' }>;
      expect(cmd.filter).toEqual(filter);
    });
  });
});
