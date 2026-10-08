/**
 * Runtime tests for the arktype-json codec (TML-2357). Canonical test suite for arktype-json codec behavior after the legacy `arktypeJson(schema)` form retired.
 *
 * Coverage:
 *
 * - the column-author helper produces a working codec whose `id` proxies through the descriptor's `codecId`.
 * - the descriptor's factory rehydrates the schema and returns a working codec for runtime materialization paths.
 * - encode/decode round-trip including toDataTypeValue/fromDataTypeValue agreement on the JSON-safe normalized payload.
 * - schema validation rejects malformed payloads at decode, while encode only enforces JSON representability.
 */

import type { CodecInstanceContext } from '@internal/framework-components/codec';
import type { SqlCodecCallContext } from '@internal/sql-relational-core/ast';
import { isStructuredError } from '@internal/utils/structured-error';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import {
  ARKTYPE_JSON_CODEC_ID,
  arktypeJsonColumn,
  arktypeJsonDescriptor,
} from '../src/core/arktype-json-codec';
import { fromContractJson, toContractJson } from './contract-json';

const SYNTH_CTX: CodecInstanceContext = { name: '<arktype-json-class-test>' };
const CALL_CTX: SqlCodecCallContext = {};

const productSchema = type({
  name: 'string',
  price: 'number',
  'description?': 'string',
});

describe('arktypeJsonColumn(schema)', () => {
  it('returns a ColumnSpec with codecId, typeParams', () => {
    const col = arktypeJsonColumn(productSchema);
    expect(col.codecId).toBe(ARKTYPE_JSON_CODEC_ID);
    expect(col.typeParams.expression).toBe(productSchema.expression);
    expect(col.typeParams.jsonIr).toEqual(productSchema.json);
  });

  it('codecFactory(ctx) materializes a working codec', async () => {
    const col = arktypeJsonColumn(productSchema);
    const codec = col.codecFactory(SYNTH_CTX);
    expect(codec.id).toBe(ARKTYPE_JSON_CODEC_ID);

    const value = { name: 'Widget', price: 9.99 };
    const wire = await codec.toWire(value, CALL_CTX);
    expect(typeof wire).toBe('string');
    const decoded = await codec.fromWire(wire, CALL_CTX);
    expect(decoded).toEqual(value);
  });

  it('decode rejects payloads that fail schema validation', async () => {
    const col = arktypeJsonColumn(productSchema);
    const codec = col.codecFactory(SYNTH_CTX);
    const wire = JSON.stringify({ name: 'Widget' });
    await expect(codec.fromWire(wire, CALL_CTX)).rejects.toThrow(/schema validation failed/);
  });

  it('decode accepts already-parsed jsonb values from the driver', async () => {
    const codec = arktypeJsonColumn(productSchema).codecFactory(SYNTH_CTX);
    const wire = { name: 'Widget', price: 10 };
    expect(await codec.fromWire(wire, CALL_CTX)).toEqual(wire);
  });

  it('decode validates pre-parsed payloads against the schema', async () => {
    const codec = arktypeJsonColumn(productSchema).codecFactory(SYNTH_CTX);
    await expect(codec.fromWire({ name: 'Widget' }, CALL_CTX)).rejects.toThrow(/price/);
  });

  it('toDataTypeValue / fromDataTypeValue round-trip through schema', () => {
    const col = arktypeJsonColumn(productSchema);
    const codec = col.codecFactory(SYNTH_CTX);
    const value = { name: 'Widget', price: 9.99, description: 'A widget' };
    const json = toContractJson(codec, value);
    const decoded = fromContractJson(codec, json);
    expect(decoded).toEqual(value);
  });

  it('rejects non-callable schema lookalikes at the call site', () => {
    const notASchema = { foo: 'bar' };
    // @ts-expect-error -- deliberately malformed input for the call-site guard
    expect(() => arktypeJsonColumn(notASchema)).toThrow(/callable arktype Type/);
  });

  it('rejects callable values that are missing `expression: string`', () => {
    const callableWithoutExpression = (v: unknown) => v;
    expect(() => arktypeJsonColumn(callableWithoutExpression as never)).toThrow(
      /missing `expression: string`/,
    );
  });

  it('rejects callable schemas that are missing the `json` IR', () => {
    const fakeSchema = Object.assign((v: unknown) => v, {
      expression: 'unknown',
      json: 'not-an-object',
    });
    expect(() => arktypeJsonColumn(fakeSchema as never)).toThrow(/missing `json` IR/);
  });
});

