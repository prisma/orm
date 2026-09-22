import { expectTypeOf, test } from 'vitest';
import type { CodecTypes } from '../src/exports/codec-types';
import { pgTimestamptzDateColumn } from '../src/exports/codecs';

test('Date codec participates in the public codec type map', () => {
  type Types = CodecTypes['pg/timestamptz-date@1'];
  expectTypeOf<Types>().not.toBeAny();
  expectTypeOf<Types['output']>().toEqualTypeOf<Date>();
  expectTypeOf<Types['input']>().toEqualTypeOf<Date>();
  const column = pgTimestamptzDateColumn({ precision: 3 });
  expectTypeOf(column.codecId).toEqualTypeOf<string>();
  const codec = column.codecFactory({ name: 'at' });
  expectTypeOf(codec).not.toBeAny();
  expectTypeOf(codec.id).toEqualTypeOf<'pg/timestamptz-date@1'>();
  expectTypeOf(codec.encode).parameter(0).toEqualTypeOf<Date>();
  expectTypeOf(codec.decode).returns.resolves.toEqualTypeOf<Date>();
});
