import { describe, expect, it } from 'vitest';
import { findNonJsonValue } from '../src/json';

class Point {
  constructor(readonly x: number) {}
}

function cyclic(): Record<string, unknown> {
  const value: Record<string, unknown> = { a: 1 };
  value['self'] = value;
  return value;
}

function sparse(): unknown[] {
  const value: unknown[] = [1];
  value[2] = 3;
  return value;
}

describe('findNonJsonValue', () => {
  it.each([
    null,
    'text',
    '',
    true,
    false,
    0,
    -1.5,
    Number.MAX_VALUE,
    [],
    {},
    [1, 'a', null, [true], { b: [] }],
    { a: { b: { c: [1, 2, { d: null }] } } },
    Object.create(null),
  ])('finds nothing in the plain JSON value %j', (value) => {
    expect(findNonJsonValue(value)).toBeUndefined();
  });

  it('finds nothing in an object seen twice that is not its own ancestor', () => {
    const shared = { a: 1 };
    expect(findNonJsonValue({ left: shared, right: [shared, shared] })).toBeUndefined();
  });

  it.each([
    [undefined, 'undefined', ''],
    [Number.NaN, 'NaN', ''],
    [Number.POSITIVE_INFINITY, 'Infinity', ''],
    [Number.NEGATIVE_INFINITY, '-Infinity', ''],
    [1n, 'bigint', ''],
    [Symbol('s'), 'symbol', ''],
    [() => 1, 'function', ''],
    [new Date(0), 'Date', ''],
    [new Uint8Array([1]), 'Uint8Array', ''],
    [/a/, 'RegExp', ''],
    [new Map(), 'Map', ''],
    [new Point(1), 'Point', ''],
    [{ a: [1, { b: undefined }] }, 'undefined', 'a.1.b'],
    [{ a: { b: 1n } }, 'bigint', 'a.b'],
    [[1, 2, Number.NaN], 'NaN', '2'],
    [{ a: cyclic() }, 'circular reference', 'a.self'],
    [{ list: sparse() }, 'sparse array hole', 'list.1'],
  ])('finds %o, naming it %s at %j', (value, received, path) => {
    expect(findNonJsonValue(value)).toEqual({ received, path });
  });

  it('finds the first value that is not JSON, in the order the keys are listed', () => {
    expect(findNonJsonValue({ a: 1, b: undefined, c: Number.NaN })).toEqual({
      received: 'undefined',
      path: 'b',
    });
  });

  it('finds an array whose prototype is not Array.prototype, naming its constructor', () => {
    class List extends Array<number> {}
    expect(findNonJsonValue({ list: List.from([1]) })).toEqual({ received: 'List', path: 'list' });
  });

  it('names an object whose prototype has no constructor as an object', () => {
    const value = Object.create(Object.create(null));
    expect(findNonJsonValue({ value })).toEqual({ received: 'object', path: 'value' });
  });

  it('names an object as the tag the caller reads from it, before reading its shape', () => {
    const tagOf = (value: object) =>
      'tagged' in value && typeof value.tagged === 'string' ? value.tagged : undefined;
    expect({
      plainObjectWithTag: findNonJsonValue({ a: { tagged: 'Long' } }, { tagOf }),
      plainObjectWithoutTag: findNonJsonValue({ a: { other: 'Long' } }, { tagOf }),
    }).toEqual({
      plainObjectWithTag: { received: 'Long', path: 'a' },
      plainObjectWithoutTag: undefined,
    });
  });
});
