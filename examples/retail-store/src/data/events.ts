import { MongoFieldFilter } from '@prisma/orm-mongo/query-ast/execution';
import { acc } from '@prisma/orm-mongo/query-builder';
import type { FieldInputTypes } from '../contract';
import type { Db } from '../db';

type EventBase = Omit<FieldInputTypes['__unbound__']['Event'], '_id' | 'type'>;

export function createViewProductEvent(
  db: Db,
  event: EventBase & FieldInputTypes['__unbound__']['ViewProductEvent'],
) {
  return db.orm.events.variant('view-product').create({
    userId: event.userId,
    sessionId: event.sessionId,
    timestamp: event.timestamp,
    productId: event.productId,
    subCategory: event.subCategory,
    brand: event.brand,
    exitMethod: event.exitMethod,
  });
}

export function createSearchEvent(
  db: Db,
  event: EventBase & FieldInputTypes['__unbound__']['SearchEvent'],
) {
  return db.orm.events.variant('search').create({
    userId: event.userId,
    sessionId: event.sessionId,
    timestamp: event.timestamp,
    query: event.query,
  });
}

export function createAddToCartEvent(
  db: Db,
  event: EventBase & FieldInputTypes['__unbound__']['AddToCartEvent'],
) {
  return db.orm.events.variant('add-to-cart').create({
    userId: event.userId,
    sessionId: event.sessionId,
    timestamp: event.timestamp,
    productId: event.productId,
    brand: event.brand,
  });
}

export function findEventsByUser(db: Db, userId: string) {
  return db.orm.events.where(MongoFieldFilter.eq('userId', userId)).all();
}

export function findSearchEventsByUser(db: Db, userId: string) {
  return db.orm.events.variant('search').where(MongoFieldFilter.eq('userId', userId)).all();
}

interface EventTypeCount {
  _id: string;
  count: number;
}

export async function aggregateEventsByType(db: Db, userId: string): Promise<EventTypeCount[]> {
  const plan = db.query
    .from('events')
    .match(MongoFieldFilter.eq('userId', userId))
    .group((f) => ({
      _id: f.type,
      count: acc.count(),
    }))
    .sort({ count: -1 })
    .build();

  return (await db.runtime()).query(plan);
}
