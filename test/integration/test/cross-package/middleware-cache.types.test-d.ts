import {
  type CachedValue,
  type CacheStore,
  cacheAnnotation,
  createCacheMiddleware,
  invalidateAnnotation,
} from '@internal/middleware-cache';
import type { MongoMiddleware } from '@internal/mongo-runtime';
import type { Collection } from '@internal/sql-orm-client';
import type { SqlMiddleware } from '@internal/sql-runtime';
import { test } from 'vitest';
import type { Contract } from '../sql-builder/fixtures/generated/contract';
import { db } from '../sql-builder/playground/preamble';

declare const users: Collection<Contract, 'User'>;

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
  db.public.users
    .insert([{ id: 1, name: 'Alice', email: 'a@b.com' }])
    // @ts-expect-error - cacheAnnotation declares applicableTo: ['read'], not 'write'
    .annotate(cacheAnnotation({}));

  // @ts-expect-error - cacheAnnotation declares applicableTo: ['read'], not 'write'
  db.public.users.update({ name: 'Alicia' }).annotate(cacheAnnotation({}));
});

interface TagMeta {
  tags: string[];
}

const tagStore: CacheStore<TagMeta, CachedValue> = {
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

const invalidate = invalidateAnnotation({ keys: ['user-1'] });

test('every ORM write terminal accepts invalidateAnnotation', () => {
  const user = { id: 9, name: 'Ada', email: 'ada@example.com' };
  users.create(user, (meta) => meta.annotate(invalidate));
  users.createAll([user], (meta) => meta.annotate(invalidate));
  users.createAndCount([user], (meta) => meta.annotate(invalidate));
  users.upsert({ create: user, update: { name: 'Ada' } }, (meta) => meta.annotate(invalidate));
  users.where({ id: 9 }).update({ name: 'Ada' }, (meta) => meta.annotate(invalidate));
  users.where({ id: 9 }).updateAll({ name: 'Ada' }, (meta) => meta.annotate(invalidate));
  users.where({ id: 9 }).updateAndCount({ name: 'Ada' }, (meta) => meta.annotate(invalidate));
  users.where({ id: 9 }).delete((meta) => meta.annotate(invalidate));
  users.where({ id: 9 }).deleteAll((meta) => meta.annotate(invalidate));
  users.where({ id: 9 }).deleteAndCount((meta) => meta.annotate(invalidate));
});

test('ORM read terminals refuse invalidateAnnotation', () => {
  // @ts-expect-error - invalidateAnnotation declares applicableTo: ['write'], not 'read'
  users.first({ id: 9 }, (meta) => meta.annotate(invalidate));

  // @ts-expect-error - invalidateAnnotation declares applicableTo: ['write'], not 'read'
  users.all((meta) => meta.annotate(invalidate));
});

test('SQL builder writes accept invalidateAnnotation and reads refuse it', () => {
  db.public.users.insert([{ id: 1, name: 'Alice', email: 'a@b.com' }]).annotate(invalidate);
  db.public.users
    .update({ name: 'Alicia' })
    .where((f, fns) => fns.eq(f.id, 1))
    .annotate(invalidate);
  db.public.users
    .delete()
    .where((f, fns) => fns.eq(f.id, 1))
    .annotate(invalidate);

  // @ts-expect-error - invalidateAnnotation declares applicableTo: ['write'], not 'read'
  db.public.users.select('id').annotate(invalidate);
});

test('invalidateAnnotation typed with the store meta checks meta', () => {
  invalidateAnnotation<TagMeta>({ meta: { tags: ['users'] } });

  // @ts-expect-error - meta does not have the shape of TagMeta
  invalidateAnnotation<TagMeta>({ meta: { tag: 'users' } });
});
