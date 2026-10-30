import {
  DeleteManyCommand,
  DeleteOneCommand,
  InsertManyCommand,
  InsertOneCommand,
  MongoExistsExpr,
  MongoFieldFilter,
  UpdateManyCommand,
  UpdateOneCommand,
} from '@internal/mongo-query-ast/execution';
import { describe, expect, it } from 'vitest';
import { mongoQuery } from '../src/query';
import { contextOf } from './fixtures/test-context';
import { testContract } from './fixtures/test-contract';

const orders = () => mongoQuery({ context: contextOf(testContract) }).from('orders');

describe('M2 write terminals', () => {
  describe('inserts (CollectionHandle)', () => {
    it('insertOne emits an InsertOneCommand carrying the document', () => {
      const plan = orders().insertOne({ status: 'new', amount: 10 });
      expect(plan.command).toBeInstanceOf(InsertOneCommand);
      expect(plan.command.collection).toBe('orders');
      expect(plan.command.document).toEqual({ status: 'new', amount: 10 });
      expect(plan.meta.lane).toBe('mongo-query');
    });

    it('insertMany emits an InsertManyCommand carrying every document in order', () => {
      const docs = [
        { status: 'new', amount: 10 },
        { status: 'new', amount: 20 },
      ];
      const plan = orders().insertMany(docs);
      expect(plan.command).toBeInstanceOf(InsertManyCommand);
      expect(plan.command.documents).toEqual(docs);
    });

    it('insertMany rejects an empty batch (no-op writes are nearly always a bug)', () => {
      expect(() => orders().insertMany([])).toThrow(/at least one document/);
    });
  });

  describe('unqualified writes (CollectionHandle)', () => {
    it('updateAll emits UpdateManyCommand with a tautological match-all filter', () => {
      const plan = orders().updateAll((f) => [f.status.set('reviewed')]);
      expect(plan.command).toBeInstanceOf(UpdateManyCommand);
      expect(plan.command.filter).toBeInstanceOf(MongoExistsExpr);
      expect((plan.command.filter as MongoExistsExpr).field).toBe('_id');
      expect((plan.command.filter as MongoExistsExpr).exists).toBe(true);
      expect(plan.command.update).toEqual({ $set: { status: 'reviewed' } });
    });

    it('deleteAll emits DeleteManyCommand with a tautological match-all filter', () => {
      const plan = orders().deleteAll();
      expect(plan.command).toBeInstanceOf(DeleteManyCommand);
      expect(plan.command.filter).toBeInstanceOf(MongoExistsExpr);
    });

    it('updateAll rejects an empty operator list (caller almost certainly forgot something)', () => {
      expect(() => orders().updateAll(() => [])).toThrow(/at least one update/);
    });
  });

  describe('filtered writes (FilteredCollection)', () => {
    it('updateMany splats the AND-folded filter into the wire command', () => {
      const plan = orders()
        .match((f) => f.status.eq('new'))
        .match((f) => f.amount.gt(5))
        .updateMany((f) => [f.status.set('processed'), f.amount.inc(1)]);
      expect(plan.command).toBeInstanceOf(UpdateManyCommand);
      expect(plan.command.filter.kind).toBe('and');
      expect(plan.command.update).toEqual({
        $set: { status: 'processed' },
        $inc: { amount: 1 },
      });
    });

    it('updateOne emits UpdateOneCommand (single-victim) with the same fold logic', () => {
      const plan = orders()
        .match(MongoFieldFilter.eq('status', 'new'))
        .updateOne((f) => [f.amount.inc(-1)]);
      expect(plan.command).toBeInstanceOf(UpdateOneCommand);
      expect(plan.command.filter).toBeInstanceOf(MongoFieldFilter);
      expect(plan.command.update).toEqual({ $inc: { amount: -1 } });
    });

    it('deleteMany / deleteOne emit the corresponding wire commands with the folded filter', () => {
      const many = orders()
        .match((f) => f.status.eq('archived'))
        .deleteMany();
      expect(many.command).toBeInstanceOf(DeleteManyCommand);
      expect(many.command.filter).toBeInstanceOf(MongoFieldFilter);

      const one = orders()
        .match((f) => f.status.eq('archived'))
        .deleteOne();
      expect(one.command).toBeInstanceOf(DeleteOneCommand);
    });

    it('rejects updates with operator+path collisions (single source of truth per field-op)', () => {
      expect(() =>
        orders()
          .match((f) => f.status.eq('new'))
          .updateMany((f) => [f.amount.set(1), f.amount.set(2)]),
      ).toThrow(/specified more than once/);
    });
  });
});
