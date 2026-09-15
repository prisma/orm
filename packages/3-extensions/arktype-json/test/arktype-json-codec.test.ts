/**
 * Runtime tests for the arktype-json codec (TML-2357). Canonical test suite for arktype-json codec behavior after the legacy `arktypeJson(schema)` form retired.
 *
 * Coverage:
 *
 * - the column-author helper produces a working codec whose `id` proxies through the descriptor's `codecId`.
 * - the descriptor's factory rehydrates the schema and returns a working codec for runtime materialization paths.
 * - encode/decode round-trip including encodeJson/decodeJson agreement on the JSON-safe normalized payload.
 * - schema validation rejects malformed payloads at decode, while encode only enforces JSON representability.
 */

import type { JsonValue } from '@internal/contract/types';
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

const SYNTH_CTX: CodecInstanceContext = { name: '<arktype-json-class-test>' };
const CALL_CTX: SqlCodecCallContext = {};

const productSchema = type({
  name: 'string',
  price: 'number',
  'description?': 'string',
});

describe('arktypeJsonColumn(schema)', () => {
  it('returns a ColumnSpec with codecId, nativeType, typeParams', () => {
    const col = arktypeJsonColumn(productSchema);
    expect(col.codecId).toBe(ARKTYPE_JSON_CODEC_ID);
    expect(col.nativeType).toBe('jsonb');
    expect(col.typeParams.expression).toBe(productSchema.expression);
    expect(col.typeParams.jsonIr).toEqual(productSchema.json);
  });

  it('codecFactory(ctx) materializes a working codec', async () => {
    const col = arktypeJsonColumn(productSchema);
    const codec = col.codecFactory(SYNTH_CTX);
    expect(codec.id).toBe(ARKTYPE_JSON_CODEC_ID);

    const value = { name: 'Widget', price: 9.99 };
    const wire = await codec.encode(value, CALL_CTX);
    expect(typeof wire).toBe('string');
    const decoded = await codec.decode(wire, CALL_CTX);
    expect(decoded).toEqual(value);
  });

  it('decode rejects payloads that fail schema validation', async () => {
    const col = arktypeJsonColumn(productSchema);
    const codec = col.codecFactory(SYNTH_CTX);
    const wire = JSON.stringify({ name: 'Widget' });
    expect(() => codec.decode(wire, CALL_CTX)).toThrow(/schema validation failed/);
  });

  it('decode accepts already-parsed jsonb values from the driver', async () => {
    const codec = arktypeJsonColumn(productSchema).codecFactory(SYNTH_CTX);
    const wire = { name: 'Widget', price: 10 };
    expect(await codec.decode(wire, CALL_CTX)).toEqual(wire);
  });

  it('decode validates pre-parsed payloads against the schema', async () => {
    const codec = arktypeJsonColumn(productSchema).codecFactory(SYNTH_CTX);
    expect(() => codec.decode({ name: 'Widget' }, CALL_CTX)).toThrow(/price/);
  });

  it('encodeJson / decodeJson round-trip through schema', () => {
    const col = arktypeJsonColumn(productSchema);
    const codec = col.codecFactory(SYNTH_CTX);
    const value = { name: 'Widget', price: 9.99, description: 'A widget' };
    const json = codec.encodeJson(value);
    const decoded = codec.decodeJson(json);
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

describe('arktypeJsonColumn encode/encodeJson agreement', () => {
  it('encode and encodeJson agree on the normalized payload', async () => {
    const codec = arktypeJsonColumn(productSchema).codecFactory(SYNTH_CTX);
    const original = { name: 'Widget', price: 10, description: 'desc' };
    const wire = await codec.encode(original, CALL_CTX);
    const json = codec.encodeJson(original);
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
    const wire = await codec.encode(widget, CALL_CTX);
    expect(wire).toBe('{"name":"Widget","price":10}');
  });

  it('encode does not run schema validation', async () => {
    const codec = arktypeJsonColumn(productSchema).codecFactory(SYNTH_CTX);
    await expect(codec.encode({ name: 'Widget' } as never, CALL_CTX)).resolves.toBe(
      '{"name":"Widget"}',
    );
  });

  it('encode rejects values that are not representable as JSON', async () => {
    const anySchema = type('object');
    const codec = arktypeJsonColumn(anySchema).codecFactory(SYNTH_CTX);
    await expect(codec.encode(undefined as never, CALL_CTX)).rejects.toThrow(
      /not representable as JSON/,
    );
    expect(() => codec.encodeJson(undefined as never)).toThrow(/not representable as JSON/);
  });

  it('decode rejects payloads with type-mismatched fields', async () => {
    const codec = arktypeJsonColumn(productSchema).codecFactory(SYNTH_CTX);
    const wire = JSON.stringify({ name: 'Widget', price: 'not-a-number' });
    expect(() => codec.decode(wire, CALL_CTX)).toThrow(/price/);
  });

  it('decode preserves the original validation error when fallback JSON parsing fails', async () => {
    const codec = arktypeJsonColumn(productSchema).codecFactory(SYNTH_CTX);
    expect(() => codec.decode('{not json', CALL_CTX)).toThrow(/schema validation failed/);
  });

  it('decode rethrows non-runtime schema errors from the raw string pass', async () => {
    const throwingSchema = Object.assign(
      (_value: unknown): unknown => {
        throw new Error('schema exploded');
      },
      { expression: 'unknown', json: {} },
    );
    const codec = arktypeJsonColumn(throwingSchema as never).codecFactory(SYNTH_CTX);

    expect(() => codec.decode('raw wire', CALL_CTX)).toThrow('schema exploded');
  });

  it('decode accepts pre-parsed JSON string primitives for string-schema columns', async () => {
    const stringSchema = type('string');
    const codec = arktypeJsonColumn(stringSchema).codecFactory(SYNTH_CTX);
    expect(await codec.decode('alice', CALL_CTX)).toBe('alice');
  });

  it('decode preserves pre-parsed JSON-looking string primitives', async () => {
    const stringSchema = type('string');
    const codec = arktypeJsonColumn(stringSchema).codecFactory(SYNTH_CTX);
    for (const value of ['42', 'true', 'null', '{"x":1}']) {
      expect(await codec.decode(value, CALL_CTX)).toBe(value);
    }
  });

  it('decode preserves quote-bounded strings byte-exact (jsonb pre-parsed)', async () => {
    // Regression: the previous `isJsonStringText` heuristic unwrapped any
    // `"…"`-shaped wire as JSON-encoded text. Under `pg` + `jsonb` the
    // wire is already pre-parsed, so `"bob"` (5 chars with literal quote
    // characters) IS the value — unwrapping silently truncated it to
    // `bob` (3 chars). The decoder must return the literal wire here.
    const stringSchema = type('string');
    const codec = arktypeJsonColumn(stringSchema).codecFactory(SYNTH_CTX);
    expect(await codec.decode('"bob"', CALL_CTX)).toBe('"bob"');
    expect(await codec.decode('"hello"', CALL_CTX)).toBe('"hello"');
    expect(await codec.decode('""', CALL_CTX)).toBe('""');
  });

  it('decode rejects pre-parsed primitives that violate the schema', async () => {
    const stringSchema = type('string');
    const codec = arktypeJsonColumn(stringSchema).codecFactory(SYNTH_CTX);
    expect(() => codec.decode(42, CALL_CTX)).toThrow(/string/);
  });
});

describe('arktypeJsonDescriptor.factory(params)', () => {
  it('rehydrates the schema from typeParams.jsonIr and produces a working codec', async () => {
    const col = arktypeJsonColumn(productSchema);
    const factory = arktypeJsonDescriptor.factory(col.typeParams);
    const codec = factory(SYNTH_CTX);
    expect(codec.id).toBe(ARKTYPE_JSON_CODEC_ID);

    const value = { name: 'Widget', price: 9.99 };
    const wire = await codec.encode(value, CALL_CTX);
    const decoded = await codec.decode(wire, CALL_CTX);
    expect(decoded).toEqual(value);
  });

  it('descriptor metadata: traits, targetTypes, native type', () => {
    const col = arktypeJsonColumn(productSchema);
    expect(arktypeJsonDescriptor.codecId).toBe(ARKTYPE_JSON_CODEC_ID);
    expect(arktypeJsonDescriptor.traits).toEqual(['equality']);
    expect(arktypeJsonDescriptor.targetTypes).toEqual(['jsonb']);
    // Parameterized, so the native type is asked for against a real ref: the
    // descriptor validates params before answering.
    expect(
      arktypeJsonDescriptor.nativeTypeFor({
        codecId: ARKTYPE_JSON_CODEC_ID,
        typeParams: {
          expression: col.typeParams.expression,
          jsonIr: col.typeParams.jsonIr as JsonValue,
        },
      }),
    ).toBe('jsonb');
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

    const error = await codec.encode(undefined as never, CALL_CTX).then(
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

    const error = await codec.encode({ big: 1n } as never, CALL_CTX).then(
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

  it('encodeJson of a non-JSON-representable value raises RUNTIME.ENCODE_FAILED', () => {
    const codec = arktypeJsonColumn(type('object')).codecFactory(SYNTH_CTX);

    let error: unknown;
    try {
      codec.encodeJson(undefined as never);
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
