import type { Vector } from '@prisma/orm-extension-pgvector/codec-types';
import type { CollectionRowOf, HasOrderBy, HasWhere } from '@prisma/orm-postgres/orm-client';
import type { PostgresClient } from '@prisma/orm-postgres/runtime';
import { websearchToTsquery } from '@prisma/orm-postgres/target/full-text';
import { describe, expectTypeOf, test } from 'vitest';
import type { PostCollection } from '../src/orm-client/collections';
import type { Contract } from '../src/prisma/contract.d';
import { db } from '../src/prisma/db';

const custom = db.orm.public;
declare const plainDb: PostgresClient<Contract>;

const plain = plainDb.orm.public;
const q = websearchToTsquery('zebra');

describe('collection methods from the Postgres facade and pgvector, through built output', () => {
  test('one method for each full-text index and each vector field, under the names the packages chose', () => {
    expectTypeOf(plain.Post.using).not.toBeAny();
    expectTypeOf<keyof typeof plain.Post.using>().toEqualTypeOf<
      'post_search' | 'post_title_search' | 'embedding_nearest'
    >();
    // @ts-expect-error the physical name is not a method name
    plain.Post.using.post_search_f03270be;
  });

  test('a model with no full-text index has no methods', () => {
    expectTypeOf(plain.User.using).toEqualTypeOf<Record<never, never>>();
    // @ts-expect-error User has no full-text index
    plain.User.using.post_search;
  });

  test('a pgvector method takes a vector typed from the field', () => {
    expectTypeOf(plain.Post.using.embedding_nearest).parameter(0).toEqualTypeOf<Vector<1536>>();
    expectTypeOf(plain.Post.using.embedding_nearest([0.1], 0.5)).toExtend<HasOrderBy>();
    expectTypeOf(plain.Post.using.embedding_nearest([0.1], 0.5)).not.toExtend<HasWhere>();
    // @ts-expect-error a nearest-neighbour search does not declare a filter, so deleteAll could delete every post
    plain.Post.using.embedding_nearest([0.1]).deleteAll();
    // @ts-expect-error a nearest-neighbour search does not declare a filter, so updateAll could update every post
    plain.Post.using.embedding_nearest([0.1]).updateAll({ title: 'x' });
    expectTypeOf(plain.Post.using.post_search(q).deleteAll).toBeFunction();
    // @ts-expect-error a vector is a list of numbers
    plain.Post.using.embedding_nearest('x');
  });

  test('a method keeps the receiver and adds the filter and order facts', () => {
    const result = custom.Post.forUser('u').using.post_search(q);
    expectTypeOf(result).toExtend<PostCollection & HasWhere & HasOrderBy>();
    expectTypeOf(result.newestFirst()).toExtend<PostCollection>();
  });

  test('the row type chosen before the call is kept', () => {
    const result = plain.Post.select('id', 'title').using.post_search(q);
    expectTypeOf<CollectionRowOf<typeof result>>().toEqualTypeOf<{ id: string; title: string }>();
  });

  test('a method is offered inside an include refinement', () => {
    const result = plain.User.include('posts', (posts) =>
      posts.using.post_title_search(q).limit(3),
    );
    expectTypeOf(result).not.toBeAny();
  });

  test('a misspelled method name is an error', () => {
    // @ts-expect-error no index is named `search`
    plain.Post.using.search(q);
  });
});
