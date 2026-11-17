import { describe, expect, it } from 'vitest';

import { jsonToTsSource, tsArraySource, tsObjectSource } from '../src/json-to-ts-source';

describe('jsonToTsSource', () => {
  describe('JSON-compatible values', () => {
    it('renders primitives', () => {
      expect(jsonToTsSource(null)).toBe('null');
      expect(jsonToTsSource(undefined)).toBe('undefined');
      expect(jsonToTsSource('hello')).toBe('"hello"');
      expect(jsonToTsSource(42)).toBe('42');
      expect(jsonToTsSource(true)).toBe('true');
      expect(jsonToTsSource(false)).toBe('false');
    });

    it('renders arrays', () => {
      expect(jsonToTsSource([])).toBe('[]');
      expect(jsonToTsSource([1, 2, 3])).toBe('[1, 2, 3]');
    });

    it('renders arrays on multiple lines when the single-line form exceeds 80 chars', () => {
      const longString = 'x'.repeat(40);
      expect(jsonToTsSource([longString, longString])).toBe(
        `[\n  "${longString}",\n  "${longString}",\n]`,
      );
    });

    it('renders objects and quotes non-identifier keys', () => {
      expect(jsonToTsSource({ a: 1, 'weird-key': 2 })).toBe('{ a: 1, "weird-key": 2 }');
    });

    it('renders objects on multiple lines when the single-line form exceeds 80 chars', () => {
      const longString = 'x'.repeat(40);
      expect(jsonToTsSource({ a: longString, b: longString })).toBe(
        `{\n  a: "${longString}",\n  b: "${longString}",\n}`,
      );
    });

    it('quotes the reserved key "__proto__"', () => {
      // A computed key is required because `{ __proto__: 1 }` in an object literal
      // is a special syntactic form that assigns the prototype rather than creating
      // an own property. This is the only way to produce an own `__proto__` key.
      expect(jsonToTsSource({ ['__proto__']: 1 })).toBe('{ "__proto__": 1 }');
    });

    it('drops object entries whose value is undefined', () => {
      expect(jsonToTsSource({ a: undefined })).toBe('{}');
      expect(jsonToTsSource({ a: 1, b: undefined })).toBe('{ a: 1 }');
    });

    it('escapes U+2028 line separator in strings so it cannot terminate the string literal', () => {
      expect(jsonToTsSource('a b')).toBe('"a\\u2028b"');
    });

    it('escapes U+2029 paragraph separator in strings so it cannot terminate the string literal', () => {
      expect(jsonToTsSource('a b')).toBe('"a\\u2029b"');
    });

    it('escapes U+2028 in an object key that needs quoting', () => {
      expect(jsonToTsSource({ ['weird key']: 1 })).toBe('{ "weird\\u2028key": 1 }');
    });
  });

  describe('non-JSON inputs bounds', () => {
    // The `unknown` input type is a documented ergonomic concession (so structural
    // types whose fields happen to be JSON-compatible can be passed without an
    // index signature). The escape hatch is explicitly bounded by a runtime throw
    // whenever the actual value is outside the JSON universe — codecs must encode
    // first (see the module docstring).
    it('throws on Symbol', () => {
      expect(() => jsonToTsSource(Symbol('s'))).toThrowError(/unsupported value type "symbol"/);
    });

    it('throws on BigInt', () => {
      expect(() => jsonToTsSource(BigInt(1))).toThrowError(/unsupported value type "bigint"/);
    });

    it('throws on function', () => {
      expect(() => jsonToTsSource(() => 1)).toThrowError(/unsupported value type "function"/);
    });
  });
});

describe('tsObjectSource', () => {
  it('renders an empty object for no entries', () => {
    expect(tsObjectSource([])).toBe('{}');
  });

  it('renders entry sources verbatim on one line and quotes non-identifier keys', () => {
    expect(
      tsObjectSource([
        ['a', '`x`'],
        ['weird-key', 'y()'],
      ]),
    ).toBe('{ a: `x`, "weird-key": y() }');
  });

  it('renders on multiple lines when the single-line form exceeds 80 chars', () => {
    const longSource = `"${'x'.repeat(40)}"`;
    expect(
      tsObjectSource([
        ['a', longSource],
        ['b', longSource],
      ]),
    ).toBe(`{\n  a: ${longSource},\n  b: ${longSource},\n}`);
  });

  it('renders on multiple lines when an entry source holds a line break', () => {
    expect(tsObjectSource([['a', '[\n  1,\n]']])).toBe('{\n  a: [\n  1,\n],\n}');
  });
});

describe('tsArraySource', () => {
  it('renders an empty array for no items', () => {
    expect(tsArraySource([])).toBe('[]');
  });

  it('renders item sources verbatim on one line', () => {
    expect(tsArraySource(['`x`', 'y()'])).toBe('[`x`, y()]');
  });

  it('renders on multiple lines when the single-line form exceeds 80 chars', () => {
    const longSource = `"${'x'.repeat(40)}"`;
    expect(tsArraySource([longSource, longSource])).toBe(
      `[\n  ${longSource},\n  ${longSource},\n]`,
    );
  });

  it('renders on multiple lines when an item source holds a line break', () => {
    expect(tsArraySource(['[\n  1,\n]'])).toBe('[\n  [\n  1,\n],\n]');
  });
});
