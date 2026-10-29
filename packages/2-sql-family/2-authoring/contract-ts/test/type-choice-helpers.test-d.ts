import { expectTypeOf, test } from 'vitest';
import { testTypeLookups } from '../../../1-core/contract/test/test-type-lookups';
import { createComposedAuthoringHelpers } from '../src/composed-authoring-helpers';
import { familyPack, targetPack } from './helpers/type-choice-packs';

const { type } = createComposedAuthoringHelpers({
  ...testTypeLookups,
  family: familyPack,
  target: targetPack,
});

test('a bare call resolves to the default row, with its parameter defaults', () => {
  expectTypeOf(type.Moment()).not.toBeAny();
  expectTypeOf(type.Moment()).toEqualTypeOf(type.TimestamptzTemporal(3));
  expectTypeOf(type.Moment({})).toEqualTypeOf(type.TimestamptzTemporal(3));
  expectTypeOf(type.Moment().codecId).toEqualTypeOf<'pg/timestamptz-temporal@1'>();
});

test('a written precision replaces the row default', () => {
  expectTypeOf(type.Moment({ precision: 6 })).toEqualTypeOf(type.TimestamptzTemporal(6));
  expectTypeOf(type.Moment({ as: 'temporal', storage: 'tz', precision: 6 })).toEqualTypeOf(
    type.TimestamptzTemporal(6),
  );
});

test('each row resolves to the type it names', () => {
  expectTypeOf(type.Moment({ storage: 'local' })).toEqualTypeOf(type.TimestampTemporal());
  expectTypeOf(type.Moment({ storage: 'local', precision: 6 })).toEqualTypeOf(
    type.TimestampTemporal(6),
  );
  expectTypeOf(type.Moment({ as: 'string', storage: 'local' })).toEqualTypeOf(
    type.TimestampString(),
  );
  expectTypeOf(type.Moment({ as: 'date', storage: 'local' })).toEqualTypeOf(type.DateString());
  expectTypeOf(type.Day()).toEqualTypeOf(type.DateString());
  expectTypeOf(type.Day({ as: 'temporal' })).toEqualTypeOf(type.DateTemporal());
});

test('an option argument takes only the values it lists', () => {
  // @ts-expect-error Moment's as is temporal, string or date
  type.Moment({ as: 'jsDate' });
});

test('an unlisted combination does not compile', () => {
  // @ts-expect-error as: string chooses no type with the default storage tz
  type.Moment({ as: 'string' });
});

test('an argument the chosen type does not take does not compile', () => {
  // @ts-expect-error DateString takes no precision
  type.Moment({ as: 'date', storage: 'local', precision: 3 });
  // @ts-expect-error Day passes on no precision
  type.Day({ precision: 3 });
});

test('a key the type choice has no argument for does not compile', () => {
  // @ts-expect-error Moment has no argument value
  type.Moment({ value: 'string' });
  // @ts-expect-error Moment has no argument bogus
  type.Moment({ as: 'temporal', bogus: 1 });
  // @ts-expect-error Moment has no argument bogus
  type.Moment({ storage: 'local', bogus: 1 });
});

test('positional arguments do not compile', () => {
  // @ts-expect-error a type choice takes one object
  type.Moment('temporal');
  // @ts-expect-error a type choice takes one object
  type.Moment({}, {});
});

test('an arguments object from a variable compiles when written as const', () => {
  const options = { as: 'string', storage: 'local' } as const;
  expectTypeOf(type.Moment(options)).toEqualTypeOf(type.TimestampString());
});

test('an arguments object from a variable with a widened option value does not compile', () => {
  const widened = { as: 'string', storage: 'local' };
  // @ts-expect-error as is typed string, so no overload can say which explicit type the call is
  type.Moment(widened);
  const union: { as: 'temporal' | 'string'; storage: 'local' } = { as: 'string', storage: 'local' };
  // @ts-expect-error as is typed 'temporal' | 'string', which two rows share, so no overload takes it
  type.Moment(union);
});

test('a key the type choice has no argument for does not compile through a variable', () => {
  const extra = { storage: 'local', bogus: 1 } as const;
  // @ts-expect-error Moment has no argument bogus
  type.Moment(extra);
});
