import type {
  AnyCodecDescriptor,
  CodecInstanceContext,
} from '@internal/framework-components/codec';
import type { Codec, SqlCodecCallContext } from '@internal/sql-relational-core/ast';
import {
  sqlCharDescriptor,
  sqlFloatDescriptor,
  sqlIntDescriptor,
  sqlTextDescriptor,
  sqlVarcharDescriptor,
} from '@internal/sql-relational-core/ast';
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
  pgUuidDescriptor,
  pgVarbitDescriptor,
  pgVarcharDescriptor,
} from '../src/core/codecs';
import { postgresCodecRegistry } from '../src/core/registry';

const SYNTH_CTX: CodecInstanceContext = { name: 'test' };

const descriptorByScalar = {
  char: sqlCharDescriptor,
  varchar: sqlVarcharDescriptor,
  int: sqlIntDescriptor,
  float: sqlFloatDescriptor,
  'sql-text': sqlTextDescriptor,
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
} as const satisfies Record<string, AnyCodecDescriptor>;

type ScalarName = keyof typeof descriptorByScalar;

function codecForScalar(scalar: ScalarName): Codec {
  const descriptor = descriptorByScalar[scalar];
  // Codec runtime is per-instance-stateless for every codec under test; pass `undefined as never` so parameterized descriptors (e.g. char, numeric) accept a missing params record without bypassing the descriptor's `factory(params)` contract at the type level.
  return descriptor.factory(undefined as never)(SYNTH_CTX);
}

