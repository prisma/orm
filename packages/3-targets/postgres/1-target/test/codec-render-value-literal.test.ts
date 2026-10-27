import type { JsonValue } from '@internal/contract/types';
import type { AnyCodecDescriptor } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import {
  codecDescriptors,
  pgBoolDescriptor,
  pgEnumDescriptor,
  pgFloat4Descriptor,
  pgFloat8Descriptor,
  pgFloatDescriptor,
  pgInt2Descriptor,
  pgInt4Descriptor,
  pgInt8Descriptor,
  pgTextDescriptor,
} from '../src/core/codecs';

function valueRendererFor(
  descriptor: AnyCodecDescriptor,
): ((value: unknown, side: 'output' | 'input') => string | undefined) | undefined {
  return descriptor.renderValueLiteral as
    | ((value: unknown, side: 'output' | 'input') => string | undefined)
    | undefined;
}

describe('codec renderValueLiteral', () => {
  describe('pg/text@1', () => {
    const renderer = valueRendererFor(pgTextDescriptor);

    it('renders a quoted string literal for output', () => {
      expect(renderer?.('low', 'output')).toBe('"low"');
    });

    it('renders a quoted string literal for input', () => {
      expect(renderer?.('high', 'input')).toBe('"high"');
    });

    it('escapes double quotes in string values', () => {
      expect(renderer?.('say "hi"', 'output')).toBe('"say \\"hi\\""');
      expect(renderer?.("it's", 'output')).toBe('"it\'s"');
    });

    it('escapes newlines and carriage returns (invalid raw in a quoted literal)', () => {
      expect(renderer?.('a\nb', 'output')).toBe('"a\\nb"');
      expect(renderer?.('a\r\nb', 'output')).toBe('"a\\r\\nb"');
    });
  });

  describe('pg/int4@1', () => {
    const renderer = valueRendererFor(pgInt4Descriptor);

    it('renders a numeric literal', () => {
      expect(renderer?.(1, 'output')).toBe('1');
    });

    it('renders zero', () => {
      expect(renderer?.(0, 'output')).toBe('0');
    });
  });

  describe('pg/int2@1', () => {
    it('renders a numeric literal', () => {
      expect(valueRendererFor(pgInt2Descriptor)?.(42, 'output')).toBe('42');
    });
  });

  describe('pg/int8@1', () => {
    it('renders a bigint literal from the canonical decimal text', () => {
      expect(valueRendererFor(pgInt8Descriptor)?.('100', 'output')).toBe('100n');
    });

    it('renders nothing for a value that is not decimal text', () => {
      expect(valueRendererFor(pgInt8Descriptor)?.(100, 'output')).toBeUndefined();
    });
  });

  describe('pg/float4@1', () => {
    it('renders a numeric literal', () => {
      expect(valueRendererFor(pgFloat4Descriptor)?.(1.5, 'output')).toBe('1.5');
    });
  });

  describe('pg/float8@1', () => {
    it('renders a numeric literal', () => {
      expect(valueRendererFor(pgFloat8Descriptor)?.(3.14, 'output')).toBe('3.14');
    });
  });

  describe.each([
    ['pg/float4@1', pgFloat4Descriptor],
    ['pg/float8@1', pgFloat8Descriptor],
    ['pg/float@1', pgFloatDescriptor],
  ])('%s', (_codecId, descriptor) => {
    it('renders no literal for NaN or an infinity, whose stored form is text', () => {
      const renderer = valueRendererFor(descriptor);
      expect(
        ['NaN', 'Infinity', '-Infinity', 2.5].map((value) => renderer?.(value, 'output')),
      ).toEqual([undefined, undefined, undefined, '2.5']);
    });
  });

  describe('pg/bool@1', () => {
    const renderer = valueRendererFor(pgBoolDescriptor);

    it('renders true literal', () => {
      expect(renderer?.(true, 'output')).toBe('true');
    });

    it('renders false literal', () => {
      expect(renderer?.(false, 'output')).toBe('false');
    });
  });

  describe('pg/enum@1', () => {
    const renderer = valueRendererFor(pgEnumDescriptor);

    it('renders a quoted string literal for output', () => {
      expect(renderer?.('aal1', 'output')).toBe('"aal1"');
    });

    it('renders a quoted string literal for input', () => {
      expect(renderer?.('aal2', 'input')).toBe('"aal2"');
    });

    it('escapes double quotes in member values', () => {
      expect(renderer?.('say "hi"', 'output')).toBe('"say \\"hi\\""');
      expect(renderer?.("it's", 'output')).toBe('"it\'s"');
    });
  });
});

