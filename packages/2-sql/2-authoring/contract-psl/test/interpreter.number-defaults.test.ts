import type { JsonValue } from '@internal/contract/types';
import type { Codec, CodecLookup } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { interpretPslDocumentToSqlContract } from '../src/interpreter';
import {
  createBuiltinLikeControlMutationDefaults,
  postgresNativeScalarTypeDescriptors,
  postgresScalarAuthoringTypes,
  postgresTarget,
  symbolTableInputFromParseArgs,
} from './fixtures';
import { sqlStorageFromSuccessfulSqlInterpretation } from './interpret-sql-contract-storage';
import { unboundTables } from './unbound-tables';

function jsonCodec<TInput>(
  id: string,
  encodeJson: (value: TInput) => JsonValue,
  decodeJson: (json: JsonValue) => TInput,
): Codec {
  return {
    id,
    encode: async (value: unknown) => value,
    decode: async (wire: unknown) => wire,
    encodeJson: encodeJson as (value: unknown) => JsonValue,
    decodeJson,
  };
}

function decimalText(json: JsonValue): string {
  if (typeof json !== 'string') throw new Error('JSON value must be decimal text');
  return json;
}

function numberCodec(id: string): Codec {
  return jsonCodec(
    id,
    (value: number) => value,
    (json) => json as number,
  );
}

const codecs = new Map<string, Codec>([
  ['pg/numeric@1', jsonCodec('pg/numeric@1', (value: string) => value, decimalText)],
  [
    'pg/int8@1',
    jsonCodec(
      'pg/int8@1',
      (value: bigint | number) => BigInt(value).toString(),
      (json) => BigInt(decimalText(json)),
    ),
  ],
  ['pg/int4@1', numberCodec('pg/int4@1')],
  ['pg/float8@1', numberCodec('pg/float8@1')],
]);

const codecLookup: CodecLookup = {
  get: (id) => codecs.get(id),
  targetTypesFor: () => undefined,
  renderOutputTypeFor: () => undefined,
};

function columnDefaults(model: string) {
  const document = symbolTableInputFromParseArgs({ schema: model, sourceId: 'schema.prisma' });
  const result = interpretPslDocumentToSqlContract({
    ...document,
    target: postgresTarget,
    scalarColumnDescriptors: postgresNativeScalarTypeDescriptors,
    authoringContributions: { type: postgresScalarAuthoringTypes, field: {} },
    composedExtensionContracts: new Map(),
    createNamespace: createTestSqlNamespace,
    capabilities: { sql: { scalarList: true } },
    controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
    codecLookup,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.failure));
  const table = unboundTables(sqlStorageFromSuccessfulSqlInterpretation(result.value))['n'];
  return Object.fromEntries(
    Object.entries(table?.columns ?? {}).flatMap(([name, column]) =>
      column.default === undefined ? [] : [[name, column.default]],
    ),
  );
}

describe('number literal defaults', () => {
  it('lower to the decimal text written on a column whose codec reads decimal text', () => {
    expect(
      columnDefaults(`types {
  Price = Numeric(10, 2)
}

model N {
  id                  Int     @id
  long                Decimal @default(12345678901234567890.123456789)
  tiny                Decimal @default(0.000000000000000001)
  negative            Decimal @default(-1.25)
  whole               Decimal @default(10)
  bareTrailingZeros   Decimal @default(1.50)
  scaledTrailingZeros Price   @default(1.50)
  notANumber          Decimal @default(NaN)
}`),
    ).toEqual({
      long: { kind: 'literal', value: '12345678901234567890.123456789' },
      tiny: { kind: 'literal', value: '0.000000000000000001' },
      negative: { kind: 'literal', value: '-1.25' },
      whole: { kind: 'literal', value: '10' },
      bareTrailingZeros: { kind: 'literal', value: '1.50' },
      scaledTrailingZeros: { kind: 'literal', value: '1.50' },
      notANumber: { kind: 'literal', value: 'NaN' },
    });
  });

  it('lower to every digit written on a big integer column', () => {
    expect(
      columnDefaults(`model N {
  id       Int    @id
  big      BigInt @default(9007199254740993)
  smallest BigInt @default(-9223372036854775808)
  safe     BigInt @default(42)
}`),
    ).toEqual({
      big: { kind: 'literal', value: '9007199254740993' },
      smallest: { kind: 'literal', value: '-9223372036854775808' },
      safe: { kind: 'literal', value: '42' },
    });
  });

  it('lower each list element from its text', () => {
    expect(
      columnDefaults(`model N {
  id       Int       @id
  decimals Decimal[] @default([12345678901234567890.123456789, 1.50])
  bigs     BigInt[]  @default([9007199254740993, -1])
  ints     Int[]     @default([1, -2])
}`),
    ).toEqual({
      decimals: { kind: 'literal', value: ['12345678901234567890.123456789', '1.50'] },
      bigs: { kind: 'literal', value: ['9007199254740993', '-1'] },
      ints: { kind: 'literal', value: [1, -2] },
    });
  });

  it('stay numbers on columns whose codec reads a JSON number', () => {
    expect(
      columnDefaults(`model N {
  id    Int   @id
  count Int   @default(-5)
  ratio Float @default(1.50)
}`),
    ).toEqual({
      count: { kind: 'literal', value: -5 },
      ratio: { kind: 'literal', value: 1.5 },
    });
  });
});
