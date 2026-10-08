import type {
  AnyCodecDescriptorTemplate,
  CodecInstanceContext,
  DataType,
  DataTypeValue,
} from '@internal/framework-components/codec';
import type { Codec, SqlCodecCallContext } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import {
  pgBitDescriptor,
  pgBoolDescriptor,
  pgByteaDescriptor,
  pgCharDescriptor,
  pgFloat4Descriptor,
  pgFloat8Descriptor,
  pgFloatDescriptor,
  pgInetDescriptor,
  pgInt2Descriptor,
  pgInt4Descriptor,
  pgInt8Descriptor,
  pgIntDescriptor,
  pgIntervalDescriptor,
  pgJsonbDescriptor,
  pgJsonDescriptor,
  pgNumericDescriptor,
  pgTextDescriptor,
  pgTimetzDescriptor,
  pgTsqueryDescriptor,
  pgUuidDescriptor,
  pgVarbitDescriptor,
  pgVarcharDescriptor,
  postgresSqlCharDescriptor,
  postgresSqlFloatDescriptor,
  postgresSqlIntDescriptor,
  postgresSqlTextDescriptor,
  postgresSqlVarcharDescriptor,
} from '../src/core/codecs';
import { postgresCodecRegistry } from '../src/core/registry';
import { fromContractJson, toContractJson } from './contract-json';

const SYNTH_CTX: CodecInstanceContext = { name: 'test' };

const descriptorByScalar = {
  char: postgresSqlCharDescriptor,
  varchar: postgresSqlVarcharDescriptor,
  int: postgresSqlIntDescriptor,
  float: postgresSqlFloatDescriptor,
  'sql-text': postgresSqlTextDescriptor,
  text: pgTextDescriptor,
  character: pgCharDescriptor,
  'character varying': pgVarcharDescriptor,
  integer: pgIntDescriptor,
  'double precision': pgFloatDescriptor,
  int4: pgInt4Descriptor,
  int2: pgInt2Descriptor,
  int8: pgInt8Descriptor,
  float4: pgFloat4Descriptor,
  float8: pgFloat8Descriptor,
  numeric: pgNumericDescriptor,
  timetz: pgTimetzDescriptor,
  bool: pgBoolDescriptor,
  bit: pgBitDescriptor,
  'bit varying': pgVarbitDescriptor,
  bytea: pgByteaDescriptor,
  interval: pgIntervalDescriptor,
  json: pgJsonDescriptor,
  jsonb: pgJsonbDescriptor,
  uuid: pgUuidDescriptor,
  inet: pgInetDescriptor,
} as const satisfies Record<string, AnyCodecDescriptorTemplate>;

type ScalarName = keyof typeof descriptorByScalar;

function codecForScalar(scalar: ScalarName): Codec {
  const descriptor = descriptorByScalar[scalar];
  // Codec runtime is per-instance-stateless for every codec under test; pass `undefined as never` so parameterized descriptors (e.g. char, numeric) accept a missing params record without bypassing the descriptor's `factory(params)` contract at the type level.
  return descriptor.factory(undefined as never)(SYNTH_CTX);
}

