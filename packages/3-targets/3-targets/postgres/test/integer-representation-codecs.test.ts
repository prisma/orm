import type { CodecInstanceContext } from '@internal/framework-components/codec';
import { CastExpr, ColumnRef } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { PG_INT8_NUMBER_CODEC_ID, PG_UNBOUNDED_INT_CODEC_ID } from '../src/core/codec-ids';
import {
  pgInt8Descriptor,
  pgInt8NumberDescriptor,
  pgNumericDescriptor,
  pgUnboundedIntDescriptor,
} from '../src/core/codecs';
import { postgresCodecDescriptorRegistry, postgresCodecRegistry } from '../src/core/registry';

const instanceCtx: CodecInstanceContext = { name: 'test' };

/**
 * A value the typed surface refuses, as a JS caller — or a migration from the
 * previous result type — still supplies it. The encode guards answer for what
 * reaches them at runtime, so that is what these cases hand them.
 */
const wrongTyped = (value: unknown): never => value as never;

describe('pg/int8number@1', () => {
  const codec = pgInt8NumberDescriptor.factory()(instanceCtx);

  describe('decode', () => {
    it('reads number, decimal-text, and bigint wire forms within the safe range', async () => {
      expect(await codec.decode(42, {})).toBe(42);
      expect(await codec.decode('9007199254740991', {})).toBe(9007199254740991);
      expect(await codec.decode(-9007199254740991n, {})).toBe(-9007199254740991);
    });

    it('throws at 2^53 on every wire form', async () => {
      await expect(codec.decode(9007199254740992, {})).rejects.toThrow(
        'pg/int8number@1 value must be an integer within the safe integer range',
      );
      await expect(codec.decode('9007199254740992', {})).rejects.toThrow(
        'pg/int8number@1 value must be an integer within the safe integer range',
      );
      await expect(codec.decode(9007199254740992n, {})).rejects.toThrow(
        'pg/int8number@1 value must be an integer within the safe integer range',
      );
    });

    it('throws at -(2^53)', async () => {
      await expect(codec.decode(-9007199254740992n, {})).rejects.toThrow(
        'pg/int8number@1 value must be an integer within the safe integer range',
      );
      await expect(codec.decode('-9007199254740992', {})).rejects.toThrow(
        'pg/int8number@1 value must be an integer within the safe integer range',
      );
    });

    it('throws on decimal text a Number() coercion would silently round', async () => {
      await expect(codec.decode('9007199254740993', {})).rejects.toThrow(
        'pg/int8number@1 value must be an integer within the safe integer range',
      );
    });

    it('throws on non-integral wire values', async () => {
      await expect(codec.decode(1.5, {})).rejects.toThrow(
        'pg/int8number@1 value must be an integer within the safe integer range',
      );
      await expect(codec.decode('1.5', {})).rejects.toThrow(
        'pg/int8number@1 value must be a decimal integer',
      );
    });
  });

  describe('encode', () => {
    it('writes decimal text within the safe range', async () => {
      expect(await codec.encode(9007199254740991, {})).toBe('9007199254740991');
      expect(await codec.encode(-9007199254740991, {})).toBe('-9007199254740991');
    });

    it('negative zero encodes as plain zero', async () => {
      const wire = await codec.encode(-0, {});
      expect(wire).toBe('0');
      expect(await codec.decode(wire, {})).toBe(0);
    });

    it('rejects out-of-range writes at 2^53 and -(2^53)', async () => {
      await expect(codec.encode(9007199254740992, {})).rejects.toThrow(
        'pg/int8number@1 value must be an integer within the safe integer range',
      );
      await expect(codec.encode(-9007199254740992, {})).rejects.toThrow(
        'pg/int8number@1 value must be an integer within the safe integer range',
      );
    });

    it('rejects non-integral writes', async () => {
      await expect(codec.encode(1.5, {})).rejects.toThrow(
        'pg/int8number@1 value must be an integer within the safe integer range',
      );
    });

    // A value of the wrong type is not a value out of range, and saying so
    // about a plainly in-range 9 sends the reader looking for a magnitude
    // problem. The type is what changed, so the type is what the message names.
    it('names the expected type when a bigint arrives where a number is read', async () => {
      await expect(codec.encode(wrongTyped(9n), {})).rejects.toMatchObject({
        code: 'RUNTIME.ENCODE_FAILED',
        message: 'pg/int8number@1 value must be a number, got bigint 9',
        meta: { codecId: 'pg/int8number@1', received: 'bigint' },
      });
      expect(() => codec.encodeJson(wrongTyped(9n))).toThrow(
        'pg/int8number@1 value must be a number, got bigint 9',
      );
    });
  });

  describe('encodeJson / decodeJson', () => {
    it('uses decimal text as the canonical form at both safe-range boundaries', () => {
      expect(codec.encodeJson(9007199254740991)).toBe('9007199254740991');
      expect(codec.decodeJson('9007199254740991')).toBe(9007199254740991);
      expect(codec.encodeJson(-9007199254740991)).toBe('-9007199254740991');
      expect(codec.decodeJson('-9007199254740991')).toBe(-9007199254740991);
    });

    it('rejects decimal text past the safe integer range', () => {
      expect(() => codec.decodeJson('9007199254740992')).toThrow(
        'pg/int8number@1 value must be an integer within the safe integer range',
      );
      expect(() => codec.decodeJson('-9007199254740992')).toThrow(
        'pg/int8number@1 value must be an integer within the safe integer range',
      );
    });

    it('rejects a JSON string that is not a decimal integer', () => {
      expect(() => codec.decodeJson('1.5')).toThrow(
        'pg/int8number@1 value must be a decimal integer',
      );
    });

    it('rejects a JSON number, whose digits a wide value has already lost', () => {
      expect(() => codec.decodeJson(42)).toThrow(
        'pg/int8number@1 database JSON value must be decimal text',
      );
    });

    it('rejects out-of-range and non-integral values on the encode side', () => {
      expect(() => codec.encodeJson(9007199254740992)).toThrow(
        'pg/int8number@1 value must be an integer within the safe integer range',
      );
      expect(() => codec.encodeJson(1.5)).toThrow(
        'pg/int8number@1 value must be an integer within the safe integer range',
      );
    });
  });

  it('projects the stored int8 as text, the canonical form its data type carries', () => {
    const expression = ColumnRef.of('records', 'value');
    expect(
      pgInt8NumberDescriptor.projectJson(expression, { codecId: PG_INT8_NUMBER_CODEC_ID }),
    ).toEqual(CastExpr.as(expression, 'text'));
  });

  it('claims no target type, so int8 stays pg/int8@1 in type position', () => {
    expect(pgInt8NumberDescriptor.targetTypes).toEqual([]);
    expect(postgresCodecRegistry.byTargetType('int8')).toEqual([pgInt8Descriptor]);
  });

  it('states the bigint native type', () => {
    expect(pgInt8NumberDescriptor.nativeTypeFor({ codecId: PG_INT8_NUMBER_CODEC_ID })).toBe(
      'bigint',
    );
  });

  it('carries the numeric ordering traits', () => {
    expect(pgInt8NumberDescriptor.traits).toEqual(['equality', 'order', 'numeric']);
  });

  it('renders a default as a number literal', () => {
    expect(pgInt8NumberDescriptor.renderValueLiteral?.('42')).toBe('42');
  });

  it('resolves from both registries by codec id', () => {
    expect(postgresCodecRegistry.descriptorFor(PG_INT8_NUMBER_CODEC_ID)).toBe(
      pgInt8NumberDescriptor,
    );
    expect(postgresCodecDescriptorRegistry.descriptorFor(PG_INT8_NUMBER_CODEC_ID)).toBe(
      pgInt8NumberDescriptor,
    );
  });
});

