import type { ContractField } from '@internal/contract/types';
import type { StorageTable } from '@internal/sql-contract/types';
import type {
  CollectionMethodModel,
  CollectionMethodReceiver,
} from '@internal/sql-relational-core/collection-methods';
import { describe, expect, it } from 'vitest';
import { pgvectorNearestMethods } from '../src/core/nearest-collection-method';
import pgvectorRuntimeDescriptor from '../src/exports/runtime';

const vector = (length: number): ContractField => ({
  nullable: true,
  type: { kind: 'scalar', codecId: 'pg/vector@1', typeParams: { length } },
});

const post: CollectionMethodModel = {
  target: 'postgres',
  name: 'Post',
  fields: {
    id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
    embedding: vector(3),
    summaryEmbedding: vector(2),
    history: { ...vector(3), many: { elementNullable: false } },
  },
  relations: {},
  table: { columns: {}, indexes: [], uniques: [], foreignKeys: [] } as unknown as StorageTable,
};

function distanceRecorder() {
  const steps: unknown[] = [];
  const distances: unknown[] = [];
  const row = {
    embedding: {
      cosineDistance: (to: readonly number[]) => {
        distances.push(to);
        return {
          asc: () => ({ ascending: to }),
          lt: (limit: number) => ({ below: limit, to }),
        };
      },
    },
  };
  const receiver: CollectionMethodReceiver = {
    where(condition) {
      steps.push({ where: condition(row, { fns: {}, indexes: {} }) });
      return receiver;
    },
    orderBy(order) {
      steps.push({ orderBy: order(row, { fns: {}, indexes: {} }) });
      return receiver;
    },
  };
  return { receiver, steps, distances };
}

describe('the pgvector nearest-neighbour collection methods', () => {
  it('are contributed by the runtime extension descriptor', () => {
    expect(pgvectorRuntimeDescriptor.collectionMethods?.()).toEqual([pgvectorNearestMethods]);
  });

  it('are one per vector field that is not a list, named <field>_nearest', () => {
    expect(Object.keys(pgvectorNearestMethods.methodsFor(post))).toEqual([
      'embedding_nearest',
      'summaryEmbedding_nearest',
    ]);
  });

  it('order by cosine distance to the vector, nearest first', () => {
    const { receiver, steps } = distanceRecorder();
    const nearest = pgvectorNearestMethods.methodsFor(post)['embedding_nearest'];

    const result = nearest?.(receiver, ...([[1, 2, 3]] as never[]));

    expect({ result, steps }).toEqual({
      result: receiver,
      steps: [{ orderBy: { ascending: [1, 2, 3] } }],
    });
  });

  it('keep only the rows within a maximum distance when one is given, from the same distance expression', () => {
    const { receiver, steps, distances } = distanceRecorder();
    const nearest = pgvectorNearestMethods.methodsFor(post)['embedding_nearest'];

    nearest?.(receiver, ...([[1, 2, 3], 0.5] as never[]));

    expect(steps).toEqual([
      { orderBy: { ascending: [1, 2, 3] } },
      { where: { below: 0.5, to: [1, 2, 3] } },
    ]);
    expect(distances).toEqual([[1, 2, 3]]);
  });
});

describe('a nearest-neighbour method', () => {
  it('fails loudly when the model accessor has no such field', () => {
    const receiver: CollectionMethodReceiver = {
      where: () => receiver,
      orderBy(order) {
        order({}, { fns: {}, indexes: {} });
        return receiver;
      },
    };
    const nearest = pgvectorNearestMethods.methodsFor(post)['embedding_nearest'];

    expect(() => nearest?.(receiver, ...([[1, 2, 3]] as never[]))).toThrow(
      'The model accessor has no vector field "embedding".',
    );
  });
});
