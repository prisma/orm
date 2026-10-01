import {
  type CachedRows,
  type CacheStore,
  cacheAnnotation,
  createCacheMiddleware,
} from '@internal/middleware-cache';
import type { MongoMiddleware } from '@internal/mongo-runtime';
import type { SqlMiddleware } from '@internal/sql-runtime';
import { test } from 'vitest';
import { db } from '../sql-builder/playground/preamble';

test('a CacheMiddleware fits in a SQL middleware list', () => {
  const middleware: SqlMiddleware[] = [createCacheMiddleware()];
  void middleware;
});

test('a CacheMiddleware fits in a Mongo middleware list', () => {
  const middleware: MongoMiddleware[] = [createCacheMiddleware()];
  void middleware;
});

test('a read accepts cacheAnnotation', () => {
  db.public.users.select('id').annotate(cacheAnnotation({ key: 'users' }));
});

test('a write refuses cacheAnnotation', () => {
  // @ts-expect-error - cacheAnnotation declares applicableTo: ['read'], not 'write'
  db.public.users.insert([{ name: 'Alice' }]).annotate(cacheAnnotation({}));

  // @ts-expect-error - cacheAnnotation declares applicableTo: ['read'], not 'write'
  db.public.users.update({ name: 'Alicia' }).annotate(cacheAnnotation({}));
});

interface TagMeta {
  tags: string[];
}

const tagStore: CacheStore<TagMeta, CachedRows> = {
  get: async ({ key, meta }) => ({ key, meta, version: 0, data: { empty: true } }),
  set: async () => true,
  unset: async () => {},
};

test('a CacheMiddleware with typed meta fits in SQL and Mongo middleware lists', () => {
  const sqlMiddleware: SqlMiddleware[] = [createCacheMiddleware({ store: tagStore })];
  const mongoMiddleware: MongoMiddleware[] = [createCacheMiddleware({ store: tagStore })];
  void sqlMiddleware;
  void mongoMiddleware;
});