describe('pg/int8@1 number wire values', () => {
  const codec = pgInt8Descriptor.factory()(instanceCtx);

  // The same guard from the other side of the pair: this codec reads a
  // `bigint`, so a `number` is named for the type it is — `String(1.5)` is
  // perfectly good decimal text, and an integer codec that accepted it would
  // write a fraction into an integer column.
  it('names the expected type when a number arrives where a bigint is read', async () => {
    await expect(codec.encode(wrongTyped(9), {})).rejects.toMatchObject({
      code: 'RUNTIME.ENCODE_FAILED',
      message: 'pg/int8@1 value must be a bigint, got number 9',
      meta: { codecId: 'pg/int8@1', received: 'number' },
    });
  });

  // A schema literal (`BigInt @default(0)`) reaches the JSON boundary as a
  // number, because that is the only integer a schema language writes.
  it('reads a schema-written integer literal at the JSON boundary', () => {
    expect(codec.encodeJson(wrongTyped(0))).toBe('0');
    expect(codec.encodeJson(wrongTyped(9007199254740991))).toBe('9007199254740991');
    expect(codec.encodeJson(wrongTyped(-42))).toBe('-42');
  });

  it('rejects a written number the literal does not name exactly', () => {
    expect(() => codec.encodeJson(wrongTyped(1.5))).toThrow(
      'pg/int8@1 number literal must be an integer within the safe integer range, got 1.5',
    );
    expect(() => codec.encodeJson(wrongTyped(9007199254740992))).toThrow(
      'pg/int8@1 number literal must be an integer within the safe integer range, got 9007199254740992',
    );
  });

  it('reads a safe-integer number wire value exactly', async () => {
    expect(await codec.decode(42, {})).toBe(42n);
    expect(await codec.decode(9007199254740991, {})).toBe(9007199254740991n);
  });

  it('rejects a number wire value past the safe range, which has already lost precision', async () => {
    await expect(codec.decode(9007199254740992, {})).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      message:
        'pg/int8@1 wire number must be an integer within the safe integer range, got 9007199254740992',
      meta: { codecId: 'pg/int8@1', received: '9007199254740992' },
    });
    await expect(codec.decode(-9007199254740992, {})).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      meta: { codecId: 'pg/int8@1', received: '-9007199254740992' },
    });
  });
});

