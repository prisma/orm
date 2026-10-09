import type { AsyncIterableResult } from '@internal/framework-components/runtime';
import { describe, expectTypeOf, test } from 'vitest';
import { Collection } from '../src/collection';
import type {
  CollectionRowOf,
  CollectionTypeStateOf,
  Ordered,
  UniquelyFiltered,
} from '../src/collection-types';
import type { PreparedCollection } from '../src/prepared-collection';
import type { CollectionTypeState } from '../src/types';
import { createChainingOrm, type PostCollection } from './collection-chaining-fixture';
import type { Contract as PolyContract } from './fixtures/polymorphism/generated/contract';
import type { TestContract } from './helpers';

const { db, plain } = createChainingOrm();
const Post = db.Post;
type Row = CollectionRowOf<PostCollection>;

class ScopedPostCollection extends Collection<TestContract, 'Post'> {
  top() {
    return this.orderBy((p) => p.views.desc())
      .limit(10)
      .offset(0);
  }

  everything() {
    return this.all();
  }

  total() {
    return this.aggregate((a) => ({ n: a.count() }));
  }

  purge() {
    return this.where({ title: 'x' }).deleteAll();
  }

  titled(title: string) {
    return this.where({ title });
  }

  perUser() {
    return this.groupBy('userId').aggregate((a) => ({ n: a.count() }));
  }

  preparedRows() {
    return this.prepared.all();
  }

  preparedTotal() {
    return this.prepared.aggregate((a) => ({ n: a.count() }));
  }

  preparedFirst() {
    return this.prepared.first();
  }
}

declare const flag: boolean;

declare const scoped: ScopedPostCollection;
declare const tasks: Collection<PolyContract, 'Task'>;
const summary = plain.Post.fragment((posts) => posts.select('id', 'title'));

describe('whereUnique', () => {
  test('returns the same class with the filter and the unique filter recorded', () => {
    const unique = Post.whereUnique({ id: 1 });
    expectTypeOf(unique).toEqualTypeOf<UniquelyFiltered<PostCollection>>();
    expectTypeOf<CollectionTypeStateOf<typeof unique>['hasWhere']>().toEqualTypeOf<true>();
    expectTypeOf<CollectionTypeStateOf<typeof unique>['uniqueFilter']>().toEqualTypeOf<true>();
    expectTypeOf(plain.Post.whereUnique({ id: 1 })).toEqualTypeOf<
      UniquelyFiltered<typeof plain.Post>
    >();
  });

  test('is callable after a filter, an order or a limit', () => {
    expectTypeOf(
      Post.published().whereUnique({ id: 1 }).first(),
    ).resolves.toEqualTypeOf<Row | null>();
    expectTypeOf(Post.recent().whereUnique({ id: 1 }).first()).resolves.toEqualTypeOf<Row | null>();
    expectTypeOf(Post.limit(1).whereUnique({ id: 1 }).first()).resolves.toEqualTypeOf<Row | null>();
  });
});

