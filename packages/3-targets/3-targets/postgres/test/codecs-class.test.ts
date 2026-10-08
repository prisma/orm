import { describe, expect, it } from 'vitest';
import {
  PG_BIT_CODEC_ID,
  PG_BOOL_CODEC_ID,
  PG_FLOAT4_CODEC_ID,
  PG_FLOAT8_CODEC_ID,
  PG_INET_CODEC_ID,
  PG_INT2_CODEC_ID,
  PG_INT4_CODEC_ID,
  PG_INT8_CODEC_ID,
  PG_INTERVAL_CODEC_ID,
  PG_JSON_CODEC_ID,
  PG_JSONB_CODEC_ID,
  PG_NUMERIC_CODEC_ID,
  PG_TEXT_CODEC_ID,
  PG_TIMETZ_CODEC_ID,
  PG_UUID_CODEC_ID,
  PG_VARBIT_CODEC_ID,
} from '../src/core/codec-ids';
import {
  pgBitDescriptor,
  pgBoolDescriptor,
  pgFloat4Descriptor,
  pgFloat8Descriptor,
  pgInetDescriptor,
  pgInt2Descriptor,
  pgInt4Descriptor,
  pgInt8Descriptor,
  pgIntervalDescriptor,
  pgJsonbDescriptor,
  pgJsonDescriptor,
  pgNumericDescriptor,
  pgTextDescriptor,
  pgTimetzDescriptor,
  pgUuidDescriptor,
  pgVarbitDescriptor,
} from '../src/core/codecs';
import { fromContractJson, toContractJson } from './contract-json';

const instanceCtx = { name: '<test>' };
const callCtx = {};

