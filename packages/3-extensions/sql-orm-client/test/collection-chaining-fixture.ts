import { Collection } from '../src/collection';
import { orm } from '../src/orm';
import { createMockRuntime, getTestContext, type TestContract } from './helpers';

export class PostCollection extends Collection<TestContract, 'Post'> {
  published() {
    return this.where((p) => p.views.gte(100));
  }

  recent() {
    return this.orderBy((p) => p.views.desc());
  }
}

export class UserCollection extends Collection<TestContract, 'User'> {
  named(name: string) {
    return this.where((u) => u.name.eq(name));
  }
}

export function createChainingOrm() {
  const runtime = createMockRuntime();
  const db = orm({
    runtime,
    context: getTestContext(),
    collections: { Post: PostCollection, User: UserCollection },
  });
  const plain = orm({ runtime, context: getTestContext() });
  return { runtime, db: db.public, plain: plain.public };
}
