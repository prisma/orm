import { InsertOneCommand } from '@internal/mongo-query-ast/execution';
import { isStructuredError } from '@internal/utils/structured-error';
import { describe, expect, it } from 'vitest';
import type { PipelineChain } from '../src/builder';
import { mongoQuery } from '../src/query';
import type { ModelToDocShape } from '../src/types';
import { contextOf } from './fixtures/test-context';
import type { TContract } from './fixtures/test-contract';
import { testContract, testContractJson } from './fixtures/test-contract';

const orders = () => mongoQuery({ context: contextOf(testContract) }).from('orders');

type FamReachableChain = PipelineChain<
  TContract,
  ModelToDocShape<TContract, 'Order'>,
  'update-cleared',
  'fam-ok',
  'past-leading'
>;

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return isStructuredError(error) ? error.code : undefined;
  }
  return undefined;
}

describe('structured error codes', () => {
  it('raises ORM.ARGUMENT_INVALID for a duplicate update operation', () => {
    expect(
      codeOf(() =>
        orders()
          .match((f) => f.status.eq('new'))
          .updateMany((f) => [f.amount.set(1), f.amount.set(2)]),
      ),
    ).toBe('ORM.ARGUMENT_INVALID');
  });

  it('raises ORM.MUTATION_DATA_MISSING for insertMany with an empty batch', () => {
    expect(codeOf(() => orders().insertMany([]))).toBe('ORM.MUTATION_DATA_MISSING');
  });

  it('raises ORM.OPERATION_UNSUPPORTED for findOneAndUpdate after skip', () => {
    const chain = orders()
      .match((f) => f.status.eq('new'))
      .skip(5) as unknown as FamReachableChain;
    expect(codeOf(() => chain.findOneAndUpdate((f) => [f.status.set('bad')]))).toBe(
      'ORM.OPERATION_UNSUPPORTED',
    );
  });

  it('raises ORM.MODEL_UNKNOWN for an unknown root', () => {
    const p = mongoQuery({ context: contextOf(testContract) });
    expect(codeOf(() => p.from('nonexistent' as 'orders'))).toBe('ORM.MODEL_UNKNOWN');
  });

  it('raises CONTRACT.MODEL_UNKNOWN when a root references a missing model', () => {
    const patched = {
      ...testContractJson,
      roots: {
        ...testContractJson.roots,
        orders: { $ref: '#/domain/models/Ghost', model: 'Ghost' },
      },
    };
    const p = mongoQuery({ context: contextOf(patched as unknown as TContract) });
    expect(codeOf(() => p.from('orders'))).toBe('CONTRACT.MODEL_UNKNOWN');
  });

  it('raises CONTRACT.VALIDATION_FAILED when the contract has no storageHash', () => {
    const p = mongoQuery({
      context: contextOf({ ...testContract, storage: {} } as unknown as TContract),
    });
    expect(codeOf(() => p.rawCommand(new InsertOneCommand('orders', { status: 'new' })))).toBe(
      'CONTRACT.VALIDATION_FAILED',
    );
  });
});
