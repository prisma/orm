import { createPostgresAdapter } from '@internal/adapter-postgres/adapter';
import { int4Column } from '@internal/adapter-postgres/column-types';
import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { field } from '@internal/sql-contract-ts/contract-builder';
import type {
  CollectionMethodBody,
  CollectionMethodContribution,
} from '@internal/sql-relational-core/collection-methods';
import type { SqlQueryPlan } from '@internal/sql-relational-core/plan';
import { websearchToTsquery } from '@internal/target-postgres/full-text';
import { blindCast } from '@internal/utils/casts';
import { describe, expect, it } from 'vitest';
import type { PostgresContract } from '../../../3-targets/postgres/2-adapter/src/core/types';
import { collectionMethodTable } from '../src/collection-methods';
import { orm } from '../src/orm';
import { compileSelect, compileSelectWithIncludes } from '../src/query-plan-select';
import type { CollectionState } from '../src/types';
import {
  contextWithClash,
  notesContract,
  testAsOfMethods,
  testClosestMethods,
} from './collection-methods-fixture';
import { createCollectionMethodsOrm } from './collection-methods-orm-fixture';
import { createMockRuntime, getTestAggregates, getTestContext, getTestContract } from './helpers';

const adapter = createPostgresAdapter();

function sqlOf(contract: Contract<SqlStorage>, plan: SqlQueryPlan<unknown>): string {
  return adapter.lower(plan.ast, {
    contract: contract as unknown as PostgresContract,
    params: plan.params,
  }).sql;
}

const contract = getTestContract();

function usersSql(state: CollectionState): string {
  return sqlOf(contract, compileSelect(contract, 'User', state));
}

const search = `(setweight(to_tsvector('english', coalesce("users"."name", '')), 'A') || setweight(to_tsvector('english', coalesce("users"."email", '')), 'B'))`;
const q = websearchToTsquery('alice');

describe('using', () => {
  const { plain, notes, extended } = createCollectionMethodsOrm();

  it('has the methods each registered contribution gives the model', () => {
    expect({
      user: Object.keys(plain.User.using),
      post: Object.keys(plain.Post.using),
      note: Object.keys(notes.Note.using),
      tag: Object.keys(notes.Tag.using),
      extendedNote: Object.keys(extended.Note.using),
      extendedReading: Object.keys(extended.Reading.using),
      extendedTag: Object.keys(extended.Tag.using),
    }).toEqual({
      user: ['users_search'],
      post: [],
      note: ['notes_search'],
      tag: [],
      extendedNote: ['notes_search'],
      extendedReading: ['embedding_closest', 'as_of'],
      extendedTag: ['labelled'],
    });
  });

  it('serves a collection narrowed by variant from the base model table', () => {
    expect(Object.keys(notes.Note.variant('memo').using)).toEqual(['notes_search']);
  });

  it('is built once per collection, and again for each derived collection', () => {
    const users = plain.User;
    const first = users.using;
    const second = users.using;
    expect({ same: first === second, derived: first === users.limit(1).using }).toEqual({
      same: true,
      derived: false,
    });
  });

  it('works out the methods of a model once per execution context', () => {
    const context = getTestContext();
    expect(collectionMethodTable(context, 'public', 'User')).toBe(
      collectionMethodTable(context, 'public', 'User'),
    );
  });

  it('has no members inside the body of a fragment for any model', () => {
    const { fragment } = createCollectionMethodsOrm();
    let members: readonly string[] | undefined;
    const anyModel = fragment({ id: field.column(int4Column) }, (rows) => {
      members = Object.keys(Reflect.get(rows, 'using'));
      return rows;
    });

    plain.User.with(anyModel);

    expect(members).toEqual([]);
  });
});

