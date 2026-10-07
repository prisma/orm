import type { JsonValue } from '@internal/contract/types';
import { timeouts, withClient, withDevDatabase } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import {
  pgInt8Descriptor,
  pgInt8NumberDescriptor,
  pgUnboundedIntDescriptor,
} from '../src/core/codecs';

const ctx = { name: 'canonical-integer-text' };

const spellings = [
  '7',
  '007',
  '0',
  '00',
  '-0',
  '-7',
  '-007',
  '9007199254740991',
  '0009007199254740991',
  '-9007199254740991',
] as const;

interface IntegerTextCodec {
  readonly id: string;
  encodeJson(value: never): JsonValue;
  decodeJson(json: JsonValue): unknown;
}

const codecs: readonly (readonly [IntegerTextCodec, string])[] = [
  [pgInt8Descriptor.factory()(ctx), 'int8'],
  [pgInt8NumberDescriptor.factory()(ctx), 'int8'],
  [pgUnboundedIntDescriptor.factory()(ctx), 'numeric'],
];

function readOrRefusal(codec: IntegerTextCodec, json: string): string {
  try {
    return `reads, writes ${JSON.stringify(codec.encodeJson(codec.decodeJson(json) as never))}`;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe('the integer codecs that carry digit text, against Postgres', () => {
  it(
    'read exactly the text Postgres prints, write it back unchanged, and name it when refusing another spelling',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await withClient(connectionString, async (client) => {
          const observed: Record<string, string> = {};
          const expected: Record<string, string> = {};
          for (const [codec, columnType] of codecs) {
            for (const spelling of spellings) {
              const result = await client.query<{ printed: string }>(
                `SELECT $1::${columnType}::text AS printed`,
                [spelling],
              );
              const printed = result.rows[0]?.printed ?? '';
              const key = `${codec.id} ${spelling}`;
              observed[key] = readOrRefusal(codec, spelling);
              expected[key] =
                printed === spelling
                  ? `reads, writes ${JSON.stringify(printed)}`
                  : `${codec.id} JSON value must be "${printed}", as the database writes this value`;
            }
          }
          expect(observed).toEqual(expected);
        });
      });
    },
    timeouts.spinUpPpgDev,
  );
});