describe('pg/unboundedint@1', () => {
  const codec = pgUnboundedIntDescriptor.factory()(instanceCtx);

  describe('decode', () => {
    it('reads decimal text past 2^63 exactly', async () => {
      expect(await codec.decode('18446744073709551617', {})).toBe(18446744073709551617n);
      expect(await codec.decode('-18446744073709551617', {})).toBe(-18446744073709551617n);
    });

    it('reads a bigint wire value as-is', async () => {
      expect(await codec.decode(42n, {})).toBe(42n);
    });

    it('reads a safe-integer number wire value exactly', async () => {
      expect(await codec.decode(9007199254740991, {})).toBe(9007199254740991n);
      expect(await codec.decode(-9007199254740991, {})).toBe(-9007199254740991n);
    });

    it('rejects a number wire value past the safe range, which has already lost precision', async () => {
      await expect(codec.decode(9007199254740992, {})).rejects.toMatchObject({
        code: 'RUNTIME.DECODE_FAILED',
        message:
          'pg/unboundedint@1 wire number must be an integer within the safe integer range, got 9007199254740992',
        meta: { codecId: 'pg/unboundedint@1', received: '9007199254740992' },
      });
      await expect(codec.decode(-9007199254740992, {})).rejects.toMatchObject({
        code: 'RUNTIME.DECODE_FAILED',
        meta: { codecId: 'pg/unboundedint@1', received: '-9007199254740992' },
      });
    });

    it('rejects non-integral values', async () => {
      await expect(codec.decode('1.5', {})).rejects.toThrow(
        'pg/unboundedint@1 value must be a decimal integer',
      );
      await expect(codec.decode(1.5, {})).rejects.toThrow(
        'pg/unboundedint@1 value must be a decimal integer',
      );
    });

    it('rejects the non-finite numeric values', async () => {
      await expect(codec.decode('NaN', {})).rejects.toThrow(
        'pg/unboundedint@1 value must be a decimal integer',
      );
      await expect(codec.decode('Infinity', {})).rejects.toThrow(
        'pg/unboundedint@1 value must be a decimal integer',
      );
    });
  });

  it('encodes bigint as decimal text', async () => {
    expect(await codec.encode(18446744073709551617n, {})).toBe('18446744073709551617');
    expect(await codec.encode(-42n, {})).toBe('-42');
  });

  it('names the expected type when a number arrives where a bigint is read', async () => {
    await expect(codec.encode(wrongTyped(9), {})).rejects.toMatchObject({
      code: 'RUNTIME.ENCODE_FAILED',
      message: 'pg/unboundedint@1 value must be a bigint, got number 9',
      meta: { codecId: 'pg/unboundedint@1', received: 'number' },
    });
  });

  it('reads a schema-written integer literal at the JSON boundary', () => {
    expect(codec.encodeJson(wrongTyped(0))).toBe('0');
    expect(() => codec.encodeJson(wrongTyped(9007199254740992))).toThrow(
      'pg/unboundedint@1 number literal must be an integer within the safe integer range, got 9007199254740992',
    );
  });

  describe('encodeJson / decodeJson', () => {
    it('uses decimal text, so values beyond 2^53 and 2^63 survive', () => {
      expect(codec.encodeJson(9007199254740993n)).toBe('9007199254740993');
      expect(codec.decodeJson('9007199254740993')).toBe(9007199254740993n);
      expect(codec.encodeJson(18446744073709551617n)).toBe('18446744073709551617');
      expect(codec.decodeJson('18446744073709551617')).toBe(18446744073709551617n);
    });

    it('rejects a JSON number, which has already lost digits', () => {
      expect(() => codec.decodeJson(42)).toThrow(
        'pg/unboundedint@1 database JSON value must be a decimal string',
      );
    });

    it('rejects non-integral JSON text', () => {
      expect(() => codec.decodeJson('1.5')).toThrow(
        'pg/unboundedint@1 value must be a decimal integer',
      );
    });
  });

  it('projects the stored numeric as decimal text', () => {
    const expression = ColumnRef.of('records', 'value');
    expect(
      pgUnboundedIntDescriptor.projectJson(expression, { codecId: PG_UNBOUNDED_INT_CODEC_ID }),
    ).toEqual(CastExpr.as(expression, 'text'));
  });

  it('claims no target type, so numeric and decimal stay pg/numeric@1 in type position', () => {
    expect(pgUnboundedIntDescriptor.targetTypes).toEqual([]);
    expect(postgresCodecRegistry.byTargetType('numeric')).toEqual([pgNumericDescriptor]);
    expect(postgresCodecRegistry.byTargetType('decimal')).toEqual([pgNumericDescriptor]);
  });

  it('states the unconstrained numeric native type', () => {
    expect(pgUnboundedIntDescriptor.nativeTypeFor({ codecId: PG_UNBOUNDED_INT_CODEC_ID })).toBe(
      'numeric',
    );
  });

  it('carries the numeric ordering traits', () => {
    expect(pgUnboundedIntDescriptor.traits).toEqual(['equality', 'order', 'numeric']);
  });

  it('renders a default as a bigint literal', () => {
    expect(pgUnboundedIntDescriptor.renderValueLiteral?.('18446744073709551617')).toBe(
      '18446744073709551617n',
    );
  });

  it('resolves from both registries by codec id', () => {
    expect(postgresCodecRegistry.descriptorFor(PG_UNBOUNDED_INT_CODEC_ID)).toBe(
      pgUnboundedIntDescriptor,
    );
    expect(postgresCodecDescriptorRegistry.descriptorFor(PG_UNBOUNDED_INT_CODEC_ID)).toBe(
      pgUnboundedIntDescriptor,
    );
  });
});
