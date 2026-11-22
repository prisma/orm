import { AsyncIterableResult } from '@internal/framework-components/runtime';
import {
  createMongoCollection,
  type MongoQueryExecutor,
  type MongoQueryPlan,
} from '@internal/mongo-orm';
import { createFieldAccessor } from '@internal/mongo-query-builder';
import { describe, expect, it } from 'vitest';
import { defineContract } from '../src/exports/contract-builder';
import mongoStatic from '../src/static/mongo-static';

function contractWithEmbed(relationName: string) {
  return defineContract({}, ({ field, model, rel, type }) => {
    const User = model('User', {
      collection: 'users',
      fields: { _id: field.scalar(type.ObjectId()) },
      relations: { [relationName]: rel.hasOne('Address') },
    });
    const Address = model('Address', {
      owner: User,
      fields: { city: field.scalar(type.String()) },
    });
    return { models: { User, Address } };
  });
}

const pathFilter = createFieldAccessor() as unknown as (path: string) => {
  eq(value: string): never;
};

function recordingRuntime(): { runtime: MongoQueryExecutor; plans: MongoQueryPlan[] } {
  const plans: MongoQueryPlan[] = [];
  const runtime: MongoQueryExecutor = {
    query: <Row>(plan: MongoQueryPlan<Row>) => {
      plans.push(plan);
      return new AsyncIterableResult((async function* () {})());
    },
    execute: async (plan) => {
      plans.push(plan);
      return { affectedRows: 1 };
    },
  };
  return { runtime, plans };
}

async function filterThroughEmbed(relationName: string): Promise<unknown> {
  const { context } = mongoStatic({ contract: contractWithEmbed(relationName) });
  const { runtime, plans } = recordingRuntime();
  const users = createMongoCollection({ context, runtime }, 'User');
  const outcome = await Promise.resolve()
    .then(() =>
      users
        .where(pathFilter(`${relationName}.city`).eq('Paris'))
        .all()
        .toArray(),
    )
    .then(
      () => 'ok',
      (error: unknown) => String(error),
    );
  return JSON.parse(
    JSON.stringify({ outcome, command: plans[0]?.command }).replaceAll(relationName, '<relation>'),
  );
}

describe('a path through an embed relation named like a property every object has', () => {
  it('is filtered on as through any other embed relation', async () => {
    const throughOrdinaryName = await filterThroughEmbed('address');
    expect(throughOrdinaryName).toMatchObject({ outcome: 'ok', command: expect.anything() });
    expect(await filterThroughEmbed('constructor')).toEqual(throughOrdinaryName);
  });
});