describe('single-record calls after whereUnique', () => {
  const unique = Post.whereUnique({ id: 1 });

  test('first, update and delete return the row or null', () => {
    expectTypeOf(unique.first()).resolves.toEqualTypeOf<Row | null>();
    expectTypeOf(unique.update({ title: 'x' })).resolves.toEqualTypeOf<Row | null>();
    expectTypeOf(unique.delete()).resolves.toEqualTypeOf<Row | null>();
  });

  test('a following where keeps the class and the single-record calls', () => {
    const narrowed = unique.where({ title: 'x' });
    expectTypeOf(narrowed).toEqualTypeOf<UniquelyFiltered<PostCollection>>();
    expectTypeOf(narrowed.first()).resolves.toEqualTypeOf<Row | null>();
    expectTypeOf(narrowed.update({ title: 'y' })).resolves.toEqualTypeOf<Row | null>();
    expectTypeOf(narrowed.delete()).resolves.toEqualTypeOf<Row | null>();
  });

  test('a class method stays callable', () => {
    expectTypeOf(unique.published().first()).resolves.toEqualTypeOf<Row | null>();
    expectTypeOf(unique.recent().first()).resolves.toEqualTypeOf<Row | null>();
  });

  test('variant narrows the row', async () => {
    const bug = await tasks.whereUnique({ id: 1 }).variant('bug').first();
    expectTypeOf(bug).not.toBeAny();
    expectTypeOf(bug).toExtend<{ id: number; severity: string } | null>();
  });

  test('include adds the relation to the row, as after where', async () => {
    const included = unique.include('author');
    const filtered = Post.where({ id: 1 }).include('author');
    expectTypeOf(included.first()).toEqualTypeOf(filtered.first());
    expectTypeOf(included.update({ title: 'x' })).toEqualTypeOf(filtered.update({ title: 'x' }));
    expectTypeOf(included.delete()).toEqualTypeOf(filtered.delete());
    const row = await included.first();
    expectTypeOf(row).not.toBeAny();
    expectTypeOf(row).toExtend<{ id: number; author: { name: string } } | null>();
  });

  test('select narrows the row', () => {
    expectTypeOf(unique.select('id', 'title').first()).resolves.toEqualTypeOf<{
      id: number;
      title: string;
    } | null>();
    expectTypeOf(unique.select('id').delete()).resolves.toEqualTypeOf<{ id: number } | null>();
  });

  test('with accepts the collection', () => {
    expectTypeOf(unique.with((posts) => posts)).toEqualTypeOf(unique);
    expectTypeOf(
      unique.with((posts) => posts.where({ title: 'x' })).first(),
    ).resolves.toEqualTypeOf<Row | null>();
    expectTypeOf(unique.with(summary).first()).resolves.toEqualTypeOf<{
      id: number;
      title: string;
    } | null>();
  });

  test('a row lock keeps the row', () => {
    expectTypeOf(unique.forUpdate().first()).resolves.toEqualTypeOf<Row | null>();
    expectTypeOf(unique.forNoKeyUpdate().first()).resolves.toEqualTypeOf<Row | null>();
    expectTypeOf(unique.forShare().first()).resolves.toEqualTypeOf<Row | null>();
    expectTypeOf(unique.forKeyShare().first()).resolves.toEqualTypeOf<Row | null>();
  });
});

