import type { JsonValue } from '@internal/contract/types';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { dataType, dataTypeParams, dataTypeValuesEqual } from '../src/shared/data-type';
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
      'Data type demo/decimal takes only values of demo/decimal, and was handed a value of demo/document.',
    );
  });
});

describe('valueFrom', () => {
  it('writes the spelling the parameters give a value', () => {
    const value = decimal.valueFrom('1.5', { scale: 2 });
    expect({ params: value.params, value: value.value }).toEqual({
      params: { scale: 2 },
      value: '1.50',
    });
  });

  it('refuses a value the parameters exclude, rather than rounding it', () => {
    expect(() => decimal.valueFrom('1.234', { scale: 2 })).toThrow(/at most 2 fraction digits/);
  });

  it('leaves the JSON unchanged for a type whose parameters never change a spelling', () => {
    expect(document.valueFrom({ a: 1 }, {}).value).toEqual({ a: 1 });
  });

  it('constructs through a type declared by spreading another declaration', () => {
    const spread = { ...decimal };
    expect(spread.valueFrom('1.5', { scale: 2 }).value).toBe('1.50');
  });
});

describe('dataTypeParams', () => {
  const numeric = dataType('demo/numeric', {
    params: type({ 'precision?': 'number', 'scale?': 'number' }),
    read: (json) => json,
  });
  const vector = dataType('demo/vector', {
    params: type({ length: 'number' }),
    read: (json) => json,
  });

  it('keeps the optional and required keys the parameter schema declares', () => {
    expect(dataTypeParams(numeric, { precision: 10, scale: 2 })).toEqual({
      precision: 10,
      scale: 2,
    });
    expect(dataTypeParams(vector, { length: 3 })).toEqual({ length: 3 });
  });

  it('drops keys the data type does not declare, such as codec-owned ones', () => {
    expect(dataTypeParams(numeric, { precision: 10, expression: 'x', jsonIr: {} })).toEqual({
      precision: 10,
    });
  });

  it('keeps only the declared keys that are present', () => {
    expect(dataTypeParams(numeric, { precision: 10 })).toEqual({ precision: 10 });
  });

  it('gives a type without parameters nothing', () => {
    expect(dataTypeParams(document, { length: 5 })).toEqual({});
  });

  it('reads absent parameters as nothing', () => {
    expect(dataTypeParams(numeric, undefined)).toEqual({});
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
