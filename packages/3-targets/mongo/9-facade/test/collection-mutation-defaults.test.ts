import { AsyncIterableResult } from '@internal/framework-components/runtime';
import {
  createMongoCollection,
  type MongoQueryExecutor,
  type MongoQueryPlan,
} from '@internal/mongo-orm';
import { describe, expect, it } from 'vitest';
import { defineContract } from '../src/exports/contract-builder';
import mongoStatic from '../src/static/mongo-static';

const contract = defineContract({}, ({ field, model, gen }) => ({
  models: {
    Post: model('Post', {
      collection: 'posts',
      fields: {
        _id: field.objectId(),
        title: field.string(),
        createdAt: field.date().onCreate(gen.now()),
      },
    }),
  },
}));

function recordingRuntime(): { runtime: MongoQueryExecutor; plans: MongoQueryPlan[] } {
  const plans: MongoQueryPlan[] = [];
  const runtime: MongoQueryExecutor = {
    query: <Row>(plan: MongoQueryPlan<Row>) => {
      plans.push(plan);
      return new AsyncIterableResult(
        (async function* () {
          yield { insertedId: 'p1', document: { _id: 'p1' } } as Row;
        })(),
      );
    },
    execute: async (plan) => {
      plans.push(plan);
      return { affectedRows: 1 };
    },
  };
  return { runtime, plans };
}

describe('a collection created from a context', () => {
  it('fills the generated fields of the context contract on create', async () => {
    const { context } = mongoStatic({ contract });
    const { runtime, plans } = recordingRuntime();
    const posts = createMongoCollection({ context, runtime }, 'Post');

    await posts.create({ title: 'Hello' });

    expect(plans[0]?.command).toMatchObject({
      document: {
        title: { value: 'Hello' },
        createdAt: { codecId: 'mongo/date@1', value: expect.any(Date) },
      },
    });
  });
});