describe('many-record calls after whereUnique', () => {
  const unique = Post.whereUnique({ id: 1 });
  const ordered = Post.recent().whereUnique({ id: 1 });

  test('the calls that change which rows are read are refused', () => {
    // @ts-expect-error orderBy needs a collection without a unique filter
    unique.orderBy((p) => p.views.desc());
    // @ts-expect-error limit needs a collection without a unique filter
    unique.limit(1);
    // @ts-expect-error offset needs a collection without a unique filter
    unique.offset(1);
    // @ts-expect-error cursor needs a collection without a unique filter
    ordered.cursor({ views: 1 });
    // @ts-expect-error distinct needs a collection without a unique filter
    unique.distinct('title');
    // @ts-expect-error distinctOn needs a collection without a unique filter
    ordered.distinctOn('title');
  });

  test('the calls that return rows or a count are refused', () => {
    // @ts-expect-error all needs a collection without a unique filter
    unique.all();
    // @ts-expect-error aggregate needs a collection without a unique filter
    unique.aggregate((a) => ({ n: a.count() }));
    // @ts-expect-error updateAll needs a collection without a unique filter
    unique.updateAll({ title: 'x' });
    // @ts-expect-error updateAndCount needs a collection without a unique filter
    unique.updateAndCount({ title: 'x' });
    // @ts-expect-error deleteAll needs a collection without a unique filter
    unique.deleteAll();
    // @ts-expect-error deleteAndCount needs a collection without a unique filter
    unique.deleteAndCount();
  });

  test('refused after a following where', () => {
    const narrowed = unique.where({ title: 'x' });
    const narrowedOrdered = ordered.where({ title: 'x' });
    // @ts-expect-error orderBy needs a collection without a unique filter
    narrowed.orderBy((p) => p.views.desc());
    // @ts-expect-error limit needs a collection without a unique filter
    narrowed.limit(1);
    // @ts-expect-error offset needs a collection without a unique filter
    narrowed.offset(1);
    // @ts-expect-error cursor needs a collection without a unique filter
    narrowedOrdered.cursor({ views: 1 });
    // @ts-expect-error distinct needs a collection without a unique filter
    narrowed.distinct('title');
    // @ts-expect-error distinctOn needs a collection without a unique filter
    narrowedOrdered.distinctOn('title');
    // @ts-expect-error all needs a collection without a unique filter
    narrowed.all();
    // @ts-expect-error aggregate needs a collection without a unique filter
    narrowed.aggregate((a) => ({ n: a.count() }));
    // @ts-expect-error updateAll needs a collection without a unique filter
    narrowed.updateAll({ title: 'x' });
    // @ts-expect-error updateAndCount needs a collection without a unique filter
    narrowed.updateAndCount({ title: 'x' });
    // @ts-expect-error deleteAll needs a collection without a unique filter
    narrowed.deleteAll();
    // @ts-expect-error deleteAndCount needs a collection without a unique filter
    narrowed.deleteAndCount();
  });

  test('refused after a following include', () => {
    const included = unique.include('author');
    const includedOrdered = ordered.include('author');
    // @ts-expect-error orderBy needs a collection without a unique filter
    included.orderBy((p) => p.views.desc());
    // @ts-expect-error limit needs a collection without a unique filter
    included.limit(1);
    // @ts-expect-error offset needs a collection without a unique filter
    included.offset(1);
    // @ts-expect-error cursor needs a collection without a unique filter
    includedOrdered.cursor({ views: 1 });
    // @ts-expect-error distinct needs a collection without a unique filter
    included.distinct('title');
    // @ts-expect-error distinctOn needs a collection without a unique filter
    includedOrdered.distinctOn('title');
    // @ts-expect-error all needs a collection without a unique filter
    included.all();
    // @ts-expect-error aggregate needs a collection without a unique filter
    included.aggregate((a) => ({ n: a.count() }));
    // @ts-expect-error updateAll needs a collection without a unique filter
    included.updateAll({ title: 'x' });
    // @ts-expect-error updateAndCount needs a collection without a unique filter
    included.updateAndCount({ title: 'x' });
    // @ts-expect-error deleteAll needs a collection without a unique filter
    included.deleteAll();
    // @ts-expect-error deleteAndCount needs a collection without a unique filter
    included.deleteAndCount();
  });

  test('refused after a following select', () => {
    const selected = unique.select('id', 'title');
    const selectedOrdered = ordered.select('id', 'title');
    // @ts-expect-error orderBy needs a collection without a unique filter
    selected.orderBy((p) => p.views.desc());
    // @ts-expect-error limit needs a collection without a unique filter
    selected.limit(1);
    // @ts-expect-error offset needs a collection without a unique filter
    selected.offset(1);
    // @ts-expect-error cursor needs a collection without a unique filter
    selectedOrdered.cursor({ views: 1 });
    // @ts-expect-error distinct needs a collection without a unique filter
    selected.distinct('title');
    // @ts-expect-error distinctOn needs a collection without a unique filter
    selectedOrdered.distinctOn('title');
    // @ts-expect-error all needs a collection without a unique filter
    selected.all();
    // @ts-expect-error aggregate needs a collection without a unique filter
    selected.aggregate((a) => ({ n: a.count() }));
    // @ts-expect-error updateAll needs a collection without a unique filter
    selected.updateAll({ title: 'x' });
    // @ts-expect-error updateAndCount needs a collection without a unique filter
    selected.updateAndCount({ title: 'x' });
    // @ts-expect-error deleteAll needs a collection without a unique filter
    selected.deleteAll();
    // @ts-expect-error deleteAndCount needs a collection without a unique filter
    selected.deleteAndCount();
  });

  test('refused after a class method, a variant and on the plain collection', () => {
    // @ts-expect-error all needs a collection without a unique filter
    unique.published().all();
    // @ts-expect-error all needs a collection without a unique filter
    tasks.whereUnique({ id: 1 }).variant('bug').all();
    // @ts-expect-error all needs a collection without a unique filter
    plain.Post.whereUnique({ id: 1 }).all();
    // @ts-expect-error limit needs a collection without a unique filter
    plain.Post.whereUnique({ id: 1 }).limit(1);
  });

  test('refused when whereUnique follows a filter', () => {
    // @ts-expect-error deleteAll needs a collection without a unique filter
    Post.published().whereUnique({ id: 1 }).deleteAll();
    // @ts-expect-error limit needs a collection without a unique filter
    Post.published().whereUnique({ id: 1 }).limit(1);
  });
});

