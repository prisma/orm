import type { JsonValue } from '@internal/contract/types';
import type {
  AnyCodecDescriptor,
  CodecLookup,
  CodecTrait,
} from '@internal/framework-components/codec';
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

interface TestCodec {
  readonly traits: readonly CodecTrait[];
  readonly encodeJson: (value: never) => JsonValue;
  readonly decodeJson: (json: JsonValue) => unknown;
}

function text(json: JsonValue): string {
  if (typeof json !== 'string') throw new Error('JSON value must be text');
  return json;
}

const numberCodec: TestCodec = {
  traits: ['equality', 'order', 'numeric'],
  encodeJson: (value: number) => value,
  decodeJson: (json) => json,
};

const testCodecs: Readonly<Record<string, TestCodec>> = {
  'pg/numeric@1': {
    traits: ['equality', 'order', 'numeric'],
    encodeJson: (value: string) => value,
    decodeJson: text,
  },
  'pg/int8@1': {
    traits: ['equality', 'order', 'numeric'],
    encodeJson: (value: bigint | number) => BigInt(value).toString(),
    decodeJson: (json) => BigInt(text(json)),
  },
  'pg/int4@1': numberCodec,
  'pg/float8@1': numberCodec,
  'pg/bytea@1': {
    traits: ['equality'],
    encodeJson: (value: unknown) => value as JsonValue,
    decodeJson: text,
  },
};

const codecLookup: CodecLookup = {
  get: (id) => {
    const codec = testCodecs[id];
    if (codec === undefined) return undefined;
    return {
      id,
      encode: async (value: unknown) => value,
      decode: async (wire: unknown) => wire,
      encodeJson: codec.encodeJson as (value: unknown) => JsonValue,
      decodeJson: codec.decodeJson,
    };
  },
  descriptorFor: (id) => {
    const codec = testCodecs[id];
    return codec === undefined
      ? undefined
      : ({ codecId: id, traits: codec.traits } as unknown as AnyCodecDescriptor);
  },
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
  const table = unboundTables(sqlStorageFromSuccessfulSqlInterpretation(result.value))['N'];
  return Object.fromEntries(
    Object.entries(table?.columns ?? {}).flatMap(([name, column]) =>
      column.default === undefined ? [] : [[name, column.default]],
    ),
  );
}

describe('number literal defaults', () => {
  it('lower to the decimal text written, without leading zeros or the sign of zero, on a numeric column whose codec reads text', () => {
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
  negativeZero        Decimal @default(-0)
  leadingZeros        Decimal @default(007)
  leadingZeroFraction Decimal @default(00.10)
  negativeLeadingZero Decimal @default(-007.50)
  scaledNegativeZero  Price   @default(-0.00)
}`),
    ).toEqual({
      long: { kind: 'literal', value: '12345678901234567890.123456789' },
      tiny: { kind: 'literal', value: '0.000000000000000001' },
      negative: { kind: 'literal', value: '-1.25' },
      whole: { kind: 'literal', value: '10' },
      bareTrailingZeros: { kind: 'literal', value: '1.50' },
      scaledTrailingZeros: { kind: 'literal', value: '1.50' },
      notANumber: { kind: 'literal', value: 'NaN' },
      negativeZero: { kind: 'literal', value: '0' },
      leadingZeros: { kind: 'literal', value: '7' },
      leadingZeroFraction: { kind: 'literal', value: '0.10' },
      negativeLeadingZero: { kind: 'literal', value: '-7.50' },
      scaledNegativeZero: { kind: 'literal', value: '0.00' },
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
  decimals Decimal[] @default([12345678901234567890.123456789, 1.50, -0, 007])
  bigs     BigInt[]  @default([9007199254740993, -1])
  ints     Int[]     @default([1, -2])
}`),
    ).toEqual({
      decimals: {
        kind: 'literal',
        value: ['12345678901234567890.123456789', '1.50', '0', '7'],
      },
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

  it('stay numbers on a column whose codec does not hold numbers, even when it reads text', () => {
    expect(
      columnDefaults(`model N {
  id      Int   @id
  payload Bytes @default(1234)
}`),
    ).toEqual({
      payload: { kind: 'literal', value: 1234 },
    });
  });
});
