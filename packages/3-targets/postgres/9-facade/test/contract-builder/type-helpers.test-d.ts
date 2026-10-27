import { expectTypeOf, test } from 'vitest';
import { defineContract } from '../../src/exports/contract-builder';

test('type.* has a helper for every PSL type constructor', () => {
  defineContract({}, ({ type }) => {
    expectTypeOf(type.TimestampString(3).codecId).toEqualTypeOf<'pg/timestamp-string@1'>();
    expectTypeOf(type.TimestampString(3).typeParams).toEqualTypeOf<{ readonly precision: 3 }>();
    expectTypeOf(type.String().codecId).toEqualTypeOf<'pg/text@1'>();
    return { models: {} };
  });
});

test('field.namedType takes only an enum handle', () => {
  defineContract({}, ({ type, field }) => {
    // @ts-expect-error a codec instance is written with field.column
    field.namedType(type.sql.String(5));
    // @ts-expect-error a type alias name is written as a constant
    field.namedType('Slug');
    return { models: {} };
  });
});

test('the contract takes databaseTypes, not types', () => {
  defineContract({
    databaseTypes: {
      vector: { kind: 'codec-instance', codecId: 'pg/text@1', typeParams: {} },
    },
  });
  defineContract({
    // @ts-expect-error a type alias is a constant
    types: {},
  });
});

/** Whether the contract types say the client generates the field's value on create, which makes the create input optional. */
type GeneratesOnCreate<Builder> = Builder extends { readonly __state: infer State }
  ? State extends { readonly __defaultPresence?: infer Presence }
    ? NonNullable<Presence> extends { readonly onCreate: true }
      ? true
      : false
    : false
  : false;

test('a field typed by temporal.CreatedAt is optional on create', () => {
  defineContract({}, ({ type, field }) => {
    const createdAt = field.column(type.temporal.CreatedAt());
    const updatedAt = field.column(type.temporal.UpdatedAtString()).optional();
    const plain = field.column(type.TimestamptzTemporal());
    expectTypeOf<GeneratesOnCreate<typeof createdAt>>().toEqualTypeOf<true>();
    expectTypeOf<GeneratesOnCreate<typeof updatedAt>>().toEqualTypeOf<true>();
    expectTypeOf<GeneratesOnCreate<typeof plain>>().toEqualTypeOf<false>();
    expectTypeOf(type.temporal.CreatedAtJsDate().codecId).toEqualTypeOf<'pg/timestamptz-date@1'>();
    return { models: {} };
  });
});