describe('the whereUnique argument', () => {
  test('accepts a primary key and a unique constraint', () => {
    expectTypeOf(plain.User.whereUnique({ id: 1 })).not.toBeAny();
    expectTypeOf(plain.User.whereUnique({ email: 'a@example.com' })).not.toBeAny();
  });

  test('accepts a compound key', () => {
    expectTypeOf(plain.Project.whereUnique({ tenantId: 1, id: 1 })).toEqualTypeOf<
      UniquelyFiltered<typeof plain.Project>
    >();
  });

  test('refuses a field that is not unique', () => {
    // @ts-expect-error title is not a unique constraint
    Post.whereUnique({ title: 'x' });
    // @ts-expect-error name is not a unique constraint
    plain.User.whereUnique({ name: 'x' });
  });

  test('refuses a partial compound key', () => {
    // @ts-expect-error the key is tenantId and id
    plain.Project.whereUnique({ tenantId: 1 });
    // @ts-expect-error the key is tenantId and id
    plain.Project.whereUnique({ id: 1 });
  });

  test('refuses a callback', () => {
    // @ts-expect-error whereUnique takes an object
    Post.whereUnique((p) => p.id.eq(1));
  });
});

describe('whereUnique inside an include refinement', () => {
  test('is not on the refinement collection', () => {
    expectTypeOf(plain.User.include('posts', (posts) => posts.where({ id: 1 }))).not.toBeAny();
    // @ts-expect-error whereUnique is not available inside an include refinement
    plain.User.include('posts', (posts) => posts.whereUnique({ id: 1 }));
    // @ts-expect-error whereUnique is not available inside an include refinement
    plain.Post.include('author', (author) => author.whereUnique({ id: 1 }));
  });
});

describe('a class whose methods call many-record methods on this', () => {
  test('the methods keep their types', () => {
    expectTypeOf(scoped.top().all()).toEqualTypeOf<AsyncIterableResult<Row>>();
    expectTypeOf(scoped.top().titled('x')).toExtend<ScopedPostCollection>();
    expectTypeOf(scoped.everything()).toEqualTypeOf<AsyncIterableResult<Row>>();
    expectTypeOf(scoped.total()).resolves.toEqualTypeOf<{ n: number }>();
    expectTypeOf(scoped.purge()).toEqualTypeOf<AsyncIterableResult<Row>>();
  });

  test('the methods are callable after whereUnique', () => {
    const unique = scoped.whereUnique({ id: 1 });
    expectTypeOf(unique.titled('x').first()).resolves.toEqualTypeOf<Row | null>();
    expectTypeOf(unique.top().first()).resolves.toEqualTypeOf<Row | null>();
    expectTypeOf(unique.everything()).toEqualTypeOf<AsyncIterableResult<Row>>();
    expectTypeOf(unique.total()).resolves.toEqualTypeOf<{ n: number }>();
    expectTypeOf(unique.purge()).toEqualTypeOf<AsyncIterableResult<Row>>();
  });
});