describe('codecs-class', () => {
  describe('pg/text@1', () => {
    const codec = pgTextDescriptor.factory()(instanceCtx);

    it('id proxies through the descriptor', () => {
      expect(codec.id).toBe(PG_TEXT_CODEC_ID);
    });

    it('encodes and decodes string values verbatim', async () => {
      expect(await codec.toWire('hello', callCtx)).toBe('hello');
      expect(await codec.fromWire('hello', callCtx)).toBe('hello');
    });

    it('round-trips through JSON identity', () => {
      expect(toContractJson(codec, 'hello')).toBe('hello');
      expect(fromContractJson(codec, 'hello')).toBe('hello');
    });
  });

  describe('pg/int4@1', () => {
    const codec = pgInt4Descriptor.factory()(instanceCtx);
    it('id proxies through the descriptor', () => {
      expect(codec.id).toBe(PG_INT4_CODEC_ID);
    });
    it('encodes and decodes number values verbatim', async () => {
      expect(await codec.toWire(42, callCtx)).toBe(42);
      expect(await codec.fromWire(42, callCtx)).toBe(42);
    });
  });

  describe('pg/int2@1', () => {
    const codec = pgInt2Descriptor.factory()(instanceCtx);
    it('id proxies through the descriptor', () => {
      expect(codec.id).toBe(PG_INT2_CODEC_ID);
    });
    it('encodes and decodes number values verbatim', async () => {
      expect(await codec.toWire(7, callCtx)).toBe(7);
      expect(await codec.fromWire(7, callCtx)).toBe(7);
    });
  });

  describe('pg/int8@1', () => {
    const codec = pgInt8Descriptor.factory()(instanceCtx);
    it('id proxies through the descriptor', () => {
      expect(codec.id).toBe(PG_INT8_CODEC_ID);
    });
    it('encodes to decimal text and decodes the wire string to bigint', async () => {
      expect(await codec.toWire(9_999_999_999n, callCtx)).toBe('9999999999');
      expect(await codec.fromWire('9999999999', callCtx)).toBe(9_999_999_999n);
    });
    it('carries a value past the safe-integer range', async () => {
      expect(await codec.toWire(9007199254740993n, callCtx)).toBe('9007199254740993');
      expect(await codec.fromWire('9007199254740993', callCtx)).toBe(9007199254740993n);
    });
  });

  describe('pg/float4@1', () => {
    const codec = pgFloat4Descriptor.factory()(instanceCtx);
    it('id proxies through the descriptor', () => {
      expect(codec.id).toBe(PG_FLOAT4_CODEC_ID);
    });
    it('encodes and decodes number values verbatim', async () => {
      expect(await codec.toWire(3.14, callCtx)).toBe(3.14);
      expect(await codec.fromWire(3.14, callCtx)).toBe(3.14);
    });
  });

  describe('pg/float8@1', () => {
    const codec = pgFloat8Descriptor.factory()(instanceCtx);
    it('id proxies through the descriptor', () => {
      expect(codec.id).toBe(PG_FLOAT8_CODEC_ID);
    });
    it('encodes and decodes number values verbatim', async () => {
      expect(await codec.toWire(Math.E, callCtx)).toBe(Math.E);
      expect(await codec.fromWire(Math.E, callCtx)).toBe(Math.E);
    });
  });

  describe('pg/bool@1', () => {
    const codec = pgBoolDescriptor.factory()(instanceCtx);
    it('id proxies through the descriptor', () => {
      expect(codec.id).toBe(PG_BOOL_CODEC_ID);
    });
    it('encodes and decodes boolean values verbatim', async () => {
      expect(await codec.toWire(true, callCtx)).toBe(true);
      expect(await codec.fromWire(false, callCtx)).toBe(false);
    });
  });

  describe('pg/numeric@1', () => {
    const codec = pgNumericDescriptor.factory({ precision: 10, scale: 2 })(instanceCtx);

    it('id proxies through the descriptor (independent of params)', () => {
      expect(codec.id).toBe(PG_NUMERIC_CODEC_ID);
    });

    it('encodes string verbatim', async () => {
      expect(await codec.toWire('123.45', callCtx)).toBe('123.45');
    });

    it('decodes string verbatim and coerces number to string', async () => {
      expect(await codec.fromWire('123.45', callCtx)).toBe('123.45');
      expect(await codec.fromWire(123 as unknown as string, callCtx)).toBe('123');
    });

    it('renderOutputType returns Numeric<precision, scale>', () => {
      expect(pgNumericDescriptor.renderOutputType?.({ precision: 10, scale: 2 })).toBe(
        'Numeric<10, 2>',
      );
    });

    it('renderOutputType returns Numeric<precision> when scale absent', () => {
      expect(pgNumericDescriptor.renderOutputType?.({ precision: 10 })).toBe('Numeric<10>');
    });
  });

  describe('pg/numeric@1 with no typeParams (unbounded numeric / bare Decimal)', () => {
    const codec = pgNumericDescriptor.factory({})(instanceCtx);

    it('id proxies through the descriptor', () => {
      expect(codec.id).toBe(PG_NUMERIC_CODEC_ID);
    });

    it('encodes and decodes strings verbatim with no precision/scale supplied', async () => {
      expect(await codec.toWire('123.45', callCtx)).toBe('123.45');
      expect(await codec.fromWire('123.45', callCtx)).toBe('123.45');
    });

    it('renderOutputType returns undefined when precision is absent', () => {
      expect(pgNumericDescriptor.renderOutputType?.({})).toBeUndefined();
    });
  });

  describe('pg/timetz@1', () => {
    const codec = pgTimetzDescriptor.factory({})(instanceCtx);
    it('id proxies through the descriptor', () => {
      expect(codec.id).toBe(PG_TIMETZ_CODEC_ID);
    });
    it('round-trips strings verbatim', async () => {
      expect(await codec.toWire('10:30:00+00', callCtx)).toBe('10:30:00+00');
      expect(await codec.fromWire('10:30:00+00', callCtx)).toBe('10:30:00+00');
    });
  });

  describe('pg/bit@1', () => {
    const codec = pgBitDescriptor.factory({ length: 8 })(instanceCtx);
    it('id proxies through the descriptor', () => {
      expect(codec.id).toBe(PG_BIT_CODEC_ID);
    });
    it('round-trips bit strings verbatim', async () => {
      expect(await codec.toWire('10101010', callCtx)).toBe('10101010');
      expect(await codec.fromWire('10101010', callCtx)).toBe('10101010');
    });
    it('renderOutputType returns Bit<length>', () => {
      expect(pgBitDescriptor.renderOutputType?.({ length: 8 })).toBe('Bit<8>');
    });
    it('renderOutputType returns undefined when length absent', () => {
      expect(pgBitDescriptor.renderOutputType?.({})).toBeUndefined();
    });
  });

  describe('pg/varbit@1', () => {
    const codec = pgVarbitDescriptor.factory({ length: 16 })(instanceCtx);
    it('id proxies through the descriptor', () => {
      expect(codec.id).toBe(PG_VARBIT_CODEC_ID);
    });
    it('round-trips bit strings verbatim', async () => {
      expect(await codec.toWire('1010', callCtx)).toBe('1010');
      expect(await codec.fromWire('1010', callCtx)).toBe('1010');
    });
    it('renderOutputType returns VarBit<length>', () => {
      expect(pgVarbitDescriptor.renderOutputType?.({ length: 16 })).toBe('VarBit<16>');
    });
  });

  describe('pg/interval@1', () => {
    const codec = pgIntervalDescriptor.factory({})(instanceCtx);

    it('id proxies through the descriptor', () => {
      expect(codec.id).toBe(PG_INTERVAL_CODEC_ID);
    });

    it('writes the value as the ISO duration PostgreSQL accepts', async () => {
      expect(await codec.toWire({ months: 0, days: 1, micros: 0n }, callCtx)).toBe('P1D');
    });

    it('reads a text wire value into the three fields', async () => {
      expect(await codec.fromWire('P0Y1M', callCtx)).toEqual({ months: 1, days: 0, micros: 0n });
    });

    it('reads the driver component object into the three fields', async () => {
      expect(await codec.fromWire({ days: 1 } as unknown as string, callCtx)).toEqual({
        months: 0,
        days: 1,
        micros: 0n,
      });
    });
  });

  describe('pg/json@1', () => {
    const codec = pgJsonDescriptor.factory()(instanceCtx);

    it('id proxies through the descriptor', () => {
      expect(codec.id).toBe(PG_JSON_CODEC_ID);
    });

    it('encodes JsonValue to JSON string', async () => {
      expect(await codec.toWire({ key: 'value' }, callCtx)).toBe('{"key":"value"}');
    });

    it('decodes JSON string to value', async () => {
      expect(await codec.fromWire('{"key":"value"}', callCtx)).toEqual({ key: 'value' });
    });

    it('decode passes through already-decoded values', async () => {
      expect(await codec.fromWire({ key: 'value' }, callCtx)).toEqual({ key: 'value' });
    });

    it('rejects invalid JSON text with SyntaxError', async () => {
      await expect(codec.fromWire('{invalid', callCtx)).rejects.toThrow(SyntaxError);
    });
  });

  describe('pg/jsonb@1', () => {
    const codec = pgJsonbDescriptor.factory()(instanceCtx);

    it('id proxies through the descriptor', () => {
      expect(codec.id).toBe(PG_JSONB_CODEC_ID);
    });

    it('encodes JsonValue to JSON string', async () => {
      expect(await codec.toWire([1, 2, 3], callCtx)).toBe('[1,2,3]');
    });

    it('decodes JSON string to value', async () => {
      expect(await codec.fromWire('[1,2,3]', callCtx)).toEqual([1, 2, 3]);
    });

    it('decode passes through already-decoded values', async () => {
      expect(await codec.fromWire([1, 2, 3], callCtx)).toEqual([1, 2, 3]);
    });

    it('rejects invalid JSON text with SyntaxError', async () => {
      await expect(codec.fromWire('{invalid', callCtx)).rejects.toThrow(SyntaxError);
    });
  });

  describe('pg/uuid@1', () => {
    const codec = pgUuidDescriptor.factory()(instanceCtx);
    const SAMPLE_UUID = '550e8400-e29b-41d4-a716-446655440000';

    it('id proxies through the descriptor', () => {
      expect(codec.id).toBe(PG_UUID_CODEC_ID);
    });

    it('encodes and decodes string values verbatim', async () => {
      expect(await codec.toWire(SAMPLE_UUID, callCtx)).toBe(SAMPLE_UUID);
      expect(await codec.fromWire(SAMPLE_UUID, callCtx)).toBe(SAMPLE_UUID);
    });

    it('round-trips through JSON identity', () => {
      expect(toContractJson(codec, SAMPLE_UUID)).toBe(SAMPLE_UUID);
      expect(fromContractJson(codec, SAMPLE_UUID)).toBe(SAMPLE_UUID);
    });

    it('writes a uuid into JSON as the text Postgres prints for it', () => {
      expect(toContractJson(codec, '{550E8400-E29B41D4-A716-446655440000}')).toBe(SAMPLE_UUID);
    });
  });

  describe('pg/inet@1', () => {
    const codec = pgInetDescriptor.factory()(instanceCtx);
    const SAMPLE_INET = '192.168.1.1';

    it('id proxies through the descriptor', () => {
      expect(codec.id).toBe(PG_INET_CODEC_ID);
    });

    it('encodes and decodes string values verbatim', async () => {
      expect(await codec.toWire(SAMPLE_INET, callCtx)).toBe(SAMPLE_INET);
      expect(await codec.fromWire(SAMPLE_INET, callCtx)).toBe(SAMPLE_INET);
    });

    it('writes JSON as PostgreSQL prints the address and reads it back unchanged', () => {
      expect(toContractJson(codec, `${SAMPLE_INET}/32`)).toBe(SAMPLE_INET);
      expect(fromContractJson(codec, SAMPLE_INET)).toBe(SAMPLE_INET);
    });
  });

  describe('descriptor metadata', () => {
    it('exposes traits for each codec', () => {
      expect(pgTextDescriptor.traits).toEqual(['equality', 'order', 'textual']);
      expect(pgInt4Descriptor.traits).toEqual(['equality', 'order', 'numeric']);
      expect(pgBoolDescriptor.traits).toEqual(['equality', 'boolean']);
      expect(pgJsonDescriptor.traits).toEqual([]);
      expect(pgJsonbDescriptor.traits).toEqual(['equality']);
      expect(pgUuidDescriptor.traits).toEqual(['equality', 'order']);
      expect(pgInetDescriptor.traits).toEqual(['equality', 'order']);
    });
  });
});
