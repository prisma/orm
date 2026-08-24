import type { AnyCodecDescriptor } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import {
  pgBoolDescriptor,
  pgEnumDescriptor,
  pgFloat4Descriptor,
  pgFloat8Descriptor,
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