describe('arktypeJsonColumn toWire/toDataTypeValue agreement', () => {
  it('toWire and toDataTypeValue agree on the normalized payload', async () => {
    const codec = arktypeJsonColumn(productSchema).codecFactory(SYNTH_CTX);
    const original = { name: 'Widget', price: 10, description: 'desc' };
    const wire = await codec.toWire(original, CALL_CTX);
    const json = toContractJson(codec, original);
    expect(wire).toBe(JSON.stringify(json));
  });

  it('encode strips class prototypes via the JSON.stringify round-trip', async () => {
    class Widget {
      constructor(
        public name: string,
        public price: number,
      ) {}
      toString() {
        return `${this.name}@${this.price}`;
      }
    }
    const codec = arktypeJsonColumn(productSchema).codecFactory(SYNTH_CTX);
    const widget = new Widget('Widget', 10);
    const wire = await codec.toWire(widget, CALL_CTX);
    expect(wire).toBe('{"name":"Widget","price":10}');
  });

  it('encode does not run schema validation', async () => {
    const codec = arktypeJsonColumn(productSchema).codecFactory(SYNTH_CTX);
    await expect(codec.toWire({ name: 'Widget' } as never, CALL_CTX)).resolves.toBe(
      '{"name":"Widget"}',
    );
  });

  it('encode rejects values that are not representable as JSON', async () => {
    const anySchema = type('object');
    const codec = arktypeJsonColumn(anySchema).codecFactory(SYNTH_CTX);
    await expect(codec.toWire(undefined as never, CALL_CTX)).rejects.toThrow(
      /not representable as JSON/,
    );
    expect(() => codec.toDataTypeValue(undefined as never)).toThrow(/not representable as JSON/);
  });

  it('decode rejects payloads with type-mismatched fields', async () => {
    const codec = arktypeJsonColumn(productSchema).codecFactory(SYNTH_CTX);
    const wire = JSON.stringify({ name: 'Widget', price: 'not-a-number' });
    await expect(codec.fromWire(wire, CALL_CTX)).rejects.toThrow(/price/);
  });

  it('decode rejects wire text that is not JSON with the SyntaxError the runtime wraps', async () => {
    const codec = arktypeJsonColumn(type('string')).codecFactory(SYNTH_CTX);

    await expect(codec.fromWire('not json', CALL_CTX)).rejects.toThrow(SyntaxError);
  });

  it('decode rethrows non-runtime schema errors', async () => {
    const throwingSchema = Object.assign(
      (_value: unknown): unknown => {
        throw new Error('schema exploded');
      },
      { expression: 'unknown', json: {} },
    );
    const codec = arktypeJsonColumn(throwingSchema as never).codecFactory(SYNTH_CTX);

    await expect(codec.fromWire('"raw wire"', CALL_CTX)).rejects.toThrow('schema exploded');
  });

  it('decode parses JSON string text for string-schema columns', async () => {
    const codec = arktypeJsonColumn(type('string')).codecFactory(SYNTH_CTX);
    expect(await codec.fromWire('"hello"', CALL_CTX)).toBe('hello');
  });

  it('decode returns JSON-looking strings stored as JSON strings', async () => {
    const codec = arktypeJsonColumn(type('string')).codecFactory(SYNTH_CTX);
    for (const value of ['42', 'true', 'null', '{"x":1}', '"bob"', '""']) {
      expect(await codec.fromWire(JSON.stringify(value), CALL_CTX)).toBe(value);
    }
  });

  it('decode validates the parsed value, not the wire text', async () => {
    const codec = arktypeJsonColumn(type('string')).codecFactory(SYNTH_CTX);
    await expect(codec.fromWire('42', CALL_CTX)).rejects.toThrow(/schema validation failed/);
  });

  it('decode rejects pre-parsed primitives that violate the schema', async () => {
    const stringSchema = type('string');
    const codec = arktypeJsonColumn(stringSchema).codecFactory(SYNTH_CTX);
    await expect(codec.fromWire(42, CALL_CTX)).rejects.toThrow(/string/);
  });
});