describe('collections without whereUnique', () => {
  test('keep the many-record methods', () => {
    expectTypeOf(Post.published().recent().limit(5).offset(1).all()).toEqualTypeOf<
      AsyncIterableResult<Row>
    >();
    expectTypeOf(Post.recent().cursor({ views: 1 }).distinctOn('title')).toExtend<PostCollection>();
    expectTypeOf(
      Post.distinct('title').aggregate((a) => ({ n: a.count() })),
    ).resolves.toEqualTypeOf<{
      n: number;
    }>();
    expectTypeOf(Post.where({ id: 1 }).deleteAll()).toEqualTypeOf<AsyncIterableResult<Row>>();
    expectTypeOf(
      Post.where({ id: 1 }).updateAndCount({ title: 'x' }),
    ).resolves.toEqualTypeOf<number>();
  });
});

describe('groupBy', () => {
  const unique = Post.whereUnique({ id: 1 });

  test('refused after whereUnique', () => {
    // @ts-expect-error groupBy needs a collection without a unique filter
    unique.groupBy('userId');
    // @ts-expect-error groupBy needs a collection without a unique filter
    unique.where({ title: 'x' }).groupBy('userId');
    // @ts-expect-error groupBy needs a collection without a unique filter
    unique.include('author').groupBy('userId');
    // @ts-expect-error groupBy needs a collection without a unique filter
    unique.select('id').groupBy('userId');
    // @ts-expect-error groupBy needs a collection without a unique filter
    plain.Post.whereUnique({ id: 1 }).groupBy('userId');
  });

  test('accepted on a collection without a unique filter', () => {
    type Groups = Array<{ userId: number; n: number }>;
    const count = (a: Parameters<Parameters<PostCollection['aggregate']>[0]>[0]) => ({
      n: a.count(),
    });
    expectTypeOf(Post.groupBy('userId').aggregate(count)).resolves.toEqualTypeOf<Groups>();
    expectTypeOf(
      Post.published().recent().limit(5).groupBy('userId').aggregate(count),
    ).resolves.toEqualTypeOf<Groups>();
    expectTypeOf(plain.Post.groupBy('userId').aggregate(count)).resolves.toEqualTypeOf<Groups>();
    expectTypeOf(
      Post.where({ id: 1 }).include('author').groupBy('userId').aggregate(count),
    ).resolves.toEqualTypeOf<Groups>();
  });

  test('accepted on a union of collections and on an Omit of a collection', () => {
    const either = flag ? Post.published() : Post.recent();
    expectTypeOf(either.groupBy('userId')).toEqualTypeOf(Post.groupBy('userId'));
    const partial: Omit<PostCollection, 'all'> = Post;
    expectTypeOf(partial.groupBy('userId')).toEqualTypeOf(Post.groupBy('userId'));
  });

  test('accepted on this in a class', () => {
    expectTypeOf(scoped.perUser()).resolves.toEqualTypeOf<Array<{ userId: number; n: number }>>();
    expectTypeOf(scoped.whereUnique({ id: 1 }).perUser()).resolves.toEqualTypeOf<
      Array<{ userId: number; n: number }>
    >();
  });
});

