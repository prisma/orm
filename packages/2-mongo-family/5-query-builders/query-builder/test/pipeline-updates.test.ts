import {
  MongoAddFieldsStage,
  MongoProjectStage,
  MongoReplaceRootStage,
  UpdateManyCommand,
  UpdateOneCommand,
} from '@internal/mongo-query-ast/execution';
import { describe, expect, it } from 'vitest';
import type { PipelineChain } from '../src/builder';
import { mongoQuery } from '../src/query';
import type { ModelToDocShape } from '../src/types';
import type { UpdaterResult } from '../src/update-ops';
import { contextOf } from './fixtures/test-context';
import type { TContract } from './fixtures/test-contract';
import { testContract } from './fixtures/test-contract';

const orders = () => mongoQuery({ context: contextOf(testContract) }).from('orders');

/**
 * After A25 (`CollectionHandle`/`FilteredCollection` start with
 * `'update-cleared' / 'fam-cleared'`), reaching the no-arg
 * `PipelineChain.updateMany()` / `updateOne()` terminals via the public
 * surface is no longer type-safe (the marker never recovers from the
 * cleared initial state). The runtime behaviour of `deconstructUpdateChain`
 * still needs coverage, so these tests cast to a `PipelineChain` with
 * `'update-ok'` forced to reach the inherited methods directly.
 */
type UpdateReachableChain<
  Shape extends ModelToDocShape<TContract, 'Order'> = ModelToDocShape<TContract, 'Order'>,
> = PipelineChain<TContract, Shape, 'update-ok', 'fam-cleared', 'past-leading'>;

describe('F3 pipeline-style updates', () => {
  describe('f.stage emitters', () => {
    it('f.stage.set returns MongoAddFieldsStage', () => {
      const plan = orders()
        .match((f) => f.status.eq('new'))
        .updateMany((f) => [f.stage.set({ total: f.amount.node })]);
      const cmd = plan.command;
      expect(cmd.update).toHaveLength(1);
      expect((cmd.update as ReadonlyArray<unknown>)[0]).toBeInstanceOf(MongoAddFieldsStage);
    });

    it('f.stage.unset returns MongoProjectStage with exclusions', () => {
      const plan = orders()
        .match((f) => f.status.eq('new'))
        .updateMany((f) => [f.stage.unset('amount', 'status')]);
      const cmd = plan.command;
      expect(cmd.update).toHaveLength(1);
      const stage = (cmd.update as ReadonlyArray<unknown>)[0] as MongoProjectStage;
      expect(stage).toBeInstanceOf(MongoProjectStage);
      expect(stage.projection).toEqual({ amount: 0, status: 0 });
    });

    it('f.stage.replaceRoot returns MongoReplaceRootStage', () => {
      const plan = orders()
        .match((f) => f.status.eq('new'))
        .updateMany((f) => [f.stage.replaceRoot(f.amount.node)]);
      const cmd = plan.command;
      expect((cmd.update as ReadonlyArray<unknown>)[0]).toBeInstanceOf(MongoReplaceRootStage);
    });

    it('f.stage.replaceWith is an alias for replaceRoot', () => {
      const plan = orders()
        .match((f) => f.status.eq('new'))
        .updateMany((f) => [f.stage.replaceWith(f.amount.node)]);
      const cmd = plan.command;
      expect((cmd.update as ReadonlyArray<unknown>)[0]).toBeInstanceOf(MongoReplaceRootStage);
    });
  });

  describe('mixed updater detection', () => {
    it('throws when mixing TypedUpdateOp and pipeline stages', () => {
      expect(() =>
        orders()
          .match((f) => f.status.eq('new'))
          .updateMany(
            (f) =>
              [
                f.status.set('done'),
                f.stage.set({ total: f.amount.node }),
              ] as unknown as UpdaterResult,
          ),
      ).toThrow(/Cannot mix/);
    });
  });

  describe('no-arg PipelineChain.updateMany()', () => {
    it('deconstructs leading $match + trailing pipeline stages into UpdateManyCommand', () => {
      const chain = orders()
        .match((f) => f.status.eq('new'))
        .addFields((f) => ({ total: f.amount })) as unknown as UpdateReachableChain;
      const plan = chain.updateMany();
      expect(plan.command).toBeInstanceOf(UpdateManyCommand);
      const cmd = plan.command;
      expect(cmd.update).toHaveLength(1);
      expect((cmd.update as ReadonlyArray<unknown>)[0]).toBeInstanceOf(MongoAddFieldsStage);
      expect(plan.meta.lane).toBe('mongo-query');
    });

    it('AND-folds multiple $match stages in the filter', () => {
      const chain = orders()
        .match((f) => f.status.eq('new'))
        .match((f) => f.amount.gt(10))
        .addFields((f) => ({ total: f.amount })) as unknown as UpdateReachableChain;
      const plan = chain.updateMany();
      const cmd = plan.command;
      expect(cmd.filter.kind).toBe('and');
    });

    it('throws without any .match() stages', () => {
      expect(() =>
        (
          orders().addFields((f) => ({ total: f.amount })) as unknown as UpdateReachableChain
        ).updateMany(),
      ).toThrow(/at least one .match/);
    });

    it('throws on non-update stages forced via cast (defensive runtime check)', () => {
      const chain = orders()
        .match((f) => f.status.eq('new'))
        .sort({ amount: -1 });
      expect(() => (chain as unknown as UpdateReachableChain).updateMany()).toThrow(
        /non-update stage/,
      );
    });
  });

  describe('no-arg PipelineChain.updateOne()', () => {
    it('maps to UpdateOneCommand', () => {
      const chain = orders()
        .match((f) => f.status.eq('new'))
        .addFields((f) => ({ total: f.amount })) as unknown as UpdateReachableChain;
      const plan = chain.updateOne();
      expect(plan.command).toBeInstanceOf(UpdateOneCommand);
    });
  });
});
