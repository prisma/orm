import { expectTypeOf, test } from 'vitest';
import {
  pgTimestampStringDescriptor,
  pgTimestamptzStringDescriptor,
} from '../src/core/temporal-string-codecs';
import type { CodecTypes } from '../src/exports/codec-types';

test('the text timestamp codecs take a Date on encode but publish string as their application type', () => {
  expectTypeOf<CodecTypes['pg/timestamp-string@1']['input']>().toEqualTypeOf<string>();
  expectTypeOf<CodecTypes['pg/timestamp-string@1']['output']>().toEqualTypeOf<string>();
  expectTypeOf<CodecTypes['pg/timestamptz-string@1']['input']>().toEqualTypeOf<string>();
  expectTypeOf<CodecTypes['pg/timestamptz-string@1']['output']>().toEqualTypeOf<string>();

  const timestamp = pgTimestampStringDescriptor.factory({})({ name: 'at' });
  const timestamptz = pgTimestamptzStringDescriptor.factory({})({ name: 'at' });
  expectTypeOf(timestamp.encode(new Date(), {})).resolves.toEqualTypeOf<string>();
  expectTypeOf(timestamp.encode('2024-01-02 03:04:05', {})).resolves.toEqualTypeOf<string>();
  expectTypeOf(timestamptz.encode(new Date(), {})).resolves.toEqualTypeOf<string>();
  expectTypeOf(timestamptz.encode('2024-01-02 03:04:05+00', {})).resolves.toEqualTypeOf<string>();
});
