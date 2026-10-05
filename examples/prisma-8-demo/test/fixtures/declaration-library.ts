import type { Runtime } from '@prisma/orm-postgres/family-runtime';
import { Collection, type Filtered, orm } from '@prisma/orm-postgres/orm-client';
import type { ExecutionContext } from '@prisma/orm-postgres/relational-core/query-lane-context';
import type { Contract } from '../../src/prisma/contract.d';

export class PostLibrary extends Collection<Contract, 'Post'> {
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
    return this.apply((posts) => posts.filtered().orderBy((post) => post.createdAt.desc()));
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
    return this.variant('Bug');
  }

  bugRows() {
    return this.variant('Bug').all();
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

declare const runtime: Runtime;
declare const context: ExecutionContext<Contract>;

export const posts = orm({ runtime, context, collections: { Post: PostLibrary } }).public.Post;
export const filteredChain = posts.filtered().ordered().withUser();
export const plainChain = orm({ runtime, context }).public.Post.where({ title: 'x' });

export function filterPosts(
  collection: Collection<Contract, 'Post'>,
): Filtered<Collection<Contract, 'Post'>> {
  return collection.where({ title: 'x' });
}
