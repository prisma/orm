import { expectTypeOf, test } from 'vitest';
import { defineContract } from '../../src/exports/contract-builder';

test('type.* has a helper for every SQLite PSL type constructor and no Postgres one', () => {
  defineContract({}, ({ type }) => {
    expectTypeOf(type.DateTime().codecId).toEqualTypeOf<'sqlite/datetime@1'>();
    expectTypeOf(type).not.toHaveProperty('TimestamptzTemporal');
    return { models: {} };
  });
});

test('type.temporal.UpdatedAt is a DateTime column generated on create and update', () => {
  defineContract({}, ({ type }) => {
    expectTypeOf(type.temporal.UpdatedAt().codecId).toEqualTypeOf<'sqlite/datetime@1'>();
    expectTypeOf(type.temporal.UpdatedAt().generatorCalls).toHaveProperty('onUpdate');
    return { models: {} };
  });
});