describe('adapter-postgres codecs', () => {
  describe('json codec', () => {
    const jsonCodec = codecForScalar('json') as {
      toWire: (value: unknown, ctx: SqlCodecCallContext) => Promise<string>;
      fromWire: (wire: string | unknown, ctx: SqlCodecCallContext) => Promise<unknown>;
    };

    it('encodes object to JSON string', async () => {
      expect(await jsonCodec.toWire({ key: 'value', nested: { ok: true } }, {})).toBe(
        '{"key":"value","nested":{"ok":true}}',
      );
    });

    it('decodes JSON string to object', async () => {
      expect(await jsonCodec.fromWire('{"key":"value"}', {})).toEqual({ key: 'value' });
    });

    it('passes through already-decoded values', async () => {
      expect(await jsonCodec.fromWire({ key: 'value' }, {})).toEqual({ key: 'value' });
    });
  });

  describe('jsonb codec', () => {
    const jsonbCodec = codecForScalar('jsonb') as {
      toWire: (value: unknown, ctx: SqlCodecCallContext) => Promise<string>;
      fromWire: (wire: string | unknown, ctx: SqlCodecCallContext) => Promise<unknown>;
    };

    it('encodes arrays and null values', async () => {
      expect(await jsonbCodec.toWire([1, null, { active: false }], {})).toBe(
        '[1,null,{"active":false}]',
      );
    });

    it('decodes JSON string to array', async () => {
      expect(await jsonbCodec.fromWire('[1,true,{"x":1}]', {})).toEqual([1, true, { x: 1 }]);
    });

    it('passes through already-decoded values', async () => {
      expect(await jsonbCodec.fromWire({ key: 'value' }, {})).toEqual({ key: 'value' });
    });
  });

  describe('scalar passthrough codecs', () => {
    it.each([
      { scalar: 'sql-text', value: 'portable text' },
      { scalar: 'text', value: 'hello world' },
      { scalar: 'uuid', value: '550e8400-e29b-41d4-a716-446655440000' },
      { scalar: 'inet', value: '192.168.1.1' },
    ] as const)('keeps $scalar values unchanged', async ({ scalar, value }) => {
      const codec = codecForScalar(scalar) as {
        toWire: (input: string, ctx: SqlCodecCallContext) => Promise<string>;
        fromWire: (input: string, ctx: SqlCodecCallContext) => Promise<string>;
      };
      expect(await codec.toWire(value, {})).toBe(value);
      expect(await codec.fromWire(value, {})).toBe(value);
    });

    it.each([
      { scalar: 'int2', value: 12 },
      { scalar: 'int4', value: 42 },
      { scalar: 'float4', value: 3.14 },
      { scalar: 'float8', value: Math.E },
    ] as const)('keeps $scalar values unchanged', async ({ scalar, value }) => {
      const codec = codecForScalar(scalar) as {
        toWire: (input: number, ctx: SqlCodecCallContext) => Promise<number>;
        fromWire: (input: number, ctx: SqlCodecCallContext) => Promise<number>;
      };
      expect(await codec.toWire(value, {})).toBe(value);
      expect(await codec.fromWire(value, {})).toBe(value);
    });

    it.each([
      'sql/int@1',
      'sql/float@1',
      'pg/int@1',
      'pg/float@1',
      'pg/int2@1',
      'pg/int4@1',
      'pg/float4@1',
      'pg/float8@1',
    ])('%s reads the decimal text of a list element as a number', async (codecId) => {
      const descriptor = postgresCodecRegistry.descriptorFor(codecId);
      const codec = descriptor?.factory(undefined as never)(SYNTH_CTX) as {
        fromWire: (input: string, ctx: SqlCodecCallContext) => Promise<unknown>;
      };
      expect(await codec.fromWire('-7', {})).toBe(-7);
    });

    it('keeps boolean values unchanged', async () => {
      const boolCodec = codecForScalar('bool') as {
        toWire: (input: boolean, ctx: SqlCodecCallContext) => Promise<boolean>;
        fromWire: (input: boolean, ctx: SqlCodecCallContext) => Promise<boolean>;
      };
      expect(await boolCodec.toWire(true, {})).toBe(true);
      expect(await boolCodec.fromWire(false, {})).toBe(false);
    });
  });

  describe('character codec', () => {
    const charCodec = codecForScalar('character') as {
      toWire: (value: string, ctx: SqlCodecCallContext) => Promise<string>;
      fromWire: (wire: string, ctx: SqlCodecCallContext) => Promise<string>;
    };

    it('encodes string as-is', async () => {
      expect(await charCodec.toWire('A', {})).toBe('A');
    });

    it('decodes string as-is', async () => {
      expect(await charCodec.fromWire('Z', {})).toBe('Z');
    });
  });

  describe('character varying codec', () => {
    const varcharCodec = codecForScalar('character varying') as {
      toWire: (value: string, ctx: SqlCodecCallContext) => Promise<string>;
      fromWire: (wire: string, ctx: SqlCodecCallContext) => Promise<string>;
    };

    it('encodes string as-is', async () => {
      expect(await varcharCodec.toWire('hello', {})).toBe('hello');
    });

    it('decodes string as-is', async () => {
      expect(await varcharCodec.fromWire('world', {})).toBe('world');
    });
  });

  describe('numeric codec', () => {
    const numericCodec = codecForScalar('numeric') as {
      toWire: (value: string, ctx: SqlCodecCallContext) => Promise<string>;
      fromWire: (wire: string | number, ctx: SqlCodecCallContext) => Promise<string>;
    };

    it('encodes string as-is', async () => {
      expect(await numericCodec.toWire('123.45', {})).toBe('123.45');
    });

    it('decodes number to string', async () => {
      expect(await numericCodec.fromWire(42, {})).toBe('42');
    });
  });

  describe('timetz codec', () => {
    const timetzCodec = codecForScalar('timetz') as {
      toWire: (value: string, ctx: SqlCodecCallContext) => Promise<string>;
      fromWire: (wire: string, ctx: SqlCodecCallContext) => Promise<string>;
    };

    it('encodes string as-is', async () => {
      expect(await timetzCodec.toWire('12:34:56+02', {})).toBe('12:34:56+02');
    });

    it('decodes string as-is', async () => {
      expect(await timetzCodec.fromWire('23:59:59-05', {})).toBe('23:59:59-05');
    });
  });

  describe('bit codec', () => {
    const bitCodec = codecForScalar('bit') as {
      toWire: (value: string, ctx: SqlCodecCallContext) => Promise<string>;
      fromWire: (wire: string, ctx: SqlCodecCallContext) => Promise<string>;
    };

    it('encodes string as-is', async () => {
      expect(await bitCodec.toWire('1010', {})).toBe('1010');
    });

    it('decodes string as-is', async () => {
      expect(await bitCodec.fromWire('0101', {})).toBe('0101');
    });
  });

  describe('bit varying codec', () => {
    const varbitCodec = codecForScalar('bit varying') as {
      toWire: (value: string, ctx: SqlCodecCallContext) => Promise<string>;
      fromWire: (wire: string, ctx: SqlCodecCallContext) => Promise<string>;
    };

    it('encodes string as-is', async () => {
      expect(await varbitCodec.toWire('11110000', {})).toBe('11110000');
    });

    it('decodes string as-is', async () => {
      expect(await varbitCodec.fromWire('00001111', {})).toBe('00001111');
    });
  });

  describe('bytea codec', () => {
    const byteaCodec = codecForScalar('bytea') as {
      toWire: (value: Uint8Array, ctx: SqlCodecCallContext) => Promise<Uint8Array>;
      fromWire: (wire: Uint8Array | string, ctx: SqlCodecCallContext) => Promise<Uint8Array>;
      dataType: DataType;
      toDataTypeValue: (value: Uint8Array) => DataTypeValue;
      fromDataTypeValue: (value: DataTypeValue) => Uint8Array;
    };

    it('round-trips a small payload', async () => {
      const input = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
      const encoded = await byteaCodec.toWire(input, {});
      const decoded = await byteaCodec.fromWire(encoded, {});
      expect(decoded).toEqual(input);
    });

    it('round-trips an empty payload', async () => {
      const input = new Uint8Array(0);
      const encoded = await byteaCodec.toWire(input, {});
      const decoded = await byteaCodec.fromWire(encoded, {});
      expect(decoded).toEqual(input);
      expect(decoded.byteLength).toBe(0);
    });

    it('returns plain Uint8Array wire values by identity', async () => {
      const input = new Uint8Array([0x01, 0x02, 0x03]);
      const decoded = await byteaCodec.fromWire(input, {});
      expect(decoded).toBe(input);
    });

    it('normalizes Buffer wire values to a plain Uint8Array view without copying', async () => {
      const backing = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04]);
      const buffer = Buffer.from(backing.buffer, 1, 3);
      const decoded = await byteaCodec.fromWire(buffer, {});
      expect(decoded).toBeInstanceOf(Uint8Array);
      expect(decoded.constructor).toBe(Uint8Array);
      expect(decoded.buffer).toBe(buffer.buffer);
      expect(decoded.byteOffset).toBe(buffer.byteOffset);
      expect(decoded.byteLength).toBe(buffer.byteLength);
      expect(Array.from(decoded)).toEqual([0x01, 0x02, 0x03]);
    });

    it('decodes target-parsed list element hex text', async () => {
      const decoded = await byteaCodec.fromWire('\\x010203', {});
      expect(Array.from(decoded)).toEqual([0x01, 0x02, 0x03]);
    });

    it('rejects non-hex bytea text', async () => {
      await expect(byteaCodec.fromWire('not-bytea-hex', {})).rejects.toThrow(
        'pg/bytea@1 wire value must be a bytea hex string or Uint8Array',
      );
    });

    it('uses base64 for JSON in both directions', () => {
      const bytes = new Uint8Array([0x01, 0x02, 0xfe, 0xff]);
      expect(toContractJson(byteaCodec, bytes)).toBe('AQL+/w==');
      expect(fromContractJson(byteaCodec, 'AQL+/w==')).toEqual(bytes);
      expect(toContractJson(byteaCodec, new Uint8Array())).toBe('');
      expect(fromContractJson(byteaCodec, '')).toEqual(new Uint8Array());
    });

    it('rejects JSON that is not base64 text', () => {
      expect(() => fromContractJson(byteaCodec, 42)).toThrow(
        'pg/bytea JSON value must be a base64 string',
      );
      expect(() => fromContractJson(byteaCodec, 'not base64!')).toThrow(
        'pg/bytea JSON value must be a base64 string',
      );
    });

    it('encodes Uint8Array to base64 text', () => {
      const input = new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f]);
      expect(toContractJson(byteaCodec, input)).toBe('aGVsbG8=');
    });

    it('round-trips through toDataTypeValue / fromDataTypeValue', () => {
      const input = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
      const json = toContractJson(byteaCodec, input);
      const decoded = fromContractJson(byteaCodec, json);
      expect(Array.from(decoded)).toEqual(Array.from(input));
    });

    it('its data type refuses non-string JSON', () => {
      expect(() => fromContractJson(byteaCodec, 42)).toThrow(
        'pg/bytea JSON value must be a base64 string',
      );
    });
  });

  describe('interval codec', () => {
    const codec = codecForScalar('interval');
    const fields = (partial: { months?: number; days?: number; micros?: bigint }) => ({
      months: 0,
      days: 0,
      micros: 0n,
      ...partial,
    });

    it('writes the value as the ISO duration PostgreSQL accepts', async () => {
      expect(await codec.toWire(fields({ days: 1 }), {})).toBe('P1D');
    });

    it('reads a text wire value into the three fields', async () => {
      expect(await codec.fromWire('PT2H', {})).toEqual(fields({ micros: 7_200_000_000n }));
      expect(await codec.fromWire('P13M', {})).toEqual(fields({ months: 13 }));
    });

    it('reads the interval text PostgreSQL prints into the three fields', async () => {
      expect(await codec.fromWire('1 day 02:03:04', {})).toEqual(
        fields({ days: 1, micros: 7_384_000_000n }),
      );
      expect(await codec.fromWire('-1 years -2 mons +3 days -04:00:00', {})).toEqual(
        fields({ months: -14, days: 3, micros: -14_400_000_000n }),
      );
    });

    it('rounds interval text past six fractional digits to microseconds as ISO-8601 text does', async () => {
      expect(await codec.fromWire('00:00:00.1234567', {})).toEqual(
        await codec.fromWire('PT0.1234567S', {}),
      );
      expect(await codec.fromWire('00:00:00.1234567', {})).toEqual(fields({ micros: 123_457n }));
      expect(await codec.fromWire('-00:00:00.1234565', {})).toEqual(
        await codec.fromWire('PT-0.1234565S', {}),
      );
    });

    it('rejects a text wire value that is neither an ISO-8601 duration nor interval text', async () => {
      await expect(codec.fromWire('one day', {})).rejects.toThrow(
        'pg/interval@1 value must be an ISO-8601 duration or PostgreSQL interval text, got one day',
      );
    });

    it('reads the driver component object into the three fields', async () => {
      expect(await codec.fromWire({ hours: 2, minutes: 30 }, {})).toEqual(
        fields({ micros: 9_000_000_000n }),
      );
    });

    it('carries the JSON side as the ISO duration, normalising only its spelling', () => {
      expect(toContractJson(codec, fields({ months: 13 }))).toBe('P1Y1M');
      expect(fromContractJson(codec, 'P1Y1M')).toEqual(fields({ months: 13 }));
      expect(toContractJson(codec, fields({ months: 1, days: -1 }))).toBe('P1M-1D');
    });

    /**
     * PostgreSQL rounds sub-microsecond fractional seconds rather than
     * truncating: `INTERVAL '1.1234567 seconds'` is `1.123457`, and
     * `'1.9999999'` carries into `2`. A wire value is read the same way.
     */
    it('rounds fractional seconds past microsecond resolution in a wire value', async () => {
      expect(await codec.fromWire('PT1.1234567S', {})).toEqual(fields({ micros: 1_123_457n }));
      expect(await codec.fromWire('PT1.9999999S', {})).toEqual(fields({ micros: 2_000_000n }));
      expect(await codec.fromWire('PT-1.1234567S', {})).toEqual(fields({ micros: -1_123_457n }));
      expect(toContractJson(codec, fields({ micros: 1_123_457n }))).toBe('PT1.123457S');
    });

    it('refuses a stored value past microsecond resolution, which PostgreSQL would round', () => {
      expect(() => fromContractJson(codec, 'PT1.1234567S')).toThrow(
        expect.objectContaining({ meta: expect.objectContaining({ dataType: 'pg/interval' }) }),
      );
    });
  });

  describe('metadata and params schema', () => {
    describe('pg/int8@1', () => {
      const codec = codecForScalar('int8');

      it('uses decimal text, so values beyond 2^53 survive', () => {
        expect(toContractJson(codec, 42n)).toBe('42');
        expect(fromContractJson(codec, '42')).toBe(42n);
        expect(toContractJson(codec, 9007199254740993n)).toBe('9007199254740993');
        expect(fromContractJson(codec, '9007199254740993')).toBe(9007199254740993n);
      });

      it('rejects a JSON number, which has already lost digits', () => {
        expect(() => fromContractJson(codec, 42)).toThrow(
          'pg/int8 JSON value must be a decimal integer string from -9223372036854775808 to 9223372036854775807',
        );
      });

      it('renders a default as a bigint literal', () => {
        expect(pgInt8Descriptor.renderValueLiteral?.('9007199254740993')).toBe('9007199254740993n');
      });
    });

    describe('identity codecs', () => {
      it('pg/int4@1 round-trips numbers', () => {
        const codec = codecForScalar('int4');
        expect(toContractJson(codec, 42)).toBe(42);
        expect(fromContractJson(codec, 42)).toBe(42);
      });

      it('pg/text@1 round-trips strings', () => {
        const codec = codecForScalar('text');
        expect(toContractJson(codec, 'hello')).toBe('hello');
        expect(fromContractJson(codec, 'hello')).toBe('hello');
      });

      it('pg/bool@1 round-trips booleans', () => {
        const codec = codecForScalar('bool');
        expect(toContractJson(codec, true)).toBe(true);
        expect(fromContractJson(codec, false)).toBe(false);
      });
    });
  });

  describe('pg/uuid@1 registry resolution', () => {
    it('resolves pgUuidDescriptor by codec id from the registry', () => {
      const resolved = postgresCodecRegistry.descriptorFor('pg/uuid@1');
      expect(resolved).toBe(pgUuidDescriptor);
    });
  });

  describe('pg/inet@1 registry resolution', () => {
    it('resolves pgInetDescriptor by codec id from the registry', () => {
      const resolved = postgresCodecRegistry.descriptorFor('pg/inet@1');
      expect(resolved).toBe(pgInetDescriptor);
    });
  });

  describe('pg/tsquery@1 registry resolution', () => {
    it('resolves pgTsqueryDescriptor by codec id, so a bound tsquery parameter renders', () => {
      const resolved = postgresCodecRegistry.descriptorFor('pg/tsquery@1');
      expect(resolved).toBe(pgTsqueryDescriptor);
    });

    it('claims no traits, so no comparison, ordering or text operation applies to a tsquery', () => {
      expect(postgresCodecRegistry.descriptorFor('pg/tsquery@1')?.traits).toEqual([]);
    });
  });
});