describe('a contributed method', () => {
  const { db, plain } = createCollectionMethodsOrm();

  it('filters by the index and orders by its relevance, binding the query once', () => {
    const users = plain.User.select('id').using.users_search(q);

    expect(usersSql(users.state)).toBe(
      `SELECT "users"."id" AS "id" FROM "public"."users" WHERE ${search} @@ websearch_to_tsquery('english', $1) ORDER BY ts_rank(${search}, websearch_to_tsquery('english', $1)) DESC`,
    );
  });

  it('appends a later orderBy after the relevance order', () => {
    const users = plain.User.select('id')
      .using.users_search(q)
      .orderBy((u) => u.id.asc());

    expect(usersSql(users.state)).toBe(
      `SELECT "users"."id" AS "id" FROM "public"."users" WHERE ${search} @@ websearch_to_tsquery('english', $1) ORDER BY ts_rank(${search}, websearch_to_tsquery('english', $1)) DESC, "users"."id" ASC`,
    );
  });

  it('puts an earlier orderBy before the relevance order', () => {
    const users = plain.User.select('id')
      .orderBy((u) => u.id.asc())
      .using.users_search(q);

    expect(usersSql(users.state)).toBe(
      `SELECT "users"."id" AS "id" FROM "public"."users" WHERE ${search} @@ websearch_to_tsquery('english', $1) ORDER BY "users"."id" ASC, ts_rank(${search}, websearch_to_tsquery('english', $1)) DESC`,
    );
  });

  it('combines with a filter from a custom collection method, on this', () => {
    const users = db.User.named('Alice').relevant(q).select('id');

    expect(usersSql(users.state)).toBe(
      `SELECT "users"."id" AS "id" FROM "public"."users" WHERE ("users"."name" = $1 AND ${search} @@ websearch_to_tsquery('english', $2)) ORDER BY ts_rank(${search}, websearch_to_tsquery('english', $2)) DESC`,
    );
  });

  it('gives the same query inside with and inside a fragment for one model', () => {
    const direct = plain.User.using.users_search(q).select('id');
    const viaWith = plain.User.with((users) => users.using.users_search(q)).select('id');
    const viaFragment = plain.User.with(
      plain.User.fragment((users) => users.using.users_search(q)),
    ).select('id');

    expect({ viaWith: usersSql(viaWith.state), viaFragment: usersSql(viaFragment.state) }).toEqual({
      viaWith: usersSql(direct.state),
      viaFragment: usersSql(direct.state),
    });
  });

  it('binds the index to the related table inside an include refinement', () => {
    const users = plain.User.select('id').include('invitedUsers', (invited) =>
      invited.select('id').using.users_search(q).limit(3),
    );

    const sql = sqlOf(
      contract,
      compileSelectWithIncludes(contract, getTestAggregates(), 'User', users.state),
    );
    const child = `(setweight(to_tsvector('english', coalesce("users_2"."name", '')), 'A') || setweight(to_tsvector('english', coalesce("users_2"."email", '')), 'B'))`;
    const rank = `ts_rank(${child}, websearch_to_tsquery('english', $1))`;
    expect(sql).toBe(
      `SELECT "users"."id" AS "id", (SELECT coalesce(json_agg(json_build_object('id', "invitedUsers__rows"."id") ORDER BY "invitedUsers__rows"."invitedUsers__order_0" DESC), json_build_array()) AS "invitedUsers" FROM (SELECT "users_2"."id" AS "id", ${rank} AS "invitedUsers__order_0" FROM "public"."users" AS "users_2" WHERE ("users_2"."invited_by_id" = "users"."id" AND ${child} @@ websearch_to_tsquery('english', $1)) ORDER BY ${rank} DESC LIMIT 3) AS "invitedUsers__rows") AS "invitedUsers" FROM "public"."users"`,
    );
  });

  it('searches the related model own index inside a refinement into another model', () => {
    const posts = plain.Post.select('id').include('author', (author) =>
      author.select('id').using.users_search(q),
    );

    const sql = sqlOf(
      contract,
      compileSelectWithIncludes(contract, getTestAggregates(), 'Post', posts.state),
    );
    const rank = `ts_rank(${search}, websearch_to_tsquery('english', $1))`;
    expect(sql).toBe(
      `SELECT "posts"."id" AS "id", (SELECT coalesce(json_agg(json_build_object('id', "author__rows"."id") ORDER BY "author__rows"."author__order_0" DESC), json_build_array()) AS "author" FROM (SELECT "users"."id" AS "id", ${rank} AS "author__order_0" FROM "public"."users" WHERE ("users"."id" = "posts"."user_id" AND ${search} @@ websearch_to_tsquery('english', $1)) ORDER BY ${rank} DESC) AS "author__rows") AS "author" FROM "public"."posts"`,
    );
  });

  it('comes from a contribution that names its method after a field', () => {
    const { extended } = createCollectionMethodsOrm();
    const found = extended.Reading.select('id').using.embedding_closest([1, 2, 3]);
    const notes = notesContract();

    expect(sqlOf(notes, compileSelect(notes, 'Reading', found.state))).toBe(
      'SELECT "readings"."id" AS "id" FROM "public"."readings" ORDER BY "readings"."id" ASC',
    );
  });
});

