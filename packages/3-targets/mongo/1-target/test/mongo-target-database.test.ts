import { MongoCollection } from '@internal/mongo-contract';
import { describe, expect, it } from 'vitest';
import { MongoTargetDatabase, MongoTargetUnboundDatabase } from '../src/core/mongo-target-database';

describe('MongoTargetDatabase', () => {
  it('is frozen after construction (no mutation possible)', () => {
    const db = new MongoTargetDatabase({ id: 'app_db' });
    expect(Object.isFrozen(db)).toBe(true);
  });

  describe('qualifier emission', () => {
    it('returns the database name as its qualifier', () => {
      const db = new MongoTargetDatabase({ id: 'analytics' });
      expect(db.qualifier()).toBe('analytics');
    });

    it('qualifies a collection name with the database prefix', () => {
      const db = new MongoTargetDatabase({ id: 'analytics' });
      expect(db.qualifyCollection('events')).toBe('analytics.events');
    });
  });

  it('normalises plain collection inputs into MongoCollection instances', () => {
    const db = new MongoTargetDatabase({
      id: 'app',
      entries: { collection: { users: {} } },
    });
    expect(db.collection['users']).toBeInstanceOf(MongoCollection);
  });
});

describe('MongoTargetUnboundDatabase', () => {
  it('carries id="__unbound__"', () => {
    expect(MongoTargetUnboundDatabase.instance.id).toBe('__unbound__');
  });

  it('carries an empty frozen collections map', () => {
    expect(MongoTargetUnboundDatabase.instance.entries['collection']).toEqual({});
    expect(Object.isFrozen(MongoTargetUnboundDatabase.instance.entries['collection'])).toBe(true);
  });

  it('elides the database prefix in qualifier emission (singleton-subclass polymorphism)', () => {
    expect(MongoTargetUnboundDatabase.instance.qualifier()).toBe('');
  });

  it('emits an unqualified collection name (no "<db>." prefix)', () => {
    expect(MongoTargetUnboundDatabase.instance.qualifyCollection('events')).toBe('events');
  });

  it('is frozen', () => {
    expect(Object.isFrozen(MongoTargetUnboundDatabase.instance)).toBe(true);
  });
});
