import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { blindCast } from '@internal/utils/casts';
import { describe, expect, it } from 'vitest';
import { orm } from '../src/orm';
import { createChainingOrm, PostCollection } from './collection-chaining-fixture';
import type { Contract as PolyContract } from './fixtures/polymorphism/generated/contract';
import polyContractJson from './fixtures/polymorphism/generated/contract.json' with {
  type: 'json',
};
import { buildTestContextFromContract, createMockRuntime } from './helpers';

function fragmentFrom(collection: unknown): unknown {
  return blindCast<{ fragment(body: unknown): unknown }, 'a JavaScript caller'>(
    collection,
  ).fragment((posts: unknown) => posts);
}

const refusal = (model: string, state: string) =>
  expect.objectContaining({
    code: 'ORM.ARGUMENT_INVALID',
    message: `Cannot define a fragment from a collection of ${model} that has ${state}`,
    why: 'A fragment for one model is built from the model alone, so the calls before .fragment(...) would be ignored.',
    fix: `Call fragment on the model's root collection, such as db.orm.public.${model}.fragment(...), and apply the other calls where the fragment is used.`,
    meta: { method: 'fragment', model, state },
  });

describe('collection.fragment refuses a collection with query state', () => {
  const { db } = createChainingOrm();

  it.each([
    ['a filter', db.Post.where({ id: 1 })],
    ['an order', db.Post.orderBy((p) => p.id.asc())],
    ['a limit', db.Post.limit(1)],
    ['an offset', db.Post.offset(1)],
    ['a cursor', db.Post.orderBy((p) => p.id.asc()).cursor({ id: 1 })],
    ['distinct', db.Post.distinct('title')],
    ['distinctOn', db.Post.orderBy((p) => p.title.asc()).distinctOn('title')],
    ['an include', db.Post.include('author')],
    ['selected fields', db.Post.select('id')],
    ['a row lock', db.Post.forUpdate()],
  ])('refuses a collection with %s', (state, collection) => {
    expect(() => fragmentFrom(collection)).toThrow(refusal('Post', state));
  });

  it('refuses a collection narrowed to a variant', () => {
    const contract = new PostgresContractSerializer().deserializeContract<PolyContract>(
      polyContractJson,
    );
    const client = orm({
      runtime: createMockRuntime(),
      context: buildTestContextFromContract(contract),
    });
    expect(() => fragmentFrom(client.public.Task.variant('bug'))).toThrow(
      refusal('Task', 'a variant'),
    );
  });

  it('accepts a root collection and an instance of a custom class', () => {
    const { db, plain } = createChainingOrm();
    expect(db.Post).toBeInstanceOf(PostCollection);
    expect(fragmentFrom(db.Post)).toBeTypeOf('function');
    expect(fragmentFrom(plain.Post)).toBeTypeOf('function');
  });
});