describe('arktypeJsonDescriptor.factory(params)', () => {
  it('rehydrates the schema from typeParams.jsonIr and produces a working codec', async () => {
    const col = arktypeJsonColumn(productSchema);
    const factory = arktypeJsonDescriptor.factory(col.typeParams);
    const codec = factory(SYNTH_CTX);
    expect(codec.id).toBe(ARKTYPE_JSON_CODEC_ID);

    const value = { name: 'Widget', price: 9.99 };
    const wire = await codec.toWire(value, CALL_CTX);
    const decoded = await codec.fromWire(wire, CALL_CTX);
    expect(decoded).toEqual(value);
  });

  it('descriptor metadata: traits and data type', () => {
    expect(arktypeJsonDescriptor.codecId).toBe(ARKTYPE_JSON_CODEC_ID);
    expect(arktypeJsonDescriptor.traits).toEqual(['equality']);
    expect(arktypeJsonDescriptor.dataType).toBe('pg/jsonb');
    expect(arktypeJsonDescriptor).not.toHaveProperty('encodeIsParamsIndependent');
  });

  it('renderOutputType returns the eager-extracted expression', () => {
    const col = arktypeJsonColumn(productSchema);
    const rendered = arktypeJsonDescriptor.renderOutputType(col.typeParams);
    expect(rendered).toBe(productSchema.expression);
  });

  it("renderOutputType falls back to 'unknown' when the expression is whitespace-only", () => {
    expect(arktypeJsonDescriptor.renderOutputType({ expression: '   ', jsonIr: {} })).toBe(
      'unknown',
    );
  });

  it('throws on corrupt jsonIr at factory time', () => {
    expect(() =>
      arktypeJsonDescriptor.factory({
        expression: 'string',
        jsonIr: { not: 'a-valid-arktype-ir' },
      }),
    ).toThrow(/Failed to rehydrate arktype schema from contract IR/);
  });

  it('throws RUNTIME.TYPE_PARAMS_INVALID when expression diverges from the rehydrated schema', () => {
    const col = arktypeJsonColumn(productSchema);
    expect(() =>
      arktypeJsonDescriptor.factory({
        ...col.typeParams,
        expression: 'an obviously stale expression',
      }),
    ).toThrow(/typeParams\.expression .* does not match/);
  });

  it('accepts matching typeParams.expression without complaint', () => {
    const col = arktypeJsonColumn(productSchema);
    expect(() => arktypeJsonDescriptor.factory(col.typeParams)).not.toThrow();
  });
});

describe('structured error codes', () => {
  it('encode of a non-JSON-representable value raises RUNTIME.ENCODE_FAILED', async () => {
    const codec = arktypeJsonColumn(type('object')).codecFactory(SYNTH_CTX);

    const error = await codec.toWire(undefined as never, CALL_CTX).then(
      () => {
        throw new Error('expected encode to reject');
      },
      (err: unknown) => err,
    );
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'RUNTIME.ENCODE_FAILED',
      message: `arktype-json value is not representable as JSON (codecId: ${ARKTYPE_JSON_CODEC_ID})`,
      details: { codecId: ARKTYPE_JSON_CODEC_ID },
    });
  });

  it('encode of a value JSON.stringify throws on raises RUNTIME.ENCODE_FAILED', async () => {
    const codec = arktypeJsonColumn(type('object')).codecFactory(SYNTH_CTX);

    const error = await codec.toWire({ big: 1n } as never, CALL_CTX).then(
      () => {
        throw new Error('expected encode to reject');
      },
      (err: unknown) => err,
    );
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'RUNTIME.ENCODE_FAILED',
      message: `arktype-json value could not be serialized to JSON (codecId: ${ARKTYPE_JSON_CODEC_ID})`,
      details: { codecId: ARKTYPE_JSON_CODEC_ID },
      cause: expect.any(TypeError),
    });
  });

  it('toDataTypeValue of a non-JSON-representable value raises RUNTIME.ENCODE_FAILED', () => {
    const codec = arktypeJsonColumn(type('object')).codecFactory(SYNTH_CTX);

    let error: unknown;
    try {
      codec.toDataTypeValue(undefined as never);
    } catch (err) {
      error = err;
    }
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({ code: 'RUNTIME.ENCODE_FAILED' });
  });

  it('arktypeJsonColumn with a non-callable schema raises CONTRACT.ARGUMENT_INVALID', () => {
    let error: unknown;
    try {
      arktypeJsonColumn({} as never);
    } catch (err) {
      error = err;
    }
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'CONTRACT.ARGUMENT_INVALID',
      message: 'arktypeJsonColumn(schema) expects a callable arktype Type.',
      details: { helperPath: 'arktypeJsonColumn', received: 'object' },
    });
  });

  it('arktypeJsonColumn with a callable lacking `expression` raises CONTRACT.ARGUMENT_INVALID', () => {
    let error: unknown;
    try {
      arktypeJsonColumn((() => undefined) as never);
    } catch (err) {
      error = err;
    }
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'CONTRACT.ARGUMENT_INVALID',
      message: 'arktypeJsonColumn(schema) expects an arktype Type (missing `expression: string`).',
    });
  });

  it('arktypeJsonColumn with a schema lacking `json` IR raises CONTRACT.ARGUMENT_INVALID', () => {
    const fake = Object.assign(() => undefined, { expression: 'object' });
    let error: unknown;
    try {
      arktypeJsonColumn(fake as never);
    } catch (err) {
      error = err;
    }
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'CONTRACT.ARGUMENT_INVALID',
      message: 'arktypeJsonColumn(schema) expects an arktype Type (missing `json` IR).',
    });
  });
});