describe('prepared', () => {
  const unique = Post.whereUnique({ id: 1 });
  const count = (a: Parameters<Parameters<PostCollection['aggregate']>[0]>[0]) => ({
    n: a.count(),
  });

  test('all and aggregate are refused after whereUnique', () => {
    // @ts-expect-error prepared.all needs a collection without a unique filter
    unique.prepared.all();
    // @ts-expect-error prepared.aggregate needs a collection without a unique filter
    unique.prepared.aggregate(count);
    // @ts-expect-error prepared.all needs a collection without a unique filter
    unique.where({ title: 'x' }).prepared.all();
    // @ts-expect-error prepared.aggregate needs a collection without a unique filter
    unique.where({ title: 'x' }).prepared.aggregate(count);
    // @ts-expect-error prepared.all needs a collection without a unique filter
    unique.select('id').prepared.all();
    // @ts-expect-error prepared.all needs a collection without a unique filter
    plain.Post.whereUnique({ id: 1 }).prepared.all();
    const prepared = unique.prepared;
    // @ts-expect-error prepared.all needs a collection without a unique filter
    prepared.all();
  });

  test('first after whereUnique has the type it has after where', () => {
    expectTypeOf(unique.prepared.first()).toEqualTypeOf(Post.where({ id: 1 }).prepared.first());
    expectTypeOf(unique.prepared.first().consume).returns.toEqualTypeOf<Promise<Row | null>>();
    expectTypeOf(unique.prepared.first({ title: 'x' }).consume).returns.toEqualTypeOf<
      Promise<Row | null>
    >();
    expectTypeOf(unique.select('id').prepared.first()).toEqualTypeOf(
      Post.where({ id: 1 }).select('id').prepared.first(),
    );
  });

  test('every call keeps its type on a collection without a unique filter', () => {
    const filtered = Post.where({ id: 1 });
    expectTypeOf(Post.prepared.all().consume).returns.toEqualTypeOf<AsyncIterableResult<Row>>();
    expectTypeOf(filtered.prepared.all().consume).returns.toEqualTypeOf<AsyncIterableResult<Row>>();
    expectTypeOf(filtered.prepared.aggregate(count).consume).returns.toEqualTypeOf<
      Promise<{ n: number }>
    >();
    expectTypeOf(filtered.prepared.first().consume).returns.toEqualTypeOf<Promise<Row | null>>();
    expectTypeOf(plain.Post.select('id').prepared.all().consume).returns.toEqualTypeOf<
      AsyncIterableResult<{ id: number }>
    >();
  });

  test('every call keeps its type on this in a class', () => {
    expectTypeOf(scoped.preparedRows().consume).returns.toEqualTypeOf<AsyncIterableResult<Row>>();
    expectTypeOf(scoped.preparedTotal().consume).returns.toEqualTypeOf<Promise<{ n: number }>>();
    expectTypeOf(scoped.preparedFirst().consume).returns.toEqualTypeOf<Promise<Row | null>>();
  });

  test('every call keeps its type on a union of collections and on an Omit of a collection', () => {
    const either = flag ? Post.published() : Post.recent();
    expectTypeOf(either.prepared.all().consume).returns.toEqualTypeOf<AsyncIterableResult<Row>>();
    expectTypeOf(either.prepared.aggregate(count).consume).returns.toEqualTypeOf<
      Promise<{ n: number }>
    >();
    expectTypeOf(either.prepared.first().consume).returns.toEqualTypeOf<Promise<Row | null>>();
    const partial: Omit<PostCollection, 'all'> = Post;
    expectTypeOf(partial.prepared.all().consume).returns.toEqualTypeOf<AsyncIterableResult<Row>>();
    expectTypeOf(partial.prepared.aggregate(count).consume).returns.toEqualTypeOf<
      Promise<{ n: number }>
    >();
    expectTypeOf(partial.prepared.first().consume).returns.toEqualTypeOf<Promise<Row | null>>();
  });

  test('a prepared value kept in a variable is callable later', () => {
    const prepared = Post.prepared;
    expectTypeOf(prepared.all().consume).returns.toEqualTypeOf<AsyncIterableResult<Row>>();
    expectTypeOf(prepared.aggregate(count).consume).returns.toEqualTypeOf<Promise<{ n: number }>>();
    expectTypeOf(prepared.first().consume).returns.toEqualTypeOf<Promise<Row | null>>();
    const { all } = Post.where({ id: 1 }).prepared;
    expectTypeOf(all).not.toBeAny();
  });

  test('is assignable to the prepared type of any row and state', () => {
    type AnyPrepared = PreparedCollection<TestContract, 'Post', unknown, CollectionTypeState>;
    expectTypeOf(Post.prepared).toExtend<AnyPrepared>();
    expectTypeOf(unique.prepared).toExtend<AnyPrepared>();
  });
});

