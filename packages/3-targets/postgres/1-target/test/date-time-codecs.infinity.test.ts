import type { Codec } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import { pgTimestamptzDateDescriptor } from '../src/core/date-codecs';
import {
  pgDateTemporalDescriptor,
  pgTimestampTemporalDescriptor,
  pgTimestamptzTemporalDescriptor,
} from '../src/core/temporal-codecs';
import { fromContractJson } from './contract-json';

const instanceCtx = { name: '<test>' };

describe('a codec whose application value has no infinite date', () => {
  it.each<readonly [string, Codec, string, string]>([
    [
      pgDateTemporalDescriptor.codecId,
      pgDateTemporalDescriptor.factory()(instanceCtx),
      'infinity',
      'a date a Temporal.PlainDate holds, not infinity or -infinity, which pg/date-string@1 holds',
    ],
    [
      pgTimestampTemporalDescriptor.codecId,
      pgTimestampTemporalDescriptor.factory({})(instanceCtx),
      '-infinity',
      'a date and time a Temporal.PlainDateTime holds, not infinity or -infinity, which pg/timestamp-string@1 holds',
    ],
    [
      pgTimestamptzTemporalDescriptor.codecId,
      pgTimestamptzTemporalDescriptor.factory({})(instanceCtx),
      'infinity',
      'an instant a Temporal.Instant holds, not infinity or -infinity, which pg/timestamptz-string@1 holds',
    ],
    [
      pgTimestamptzDateDescriptor.codecId,
      pgTimestamptzDateDescriptor.factory({})(instanceCtx),
      '-infinity',
      'an instant a Date holds, from 4714-11-24 BC to +275760-09-13 and not infinity or -infinity, which pg/timestamptz-string@1 holds',
    ],
  ])(
    '%s refuses the stored value %s, naming the text codec that holds it',
    (_id, codec, value, expected) => {
      expect(() => fromContractJson(codec, value)).toThrow(
        expect.objectContaining({
          code: 'RUNTIME.DECODE_FAILED',
          message: `${codec.id} JSON value must be ${expected}`,
          meta: { codecId: codec.id, received: JSON.stringify(value) },
        }),
      );
    },
  );
});
