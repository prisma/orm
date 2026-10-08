import { describe, expectTypeOf, test } from 'vitest';
import type { Filtered, Ordered } from '../src/collection-types';
import { orm } from '../src/orm';
import { createChainingOrm, PostCollection } from './collection-chaining-fixture';
import { createMockRuntime, getTestContext } from './helpers';

declare const flag: boolean;
declare const mode: 'published' | 'recent' | 'all';
declare const titles: readonly string[];

class ConditionalPostCollection extends PostCollection {
  ternaryFilteredFirst() {
    return flag ? this.published() : this;
  }

  ternaryUnfilteredFirst() {
    return flag ? this : this.published();
  }

  earlyReturn() {
    if (!flag) return this;
    return this.published();
  }

  switchOnMode() {
    switch (mode) {
      case 'published':
        return this.published();
      case 'recent':
        return this.recent();
      default:
        return this;
    }
  }

  loop() {
    let posts = this;
    for (const title of titles) posts = posts.where({ title });
    return posts;
  }

  letWithIf() {
    let posts = this;
    if (flag) posts = posts.published();
    return posts;
  }
}

const { plain, db } = createChainingOrm();
type PlainPost = typeof plain.Post;
const Post = db.Post;
const classDb = orm({
  runtime: createMockRuntime(),
  context: getTestContext(),
  collections: { Post: ConditionalPostCollection },
}).public;

declare const filtered: Filtered<PostCollection>;
declare const unfiltered: PostCollection;

describe('a collection with a fact is a subtype of the same collection without it', () => {
  test('Filtered<C> is assignable to C, and C is not assignable to Filtered<C>', () => {
    expectTypeOf<Filtered<PostCollection>>().toExtend<PostCollection>();
    expectTypeOf<PostCollection>().not.toExtend<Filtered<PostCollection>>();
  });

  test('Ordered<C> is assignable to C, and C is not assignable to Ordered<C>', () => {
    expectTypeOf<Ordered<PostCollection>>().toExtend<PostCollection>();
    expectTypeOf<PostCollection>().not.toExtend<Ordered<PostCollection>>();
  });

  test('a ternary between C and Filtered<C> has type C', () => {
    expectTypeOf(flag ? filtered : unfiltered).toEqualTypeOf<PostCollection>();
    expectTypeOf(flag ? unfiltered : filtered).toEqualTypeOf<PostCollection>();
  });
});

describe('on a plain collection, every conditional form reduces to the root', () => {
  test('ternary, filtered branch first', () => {
    const posts = flag ? plain.Post.where({ title: 'x' }) : plain.Post;
    expectTypeOf(posts).toEqualTypeOf<PlainPost>();
    // @ts-expect-error the collection may have no filter
    posts.deleteAll();
  });

  test('ternary, unfiltered branch first', () => {
    const posts = flag ? plain.Post : plain.Post.where({ title: 'x' });
    expectTypeOf(posts).toEqualTypeOf<PlainPost>();
    // @ts-expect-error the collection may have no filter
    posts.deleteAll();
  });

  test('if with an early return', () => {
    const pick = (posts: PlainPost) => {
      if (!flag) return posts;
      return posts.where({ title: 'x' });
    };
    expectTypeOf(pick(plain.Post)).toEqualTypeOf<PlainPost>();
    // @ts-expect-error the collection may have no filter
    pick(plain.Post).deleteAll();
  });

  test('switch', () => {
    const pick = (posts: PlainPost) => {
      switch (mode) {
        case 'published':
          return posts.where({ title: 'x' });
        case 'recent':
          return posts.orderBy((p) => p.id.desc());
        default:
          return posts;
      }
    };
    expectTypeOf(pick(plain.Post)).toEqualTypeOf<PlainPost>();
    // @ts-expect-error the collection may have no filter
    pick(plain.Post).deleteAll();
  });

  test('loop', () => {
    let posts = plain.Post;
    for (const title of titles) posts = posts.where({ title });
    expectTypeOf(posts).toEqualTypeOf<PlainPost>();
    // @ts-expect-error the collection may have no filter
    posts.deleteAll();
  });

  test('let with if', () => {
    let posts = plain.Post;
    if (flag) posts = posts.where({ title: 'x' });
    expectTypeOf(posts).toEqualTypeOf<PlainPost>();
    // @ts-expect-error the collection may have no filter
    posts.deleteAll();
  });
});