describe('a uniquely filtered collection among other collections', () => {
  test('is assignable to the collection type of any row and state, as a filtered one is', () => {
    type AnyPostCollection = Collection<TestContract, 'Post', unknown, CollectionTypeState>;
    expectTypeOf(Post.where({ id: 1 })).toExtend<AnyPostCollection>();
    expectTypeOf(Post.whereUnique({ id: 1 })).toExtend<AnyPostCollection>();
    expectTypeOf(plain.Post.where({ id: 1 })).toExtend<AnyPostCollection>();
    expectTypeOf(plain.Post.whereUnique({ id: 1 })).toExtend<AnyPostCollection>();
  });

  test('all after a row lock is not refused', () => {
    const unique = Post.whereUnique({ id: 1 });
    expectTypeOf(unique.forUpdate().all()).toEqualTypeOf<AsyncIterableResult<Row>>();
    expectTypeOf(unique.forNoKeyUpdate().all()).toEqualTypeOf<AsyncIterableResult<Row>>();
    expectTypeOf(unique.forShare().all()).toEqualTypeOf<AsyncIterableResult<Row>>();
    expectTypeOf(unique.forKeyShare().all()).toEqualTypeOf<AsyncIterableResult<Row>>();
  });

  test('all after with() of a fragment made by collection.fragment is not refused', () => {
    expectTypeOf(Post.whereUnique({ id: 1 }).with(summary).all()).toEqualTypeOf<
      AsyncIterableResult<{ id: number; title: string }>
    >();
  });

  test('a conditional that mixes it with another collection keeps the many-record methods', () => {
    const either = flag ? Post.whereUnique({ id: 1 }) : Post.published();
    expectTypeOf(either.limit(1)).not.toBeAny();
    expectTypeOf(either.all()).toEqualTypeOf<AsyncIterableResult<Row>>();
    expectTypeOf(either.deleteAll()).toEqualTypeOf<AsyncIterableResult<Row>>();
  });
});

class ClassBodyPostCollection extends Collection<TestContract, 'Post'> {
  allAfterWhereUnique() {
    // @ts-expect-error all needs a collection without a unique filter
    return this.whereUnique({ id: 1 }).all();
  }

  limitAfterWhereUnique() {
    // @ts-expect-error limit needs a collection without a unique filter
    return this.whereUnique({ id: 1 }).limit(1);
  }

  orderByAfterWhereUnique() {
    // @ts-expect-error orderBy needs a collection without a unique filter
    return this.whereUnique({ id: 1 }).orderBy((p) => p.views.desc());
  }

  aggregateAfterWhereUnique() {
    // @ts-expect-error aggregate needs a collection without a unique filter
    return this.whereUnique({ id: 1 }).aggregate((a) => ({ n: a.count() }));
  }

  groupByAfterWhereUnique() {
    // @ts-expect-error groupBy needs a collection without a unique filter
    return this.whereUnique({ id: 1 }).groupBy('userId');
  }

  deleteAllAfterWhereUnique() {
    // @ts-expect-error deleteAll needs a collection without a unique filter
    return this.whereUnique({ id: 1 }).deleteAll();
  }

  distinctAfterWhereUnique() {
    // @ts-expect-error distinct needs a collection without a unique filter
    return this.whereUnique({ id: 1 }).distinct('title');
  }

  updateAllAfterWhereUniqueAndWhere() {
    const one = this.whereUnique({ id: 1 }).where({ title: 'x' });
    // @ts-expect-error updateAll needs a collection without a unique filter
    return one.updateAll({ title: 'y' });
  }

  limitAfterWhereUniqueAndWhere() {
    const one = this.whereUnique({ id: 1 }).where({ title: 'x' });
    // @ts-expect-error limit needs a collection without a unique filter
    return one.limit(1);
  }

  offsetOnStoredValue() {
    const one = this.whereUnique({ id: 1 });
    // @ts-expect-error offset needs a collection without a unique filter
    return one.offset(1);
  }

  cursorAfterOrderByAndWhereUnique() {
    const one = this.orderBy((p) => p.views.desc()).whereUnique({ id: 1 });
    // @ts-expect-error cursor needs a collection without a unique filter
    return one.cursor({ views: 1 });
  }

  allAfterWhereUniqueAndInclude() {
    const one = this.whereUnique({ id: 1 }).include('author');
    // @ts-expect-error all needs a collection without a unique filter
    return one.all();
  }

