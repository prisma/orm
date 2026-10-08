import type { JsonValue } from '@internal/contract/types';
import { describe, expect, it, vi } from 'vitest';
import { dataType, dataTypeValueFor, dataTypeValuesEqual } from '../src/shared/data-type';
import { readJsonMatching, refuseJsonValue } from '../src/shared/json-readers';

const DIGITS = /^-?\d+(?:\.\d+)?$/;

function fractionDigits(params: Readonly<Record<string, unknown>>): number | undefined {
  return typeof params['scale'] === 'number' ? params['scale'] : undefined;
}

const decimal = dataType('demo/decimal', {
  read: (json, params) => {
    const text = readJsonMatching('demo/decimal', json, DIGITS, 'decimal text');
    const scale = fractionDigits(params);
    const fraction = text.split('.')[1] ?? '';
    if (scale !== undefined && fraction.replace(/0+$/, '').length > scale) {
      return refuseJsonValue(
        'demo/decimal',
        `decimal text with at most ${scale} fraction digits`,
        json,
      );
    }
    return text;
  },
  spell: (json, params) => {
    const scale = fractionDigits(params);
    if (typeof json !== 'string' || scale === undefined) return json;
    const [whole = '', fraction = ''] = json.split('.');
    return scale === 0 ? whole : `${whole}.${fraction.slice(0, scale).padEnd(scale, '0')}`;
  },
});

const document = dataType('demo/document', { read: (json) => json });

describe('fromContract', () => {
  it('constructs a value of the type with its parameters and its stored JSON', () => {
    const value = decimal.fromContract('1.50', { scale: 2 });
    expect({ type: value.type, params: value.params, value: value.value }).toEqual({
      type: 'demo/decimal',
      params: { scale: 2 },
      value: '1.50',
    });
  });

  it('refuses JSON in a spelling other than the one its parameters give, naming that spelling', () => {
    expect(() => decimal.fromContract('1.5', { scale: 2 })).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.DECODE_FAILED',
        message:
          'demo/decimal JSON value must be "1.50", the spelling its parameters give this value',
        meta: { dataType: 'demo/decimal', received: '"1.5"' },
      }),
    );
  });

  it('constructs a frozen value', () => {
    const value = decimal.fromContract('1', {});
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.params)).toBe(true);
  });

  it('refuses JSON the type does not store, naming the type', () => {
    expect(() => decimal.fromContract(1.5, {})).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.DECODE_FAILED',
        message: 'demo/decimal JSON value must be decimal text',
        meta: { dataType: 'demo/decimal', received: '1.5' },
      }),
    );
  });

  it('refuses a value its parameters exclude', () => {
    expect(() => decimal.fromContract('1.234', { scale: 2 })).toThrow(
      /must be decimal text with at most 2 fraction digits/,
    );
  });
});

describe('toContract', () => {
  it('gives the JSON to store', () => {
    expect(decimal.toContract(decimal.fromContract('42', {}))).toBe('42');
  });

  it('refuses a value of another type', () => {
    expect(() => decimal.toContract(document.fromContract('42', {}))).toThrow(
      /demo\/document.*demo\/decimal/,
    );
  });
});

describe('withParams', () => {
  it('writes the spelling the parameters give a value', () => {
    const value = decimal.withParams(decimal.fromContract('1.5', {}), { scale: 2 });
    expect({ params: value.params, value: value.value }).toEqual({
      params: { scale: 2 },
      value: '1.50',
    });
  });

  it('refuses a value the parameters exclude, rather than rounding it', () => {
    expect(() => decimal.withParams(decimal.fromContract('1.234', {}), { scale: 2 })).toThrow(
      /at most 2 fraction digits/,
    );
  });

  it('leaves the JSON unchanged for a type whose parameters never change a spelling', () => {
    expect(document.withParams(document.fromContract({ a: 1 }, {}), {}).value).toEqual({ a: 1 });
  });
});

describe('dataTypeValueFor', () => {
  it('constructs a value with the parameters, in the spelling they give it', () => {
    const value = dataTypeValueFor(decimal, { scale: 2 }, '1.5');
    expect(dataTypeValuesEqual(value, decimal.fromContract('1.50', { scale: 2 }))).toBe(true);
  });

  it('refuses a value the parameters exclude', () => {
    expect(() => dataTypeValueFor(decimal, { scale: 2 }, '1.234')).toThrow(
      /at most 2 fraction digits/,
    );
  });

  it('constructs through a type declared by spreading another declaration', () => {
    const spread = { ...decimal };
    expect(dataTypeValueFor(spread, { scale: 2 }, '1.5').value).toBe('1.50');
  });

  it('constructs through the type itself, which a second copy of this module can call', () => {
    const fromCodec = vi.fn(decimal.fromCodec);
    dataTypeValueFor({ ...decimal, fromCodec }, { scale: 2 }, '7');
    expect(fromCodec).toHaveBeenCalledWith('7', { scale: 2 });
  });
});

describe('dataTypeValuesEqual', () => {
  const of = (json: JsonValue, params: Readonly<Record<string, unknown>> = {}) =>
    document.fromContract(json, params);

  it('holds for one type, equal parameters and JSON equal as canonical JSON', () => {
    expect(
      dataTypeValuesEqual(of({ a: 1, b: 2 }, { x: 1, y: 2 }), of({ b: 2, a: 1 }, { y: 2, x: 1 })),
    ).toBe(true);
  });

  it('fails for different JSON', () => {
    expect(dataTypeValuesEqual(of('1.5'), of('1.50'))).toBe(false);
  });

  it('fails for different parameters', () => {
    expect(dataTypeValuesEqual(of('1'), of('1', { scale: 0 }))).toBe(false);
  });

  it('fails for different types', () => {
    expect(dataTypeValuesEqual(of('1'), decimal.fromContract('1', {}))).toBe(false);
  });
});