describe('the ORM client', () => {
  const runtime = createMockRuntime();
  const context = getTestContext();
  const fullText = context.collectionMethods?.[0];
  if (fullText === undefined) throw new Error('the Postgres target contributes no method');

  it('refuses two contributions with the same id', () => {
    expect(() =>
      orm({
        runtime,
        context: {
          ...context,
          collectionMethods: [fullText, testAsOfMethods, testAsOfMethods],
        },
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'ORM.ARGUMENT_INVALID',
        message: 'Two collection method contributions have the id "test/as-of".',
        meta: { id: 'test/as-of' },
      }),
    );
  });

  it('refuses two contributions that give a model the same method name, at construction', () => {
    expect(() => orm({ runtime, context: contextWithClash() })).toThrow(
      expect.objectContaining({
        code: 'ORM.ARGUMENT_INVALID',
        message:
          'Collection method "labelled" of model "Tag" is contributed by both "test/clash-a" and "test/clash-b".',
        why: 'A collection offers one method under each name in `using`.',
        fix: 'Remove one of the extensions that contribute these methods.',
        meta: { model: 'Tag', method: 'labelled', contributions: ['test/clash-a', 'test/clash-b'] },
      }),
    );
  });

  it('asks each contribution for each model once per context, however many clients use it', () => {
    const asked: string[] = [];
    const counting: CollectionMethodContribution = {
      id: 'test/counting',
      methodsFor: (model) => {
        asked.push(model.name);
        return {};
      },
    };
    const counted = { ...context, collectionMethods: [fullText, counting, testClosestMethods] };

    const first = orm({ runtime, context: counted });
    const afterFirst = [...asked];
    orm({ runtime, context: counted });
    void first.public.User.using;

    expect({ once: new Set(afterFirst).size === afterFirst.length, afterSecond: asked }).toEqual({
      once: true,
      afterSecond: afterFirst,
    });
  });

  it('names the contribution and the model when a contribution fails', () => {
    const failure = new Error('boom');
    const failing: CollectionMethodContribution = {
      id: 'test/failing',
      methodsFor: (model) => {
        if (model.name === 'Post') throw failure;
        return {};
      },
    };

    expect(() =>
      orm({ runtime, context: { ...context, collectionMethods: [fullText, failing] } }),
    ).toThrow(
      expect.objectContaining({
        code: 'ORM.ARGUMENT_INVALID',
        message: 'Collection method contribution "test/failing" failed for model "Post".',
        meta: { model: 'Post', contribution: 'test/failing' },
        cause: failure,
      }),
    );
  });

  it('refuses a contributed method that is not a function', () => {
    const broken: CollectionMethodContribution = {
      id: 'test/broken',
      methodsFor: (model) =>
        model.name === 'Post'
          ? blindCast<
              Record<string, CollectionMethodBody>,
              'a contribution that breaks its contract'
            >({ latest: 'not a function' })
          : {},
    };

    expect(() =>
      orm({ runtime, context: { ...context, collectionMethods: [fullText, broken] } }),
    ).toThrow(
      expect.objectContaining({
        code: 'ORM.ARGUMENT_INVALID',
        message:
          'Collection method "latest" that contribution "test/broken" gives model "Post" is not a function.',
        meta: { model: 'Post', method: 'latest', contribution: 'test/broken' },
      }),
    );
  });

  it.each([null, undefined, 'methods'])(
    'refuses a contribution that returns %s instead of an object of methods',
    (returned) => {
      const broken: CollectionMethodContribution = {
        id: 'test/no-object',
        methodsFor: (model) =>
          model.name === 'User'
            ? blindCast<
                Record<string, CollectionMethodBody>,
                'a contribution that breaks its contract'
              >(returned)
            : {},
      };

      expect(() =>
        orm({ runtime, context: { ...context, collectionMethods: [fullText, broken] } }),
      ).toThrow(
        expect.objectContaining({
          code: 'ORM.ARGUMENT_INVALID',
          message:
            'Collection method contribution "test/no-object" returned no object of methods for model "User".',
          meta: { model: 'User', contribution: 'test/no-object' },
        }),
      );
    },
  );

  it('offers a method named __proto__ as its own method', () => {
    const body: CollectionMethodBody = (collection) => collection;
    const protoNamed: CollectionMethodContribution = {
      id: 'test/proto-named',
      methodsFor: (model) =>
        model.name === 'User' ? Object.fromEntries([['__proto__', body]]) : {},
    };
    const table = collectionMethodTable(
      { ...context, collectionMethods: [fullText, protoNamed] },
      'public',
      'User',
    );

    expect({
      own: Object.hasOwn(table, '__proto__'),
      prototype: Object.getPrototypeOf(table),
    }).toEqual({ own: true, prototype: null });
  });

  it('accepts a context with no contributions', () => {
    const client = orm({ runtime, context: { ...context, collectionMethods: [] } });
    expect(Object.keys(client.public.User.using)).toEqual([]);
  });
});