  allAfterWhereUniqueAndSelect() {
    const one = this.whereUnique({ id: 1 }).select('id');
    // @ts-expect-error all needs a collection without a unique filter
    return one.all();
  }

  limitInsideWith() {
    const one = this.whereUnique({ id: 1 });
    // @ts-expect-error limit needs a collection without a unique filter
    return one.with((posts) => posts.limit(1));
  }

  preparedAllAfterWhereUnique() {
    return this.whereUnique({ id: 1 }).prepared.all();
  }

  allAfterWhereUniqueAndOwnMethod() {
    return this.whereUnique({ id: 1 }).titled('x').all();
  }

  byId(id: number) {
    return this.whereUnique({ id });
  }

  firstById(id: number) {
    return this.whereUnique({ id }).first();
  }

  updateById(id: number) {
    return this.whereUnique({ id }).update({ title: 'y' });
  }

  deleteById(id: number) {
    return this.whereUnique({ id }).where({ title: 'x' }).delete();
  }

  byIdWithAuthor(id: number) {
    return this.whereUnique({ id }).include('author');
  }

  idOfId(id: number) {
    return this.whereUnique({ id }).select('id').first();
  }

  byIdTitled(id: number) {
    return this.whereUnique({ id }).titled('x');
  }

  titled(title: string) {
    return this.where({ title });
  }

  top() {
    return this.orderBy((p) => p.views.desc())
      .limit(10)
      .offset(0);
  }

  after(views: number) {
    return this.top().cursor({ views });
  }

  everything() {
    return this.all();
  }

  total() {
    return this.aggregate((a) => ({ n: a.count() }));
  }

  purge() {
    return this.where({ title: 'x' }).deleteAll();
  }

  preparedRows() {
    return this.prepared.all();
  }
}

declare const inClass: ClassBodyPostCollection;

describe('whereUnique on this inside a class body', () => {
  test('single-record calls keep their types', () => {
    expectTypeOf(inClass.byId(1)).toEqualTypeOf<UniquelyFiltered<ClassBodyPostCollection>>();
    expectTypeOf(inClass.firstById(1)).resolves.toEqualTypeOf<Row | null>();
    expectTypeOf(inClass.updateById(1)).resolves.toEqualTypeOf<Row | null>();
    expectTypeOf(inClass.deleteById(1)).resolves.toEqualTypeOf<Row | null>();
    expectTypeOf(inClass.idOfId(1)).resolves.toEqualTypeOf<{ id: number } | null>();
    expectTypeOf(inClass.byIdTitled(1)).toExtend<ClassBodyPostCollection>();
    expectTypeOf(inClass.byIdWithAuthor(1).first()).resolves.toExtend<{
      id: number;
      author: { name: string };
    } | null>();
  });

  test('many-record calls on this keep their types', () => {
    expectTypeOf(inClass.top()).toEqualTypeOf<Ordered<ClassBodyPostCollection>>();
    expectTypeOf(inClass.after(1)).toEqualTypeOf<Ordered<ClassBodyPostCollection>>();
    expectTypeOf(inClass.everything()).toEqualTypeOf<AsyncIterableResult<Row>>();
    expectTypeOf(inClass.total()).resolves.toEqualTypeOf<{ n: number }>();
    expectTypeOf(inClass.purge()).toEqualTypeOf<AsyncIterableResult<Row>>();
    expectTypeOf(inClass.preparedRows().consume).returns.toEqualTypeOf<AsyncIterableResult<Row>>();
  });

  test('prepared.all after whereUnique is not refused', () => {
    expectTypeOf(inClass.preparedAllAfterWhereUnique().consume).returns.toEqualTypeOf<
      AsyncIterableResult<Row>
    >();
  });

  test('all after a method of the same class called on the result is not refused', () => {
    expectTypeOf(inClass.allAfterWhereUniqueAndOwnMethod()).toEqualTypeOf<
      AsyncIterableResult<Row>
    >();
  });
});