describe('on a custom class, every conditional form reduces to the class', () => {
  test('ternary, filtered branch first', () => {
    const posts = flag ? Post.published() : Post;
    expectTypeOf(posts).toEqualTypeOf<PostCollection>();
    expectTypeOf(posts.recent().include('author').all()).not.toBeAny();
    // @ts-expect-error the collection may have no filter
    posts.deleteAll();
  });

  test('ternary, unfiltered branch first', () => {
    const posts = flag ? Post : Post.published();
    expectTypeOf(posts).toEqualTypeOf<PostCollection>();
    // @ts-expect-error the collection may have no filter
    posts.deleteAll();
  });

  test('if with an early return', () => {
    const pick = (posts: PostCollection) => {
      if (!flag) return posts;
      return posts.published();
    };
    expectTypeOf(pick(Post)).toEqualTypeOf<PostCollection>();
    // @ts-expect-error the collection may have no filter
    pick(Post).deleteAll();
  });

  test('switch', () => {
    const pick = (posts: PostCollection) => {
      switch (mode) {
        case 'published':
          return posts.published();
        case 'recent':
          return posts.recent();
        default:
          return posts;
      }
    };
    expectTypeOf(pick(Post)).toEqualTypeOf<PostCollection>();
    // @ts-expect-error the collection may have no filter
    pick(Post).deleteAll();
  });

  test('loop', () => {
    let posts = Post;
    for (const title of titles) posts = posts.where({ title });
    expectTypeOf(posts).toEqualTypeOf<PostCollection>();
    // @ts-expect-error the collection may have no filter
    posts.deleteAll();
  });

  test('let with if', () => {
    let posts = Post;
    if (flag) posts = posts.published();
    if (flag) posts = posts.recent().limit(3);
    expectTypeOf(posts).toEqualTypeOf<PostCollection>();
    // @ts-expect-error the collection may have no filter
    posts.deleteAll();
  });

  test('a function whose every path filters keeps the filter', () => {
    const pick = (posts: PostCollection) => (flag ? posts.published() : posts.where({ id: 1 }));
    expectTypeOf(pick(Post).deleteAll()).not.toBeAny();
  });

  test('annotating a filter-against-order union as the class reduces it', () => {
    const posts: PostCollection = flag ? Post.published() : Post.recent();
    expectTypeOf(posts).toEqualTypeOf<PostCollection>();
    // @ts-expect-error the collection may have no filter
    posts.deleteAll();
  });

  test('a filter against an order keeps a union that still chains', () => {
    const posts = flag ? Post.published() : Post.recent();
    expectTypeOf(posts.published().recent()).toExtend<PostCollection>();
    expectTypeOf(posts.include('author').all()).not.toBeAny();
    expectTypeOf(posts.select('id').all()).not.toBeAny();
    // @ts-expect-error cursor needs an orderBy on every branch
    posts.cursor({ id: 1 });
    // @ts-expect-error update needs a where on every branch
    posts.update({ title: 'x' });
  });
});

describe('inside a class method, every conditional form on this reduces to the class', () => {
  const Posts = classDb.Post;

  test('each form returns the class', () => {
    expectTypeOf(Posts.ternaryFilteredFirst()).toEqualTypeOf<ConditionalPostCollection>();
    expectTypeOf(Posts.ternaryUnfilteredFirst()).toEqualTypeOf<ConditionalPostCollection>();
    expectTypeOf(Posts.earlyReturn()).toEqualTypeOf<ConditionalPostCollection>();
    expectTypeOf(Posts.switchOnMode()).toEqualTypeOf<ConditionalPostCollection>();
    expectTypeOf(Posts.loop()).toEqualTypeOf<ConditionalPostCollection>();
    expectTypeOf(Posts.letWithIf()).toEqualTypeOf<ConditionalPostCollection>();
  });

  test('each refuses deleteAll', () => {
    // @ts-expect-error the collection may have no filter
    Posts.ternaryFilteredFirst().deleteAll();
    // @ts-expect-error the collection may have no filter
    Posts.ternaryUnfilteredFirst().deleteAll();
    // @ts-expect-error the collection may have no filter
    Posts.earlyReturn().deleteAll();
    // @ts-expect-error the collection may have no filter
    Posts.switchOnMode().deleteAll();
    // @ts-expect-error the collection may have no filter
    Posts.loop().deleteAll();
    // @ts-expect-error the collection may have no filter
    Posts.letWithIf().deleteAll();
  });
});

describe('inside with, every conditional form reduces to the receiver', () => {
  test('ternary, filtered branch first', () => {
    const posts = Post.with((c) => (flag ? c.published() : c));
    expectTypeOf(posts).toEqualTypeOf<PostCollection>();
    // @ts-expect-error the collection may have no filter
    posts.deleteAll();
  });

  test('ternary, unfiltered branch first', () => {
    const posts = Post.with((c) => (flag ? c : c.published()));
    expectTypeOf(posts).toEqualTypeOf<PostCollection>();
    // @ts-expect-error the collection may have no filter
    posts.deleteAll();
  });

  test('if with an early return', () => {
    const posts = Post.with((c) => {
      if (!flag) return c;
      return c.published();
    });
    expectTypeOf(posts).toEqualTypeOf<PostCollection>();
    // @ts-expect-error the collection may have no filter
    posts.deleteAll();
  });

  test('switch', () => {
    const posts = Post.with((c) => {
      switch (mode) {
        case 'published':
          return c.published();
        case 'recent':
          return c.recent();
        default:
          return c;
      }
    });
    expectTypeOf(posts).toEqualTypeOf<PostCollection>();
    // @ts-expect-error the collection may have no filter
    posts.deleteAll();
  });

  test('loop', () => {
    const posts = Post.with((c) => {
      let filtered = c;
      for (const title of titles) filtered = filtered.where({ title });
      return filtered;
    });
    expectTypeOf(posts).toEqualTypeOf<PostCollection>();
    // @ts-expect-error the collection may have no filter
    posts.deleteAll();
  });

  test('let with if', () => {
    const posts = Post.with((c) => {
      let filtered = c;
      if (flag) filtered = filtered.published();
      return filtered;
    });
    expectTypeOf(posts).toEqualTypeOf<PostCollection>();
    // @ts-expect-error the collection may have no filter
    posts.deleteAll();
  });

  test('a filter on the plain collection', () => {
    const posts = plain.Post.with((c) => (flag ? c.where({ title: 'x' }) : c));
    expectTypeOf(posts).toEqualTypeOf<PlainPost>();
    // @ts-expect-error the collection may have no filter
    posts.deleteAll();
  });
});