describe('adapter-postgres codecs', () => {
  describe('json codec', () => {
    const jsonCodec = codecForScalar('json') as {
      encode: (value: unknown, ctx: SqlCodecCallContext) => Promise<string>;
      decode: (wire: string | unknown, ctx: SqlCodecCallContext) => Promise<unknown>;
    };

    it('encodes object to JSON string', async () => {
      expect(await jsonCodec.encode({ key: 'value', nested: { ok: true } }, {})).toBe(
        '{"key":"value","nested":{"ok":true}}',
      );
    });

    it('decodes JSON string to object', async () => {
      expect(await jsonCodec.decode('{"key":"value"}', {})).toEqual({ key: 'value' });
    });

    it('passes through already-decoded values', async () => {
      expect(await jsonCodec.decode({ key: 'value' }, {})).toEqual({ key: 'value' });
    });
  });

  describe('jsonb codec', () => {
    const jsonbCodec = codecForScalar('jsonb') as {
      encode: (value: unknown, ctx: SqlCodecCallContext) => Promise<string>;
      decode: (wire: string | unknown, ctx: SqlCodecCallContext) => Promise<unknown>;
    };

    it('encodes arrays and null values', async () => {
      expect(await jsonbCodec.encode([1, null, { active: false }], {})).toBe(
        '[1,null,{"active":false}]',
      );
    });

    it('decodes JSON string to array', async () => {
      expect(await jsonbCodec.decode('[1,true,{"x":1}]', {})).toEqual([1, true, { x: 1 }]);
    });

    it('passes through already-decoded values', async () => {
      expect(await jsonbCodec.decode({ key: 'value' }, {})).toEqual({ key: 'value' });
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
        encode: (input: string, ctx: SqlCodecCallContext) => Promise<string>;
        decode: (input: string, ctx: SqlCodecCallContext) => Promise<string>;
      };
      expect(await codec.encode(value, {})).toBe(value);
      expect(await codec.decode(value, {})).toBe(value);
    });

    it.each([
      { scalar: 'int2', value: 12 },
      { scalar: 'int4', value: 42 },
      { scalar: 'float4', value: 3.14 },
      { scalar: 'float8', value: Math.E },
    ] as const)('keeps $scalar values unchanged', async ({ scalar, value }) => {
      const codec = codecForScalar(scalar) as {
        encode: (input: number, ctx: SqlCodecCallContext) => Promise<number>;
        decode: (input: number, ctx: SqlCodecCallContext) => Promise<number>;
      };
      expect(await codec.encode(value, {})).toBe(value);
      expect(await codec.decode(value, {})).toBe(value);
    });

    it('keeps boolean values unchanged', async () => {
      const boolCodec = codecForScalar('bool') as {
        encode: (input: boolean, ctx: SqlCodecCallContext) => Promise<boolean>;
        decode: (input: boolean, ctx: SqlCodecCallContext) => Promise<boolean>;
      };
      expect(await boolCodec.encode(true, {})).toBe(true);
      expect(await boolCodec.decode(false, {})).toBe(false);
    });
  });

  describe('character codec', () => {
    const charCodec = codecForScalar('character') as {
      encode: (value: string, ctx: SqlCodecCallContext) => Promise<string>;
      decode: (wire: string, ctx: SqlCodecCallContext) => Promise<string>;
    };

    it('encodes string as-is', async () => {
      expect(await charCodec.encode('A', {})).toBe('A');
    });

    it('decodes string as-is', async () => {
      expect(await charCodec.decode('Z', {})).toBe('Z');
    });
  });

  describe('character varying codec', () => {
    const varcharCodec = codecForScalar('character varying') as {
      encode: (value: string, ctx: SqlCodecCallContext) => Promise<string>;
      decode: (wire: string, ctx: SqlCodecCallContext) => Promise<string>;
    };

    it('encodes string as-is', async () => {
      expect(await varcharCodec.encode('hello', {})).toBe('hello');
    });

    it('decodes string as-is', async () => {
      expect(await varcharCodec.decode('world', {})).toBe('world');
    });
  });

  describe('numeric codec', () => {
    const numericCodec = codecForScalar('numeric') as {
      encode: (value: string, ctx: SqlCodecCallContext) => Promise<string>;
      decode: (wire: string | number, ctx: SqlCodecCallContext) => Promise<string>;
    };

    it('encodes string as-is', async () => {
      expect(await numericCodec.encode('123.45', {})).toBe('123.45');
    });

    it('decodes number to string', async () => {
      expect(await numericCodec.decode(42, {})).toBe('42');
    });
  });

  describe('timetz codec', () => {
    const timetzCodec = codecForScalar('timetz') as {
      encode: (value: string, ctx: SqlCodecCallContext) => Promise<string>;
      decode: (wire: string, ctx: SqlCodecCallContext) => Promise<string>;
    };

    it('encodes string as-is', async () => {
      expect(await timetzCodec.encode('12:34:56+02', {})).toBe('12:34:56+02');
    });

    it('decodes string as-is', async () => {
      expect(await timetzCodec.decode('23:59:59-05', {})).toBe('23:59:59-05');
    });
  });

  describe('bit codec', () => {
    const bitCodec = codecForScalar('bit') as {
      encode: (value: string, ctx: SqlCodecCallContext) => Promise<string>;
      decode: (wire: string, ctx: SqlCodecCallContext) => Promise<string>;
    };

    it('encodes string as-is', async () => {
      expect(await bitCodec.encode('1010', {})).toBe('1010');
    });

    it('decodes string as-is', async () => {
      expect(await bitCodec.decode('0101', {})).toBe('0101');
    });
  });

  describe('bit varying codec', () => {
    const varbitCodec = codecForScalar('bit varying') as {
      encode: (value: string, ctx: SqlCodecCallContext) => Promise<string>;
      decode: (wire: string, ctx: SqlCodecCallContext) => Promise<string>;
    };

    it('encodes string as-is', async () => {
      expect(await varbitCodec.encode('11110000', {})).toBe('11110000');
    });

    it('decodes string as-is', async () => {
      expect(await varbitCodec.decode('00001111', {})).toBe('00001111');
    });
  });

  describe('bytea codec', () => {
    const byteaCodec = codecForScalar('bytea') as {
      encode: (value: Uint8Array, ctx: SqlCodecCallContext) => Promise<Uint8Array>;
      decode: (wire: Uint8Array, ctx: SqlCodecCallContext) => Promise<Uint8Array>;
      encodeJson: (value: Uint8Array) => unknown;
      decodeJson: (json: unknown) => Uint8Array;
    };

    it('round-trips a small payload', async () => {
      const input = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
      const encoded = await byteaCodec.encode(input, {});
      const decoded = await byteaCodec.decode(encoded, {});
      expect(decoded).toEqual(input);
    });

    it('round-trips an empty payload', async () => {
      const input = new Uint8Array(0);
      const encoded = await byteaCodec.encode(input, {});
      const decoded = await byteaCodec.decode(encoded, {});
      expect(decoded).toEqual(input);
      expect(decoded.byteLength).toBe(0);
    });

    it('normalizes Buffer wire values to a plain Uint8Array view', async () => {
      const buffer = Buffer.from([0x01, 0x02, 0x03]);
      const decoded = await byteaCodec.decode(buffer, {});
      expect(decoded).toBeInstanceOf(Uint8Array);
      expect(decoded.constructor).toBe(Uint8Array);
      expect(Array.from(decoded)).toEqual([0x01, 0x02, 0x03]);
    });

    it('uses base64 for JSON in both directions', () => {
      const bytes = new Uint8Array([0x01, 0x02, 0xfe, 0xff]);
      expect(byteaCodec.encodeJson(bytes)).toBe('AQL+/w==');
      expect(byteaCodec.decodeJson('AQL+/w==')).toEqual(bytes);
      expect(byteaCodec.encodeJson(new Uint8Array())).toBe('');
      expect(byteaCodec.decodeJson('')).toEqual(new Uint8Array());
    });

    it('rejects JSON that is not base64 text', () => {
      expect(() => byteaCodec.decodeJson(42)).toThrow(
        'pg/bytea@1 database JSON value must be a base64 string',
      );
      expect(() => byteaCodec.decodeJson('not base64!')).toThrow(
        'pg/bytea@1 database JSON value must be a base64 string',
      );
    });

    it('encodes Uint8Array to base64 text', () => {
      const input = new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f]);
      expect(byteaCodec.encodeJson(input)).toBe('aGVsbG8=');
    });

    it('round-trips through encodeJson / decodeJson', () => {
      const input = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
      const json = byteaCodec.encodeJson(input);
      const decoded = byteaCodec.decodeJson(json);
      expect(Array.from(decoded)).toEqual(Array.from(input));
    });

    it('throws on non-string input to decodeJson', () => {
      expect(() => byteaCodec.decodeJson(42)).toThrow(
        'pg/bytea@1 database JSON value must be a base64 string',
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
      expect(await codec.encode(fields({ days: 1 }), {})).toBe('P1D');
    });

    it('reads a text wire value into the three fields', async () => {
      expect(await codec.decode('PT2H', {})).toEqual(fields({ micros: 7_200_000_000n }));
      expect(await codec.decode('P13M', {})).toEqual(fields({ months: 13 }));
    });

    it('rejects a text wire value that is not an ISO-8601 duration', async () => {
      await expect(codec.decode('1 day', {})).rejects.toThrow(
        'pg/interval@1 value must be an ISO-8601 duration, got 1 day',
      );
    });

    it('reads the driver component object into the three fields', async () => {
      expect(await codec.decode({ hours: 2, minutes: 30 }, {})).toEqual(
        fields({ micros: 9_000_000_000n }),
      );
    });

    it('carries the JSON side as the ISO duration, normalising only its spelling', () => {
      expect(codec.encodeJson(fields({ months: 13 }))).toBe('P1Y1M');
      expect(codec.decodeJson('P1Y1M')).toEqual(fields({ months: 13 }));
      expect(codec.encodeJson(fields({ months: 1, days: -1 }))).toBe('P1M-1D');
    });

    /**
     * PostgreSQL rounds sub-microsecond fractional seconds rather than
     * truncating: `INTERVAL '1.1234567 seconds'` is `1.123457`, and
     * `'1.9999999'` carries into `2`. Both paths into the value agree.
     */
    it('rounds fractional seconds past microsecond resolution', () => {
      expect(codec.decodeJson('PT1.1234567S')).toEqual(fields({ micros: 1_123_457n }));
      expect(codec.decodeJson('PT1.9999999S')).toEqual(fields({ micros: 2_000_000n }));
      expect(codec.decodeJson('PT-1.1234567S')).toEqual(fields({ micros: -1_123_457n }));
      expect(codec.encodeJson(fields({ micros: 1_123_457n }))).toBe('PT1.123457S');
    });
  });

  describe('metadata and params schema', () => {
    describe('pg/int8@1', () => {
      const codec = codecForScalar('int8');

      it('uses decimal text, so values beyond 2^53 survive', () => {
        expect(codec.encodeJson(42n)).toBe('42');
        expect(codec.decodeJson('42')).toBe(42n);
        expect(codec.encodeJson(9007199254740993n)).toBe('9007199254740993');
        expect(codec.decodeJson('9007199254740993')).toBe(9007199254740993n);
      });

      it('rejects a JSON number, which has already lost digits', () => {
        expect(() => codec.decodeJson(42)).toThrow(
          'pg/int8@1 database JSON value must be a decimal string',
        );
      });

      it('renders a default as a bigint literal', () => {
        expect(pgInt8Descriptor.renderValueLiteral?.('9007199254740993')).toBe('9007199254740993n');
      });
    });

    describe('identity codecs', () => {
      it('pg/int4@1 round-trips numbers', () => {
        const codec = codecForScalar('int4');
        expect(codec.encodeJson(42)).toBe(42);
        expect(codec.decodeJson(42)).toBe(42);
      });

      it('pg/text@1 round-trips strings', () => {
        const codec = codecForScalar('text');
        expect(codec.encodeJson('hello')).toBe('hello');
        expect(codec.decodeJson('hello')).toBe('hello');
      });

      it('pg/bool@1 round-trips booleans', () => {
        const codec = codecForScalar('bool');
        expect(codec.encodeJson(true)).toBe(true);
        expect(codec.decodeJson(false)).toBe(false);
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
});
