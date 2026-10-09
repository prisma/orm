import { field } from '@prisma/orm-postgres/contract-builder';
import type { Runtime } from '@prisma/orm-postgres/family-runtime';
import {
  type CodecField,
  type CodecListField,
  Collection,
  type Filtered,
  type ModelAccessor,
  type ModelCallbackTools,
  orderByField,
  orm,
} from '@prisma/orm-postgres/orm-client';
import type { ExecutionContext } from '@prisma/orm-postgres/relational-core/query-lane-context';
import { websearchToTsquery } from '@prisma/orm-postgres/target/full-text';
import type { Contract } from '../../src/prisma/contract.d';

type ExpiresAt = CodecField<Contract, 'pg/timestamptz-temporal@1'>;

export const notExpired = (now: Temporal.Instant) => (row: { expiresAt: ExpiresAt }) =>
  row.expiresAt.gt(now);

type Labels = CodecListField<Contract, 'pg/text@1'>;

export const labelledAs = (labels: readonly string[]) => (row: { labels: Labels }) =>
  row.labels.eq(labels);

declare const runtime: Runtime;
declare const context: ExecutionContext<Contract>;

const client = orm({ runtime, context });

export const titleSummary = client.public.Post.fragment((posts) =>
  posts.select('id', 'title').include('user'),
);

export const firstPage = client.fragment({ title: field.text() }, (rows) =>
  rows.limit(10).offset(0),
);

export const unexpiredPosts = (now: Temporal.Instant) => client.public.Post.with(unexpired(now));

export const labelled = (labels: readonly string[]) =>
  client.fragment({ labels: field.text().many() }, (rows) =>
    rows.where((row) => row.labels.eq(labels)),
  );

export const unexpired = (now: Temporal.Instant) =>
  client.fragment({ expiresAt: field.temporal.timestamptz() }, (rows) =>
    rows.where((row) => row.expiresAt.gt(now)).orderBy((row) => row.expiresAt.asc()),
  );

export const matchesSearch = (query: string) => {
  const q = websearchToTsquery(query);
  return (
    _post: ModelAccessor<Contract, 'Post'>,
    { fns, indexes }: ModelCallbackTools<Contract, 'Post'>,
  ) => fns.fullTextMatches(indexes.post_search, q);
};

export const searched = (query: string) => {
  const q = websearchToTsquery(query);
  return client.public.Post.fragment((posts) =>
    posts
      .where((_post, { fns, indexes }) => fns.fullTextMatches(indexes.post_search, q))
      .orderBy((_post, { fns, indexes }) => fns.fullTextRank(indexes.post_search, q).desc()),
  );
};

export class PostLibrary extends Collection<Contract, 'Post'> {
  live(now: Temporal.Instant) {
    return this.where(notExpired(now));
  }

  search(query: string) {
    const q = websearchToTsquery(query);
    return this.where((_post, { fns, indexes }) =>
      fns.fullTextMatches(indexes.post_search, q),
    ).orderBy((_post, { fns, indexes }) => fns.fullTextRank(indexes.post_search, q).desc());
  }

  summaries() {
    return this.with(titleSummary);
  }

  unexpired(now: Temporal.Instant) {
    return this.with(unexpired(now));
  }

  orderedBy(name: string) {
    return this.orderBy(orderByField(this, name, 'desc', ['title', 'createdAt']));
  }

  filtered() {
    return this.where({ title: 'x' });
  }

  ordered() {
    return this.orderBy((post) => post.createdAt.desc());
  }

  paged() {
    return this.limit(10).offset(5);
  }

  distinctTitles() {
    return this.distinct('title');
  }

  distinctOnTitle() {
    return this.ordered().distinctOn('title');
  }

  after(id: string) {
    return this.ordered().cursor({ id });
  }

  withUser() {
    return this.include('user');
  }

  titles() {
    return this.select('id', 'title');
  }

  applied() {
    return this.with((posts) => posts.filtered().orderBy((post) => post.createdAt.desc()));
  }

  allRows() {
    return this.all();
  }

  firstRow() {
    return this.first();
  }

  firstWithUser() {
    return this.include('user').where({ title: 'x' }).first();
  }

  preparedRows() {
    return this.filtered().prepared;
  }

  createRow() {
    return this.create({ title: 'x', userId: 'u' });
  }

  createRows() {
    return this.createAll([{ title: 'x', userId: 'u' }]);
  }

  createCount() {
    return this.createAndCount([{ title: 'x', userId: 'u' }]);
  }

  upsertRow() {
    return this.upsert({
      create: { title: 'x', userId: 'u' },
      update: { title: 'y' },
    });
  }

  updateRow() {
    return this.filtered().update({ title: 'y' });
  }

  updateRows() {
    return this.filtered().updateAll({ title: 'y' });
  }

  updateCount() {
    return this.filtered().updateAndCount({ title: 'y' });
  }

  deleteRow() {
    return this.filtered().delete();
  }

  deleteRows() {
    return this.filtered().deleteAll();
  }

  deleteCount() {
    return this.filtered().deleteAndCount();
  }

  filteredAndOrdered() {
    return this.filtered().orderBy((post) => post.createdAt.desc());
  }

  firstMatching(title: string) {
    return this.first({ title });
  }

  withUserEmail() {
    return this.include('user', (user) => user.select('id', 'email'));
  }

  firstWithUserEmail() {
    return this.withUserEmail().first();
  }

  withTagCount() {
    return this.include('tags', (tags) => tags.count());
  }

  firstWithTagCount() {
    return this.withTagCount().first();
  }

  withTagSummary() {
    return this.include('tags', (tags) =>
      tags.combine({ total: tags.count(), first: tags.limit(1) }),
    );
  }

  firstWithTagSummary() {
    return this.withTagSummary().first();
  }

  countsByUser() {
    return this.groupBy('userId').aggregate((aggregate) => ({ posts: aggregate.count() }));
  }

  totals() {
    return this.aggregate((aggregate) => ({ posts: aggregate.count() }));
  }
}

export class TaskLibrary extends Collection<Contract, 'Task'> {
  bugs() {
    return this.variant('bug');
  }

  bugRows() {
    return this.variant('bug').all();
  }
}

export class GenericLibrary<Model extends 'Post' | 'User'> extends Collection<Contract, Model> {
  rows() {
    return this.all();
  }

  firstRow() {
    return this.first();
  }
}

export class PrivateLibrary extends Collection<Contract, 'User'> {
  #label = 'users';
  private readonly limitSize = 10;

  label() {
    return this.#label;
  }

  firstPage() {
    return this.limit(this.limitSize).all();
  }
}

export class SubLibrary extends PostLibrary {
  newest() {
    return this.ordered().first();
  }
}

export const posts = orm({ runtime, context, collections: { Post: PostLibrary } }).public.Post;
export const filteredChain = posts.filtered().ordered().withUser();
export const plainChain = orm({ runtime, context }).public.Post.where({ title: 'x' });

export function filterPosts(
  collection: Collection<Contract, 'Post'>,
): Filtered<Collection<Contract, 'Post'>> {
  return collection.where({ title: 'x' });
}
