import type { JsonValue } from '@internal/utils/json';
import { describe, expectTypeOf, test } from 'vitest';
import { Collection } from '../src/collection';
import { createMockRuntime, getTestContext } from './helpers';

describe('Collection result types are simplified', () => {
  const runtime = createMockRuntime();
  const context = getTestContext();

  test('default Row is a plain object', () => {
    const users = new Collection({ runtime, context }, 'User', { namespaceId: 'public' });
    type UserRow = Awaited<ReturnType<typeof users.first>>;
    expectTypeOf<NonNullable<UserRow>>().toEqualTypeOf<{
      id: number;
      name: string;
      email: string;
      invitedById: number | null;
      address: JsonValue | null;
    }>();
  });

  test('select() produces a plain object', () => {
    const users = new Collection({ runtime, context }, 'User', { namespaceId: 'public' });
    const selected = users.select('id', 'email');
    type SelectedRow = Awaited<ReturnType<typeof selected.first>>;
    expectTypeOf<NonNullable<SelectedRow>>().toEqualTypeOf<{
      id: number;
      email: string;
    }>();
  });

  test('include() produces a plain object with nested relation', () => {
    const users = new Collection({ runtime, context }, 'User', { namespaceId: 'public' });
    const withPosts = users.include('posts');
    type WithPostsRow = Awaited<ReturnType<typeof withPosts.first>>;
    expectTypeOf<NonNullable<WithPostsRow>>().toEqualTypeOf<{
      id: number;
      name: string;
      email: string;
      invitedById: number | null;
      address: JsonValue | null;
      posts: {
        id: number;
        title: string;
        userId: number;
        views: number;
        embedding: number[] | null;
      }[];
    }>();
  });

  test('select().include() produces a plain object', () => {
    const users = new Collection({ runtime, context }, 'User', { namespaceId: 'public' });
    const selected = users.select('name').include('posts');
    type Row = Awaited<ReturnType<typeof selected.first>>;
    expectTypeOf<NonNullable<Row>>().toEqualTypeOf<{
      name: string;
      posts: {
        id: number;
        title: string;
        userId: number;
        views: number;
        embedding: number[] | null;
      }[];
    }>();
  });

  test('include() with non-nullable to-one relation', () => {
    const posts = new Collection({ runtime, context }, 'Post', { namespaceId: 'public' });
    const withAuthor = posts.include('author');
    type Row = Awaited<ReturnType<typeof withAuthor.first>>;
    type AuthorField = NonNullable<Row>['author'];
    expectTypeOf<AuthorField>().toEqualTypeOf<{
      id: number;
      name: string;
      email: string;
      invitedById: number | null;
      address: JsonValue | null;
    }>();
  });

  test('chained include() produces a plain object', () => {
    const users = new Collection({ runtime, context }, 'User', { namespaceId: 'public' });
    const withPostsAndInviter = users.include('posts').include('invitedBy');
    type Row = Awaited<ReturnType<typeof withPostsAndInviter.first>>;
    expectTypeOf<NonNullable<Row>>().toEqualTypeOf<{
      id: number;
      name: string;
      email: string;
      invitedById: number | null;
      address: JsonValue | null;
      posts: {
        id: number;
        title: string;
        userId: number;
        views: number;
        embedding: number[] | null;
      }[];
      invitedBy: {
        id: number;
        name: string;
        email: string;
        invitedById: number | null;
        address: JsonValue | null;
      } | null;
    }>();
  });

  test('include() with count refinement', () => {
    const users = new Collection({ runtime, context }, 'User', { namespaceId: 'public' });
    const withPostCount = users.include('posts', (posts) => posts.count());
    type Row = Awaited<ReturnType<typeof withPostCount.first>>;
    expectTypeOf<NonNullable<Row>['posts']>().toEqualTypeOf<number>();
  });
});