/** A stored value of each data type, and the literal each codec of the type renders for it. */
const storedValues: Readonly<Record<string, JsonValue>> = {
  'pg/char': 'a',
  'pg/varchar': 'low',
  'pg/text': 'low',
  'pg/enum': 'low',
  'pg/int2': 1,
  'pg/int4': 1,
  'pg/int8': '1',
  'pg/float4': 1.5,
  'pg/float8': 1.5,
  'pg/numeric': '2',
  'pg/date': '2024-01-01',
  'pg/timestamp': '2024-01-01T00:00:00',
  'pg/timestamptz': '2024-01-01T00:00:00Z',
  'pg/time': '12:34:56',
  'pg/timetz': '12:34:56+02:00',
  'pg/bool': true,
  'pg/bit': '1',
  'pg/varbit': '101',
  'pg/bytea': 'aGVsbG8=',
  'pg/uuid': 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  'pg/inet': '127.0.0.1',
  'pg/interval': 'P1D',
  'pg/json': 'x',
  'pg/jsonb': 'x',
  'pg/text-array': ['a'],
  'pg/tsquery': 'a & b',
};

describe('the literal each registered codec renders', () => {
  it('is pinned for a stored value of its data type', () => {
    const rendered = Object.fromEntries(
      codecDescriptors.map((descriptor) => [
        descriptor.codecId,
        valueRendererFor(descriptor)?.(storedValues[descriptor.dataType], 'output'),
      ]),
    );

    expect(rendered).toEqual({
      'sql/char@1': '"a"',
      'sql/varchar@1': '"low"',
      'sql/int@1': '1',
      'sql/float@1': '1.5',
      'sql/text@1': '"low"',
      'pg/text@1': '"low"',
      'pg/enum@1': '"low"',
      'pg/char@1': '"a"',
      'pg/varchar@1': '"low"',
      'pg/int@1': '1',
      'pg/float@1': '1.5',
      'pg/int4@1': '1',
      'pg/int2@1': '1',
      'pg/int8@1': '1n',
      'pg/int8number@1': '1',
      'pg/float4@1': '1.5',
      'pg/float8@1': '1.5',
      'pg/numeric@1': undefined,
      'pg/unboundedint@1': '2n',
      'pg/date-temporal@1': undefined,
      'pg/timestamp-temporal@1': undefined,
      'pg/timestamptz-temporal@1': undefined,
      'pg/time-temporal@1': undefined,
      'pg/date-string@1': '"2024-01-01"',
      'pg/timestamp-string@1': '"2024-01-01T00:00:00"',
      'pg/timestamptz-string@1': '"2024-01-01T00:00:00Z"',
      'pg/timestamptz-date@1': undefined,
      'pg/timestamp-date@1': undefined,
      'pg/timestamp-instant@1': undefined,
      'pg/time-string@1': '"12:34:56"',
      'pg/timetz@1': '"12:34:56+02:00"',
      'pg/bool@1': 'true',
      'pg/bit@1': '"1"',
      'pg/varbit@1': '"101"',
      'pg/bytea@1': undefined,
      'pg/uuid@1': '"a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"',
      'pg/inet@1': '"127.0.0.1"',
      'pg/interval@1': undefined,
      'pg/interval-string@1': undefined,
      'pg/json@1': undefined,
      'pg/jsonb@1': undefined,
      'pg/text-array@1': undefined,
      'pg/tsquery@1': undefined,
    });
  });
});
