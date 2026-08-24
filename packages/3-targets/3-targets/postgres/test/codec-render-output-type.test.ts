import type { AnyCodecDescriptor } from '@internal/framework-components/codec';
import { sqlCharDescriptor, sqlVarcharDescriptor } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import {
  pgBitDescriptor,
  pgBoolDescriptor,
  pgCharDescriptor,
  pgInt4Descriptor,
  pgIntervalDescriptor,
  pgJsonbDescriptor,
  pgJsonDescriptor,
  pgNumericDescriptor,
  pgTextDescriptor,
  pgTimetzDescriptor,
  pgVarbitDescriptor,
  pgVarcharDescriptor,
} from '../src/core/codecs';

// `renderOutputType` is a `CodecDescriptor`-side concern after the SQL `Codec` narrow (TML-2357). Tests read the renderer from the descriptor directly.
function rendererFor(
  descriptor: AnyCodecDescriptor,
): ((typeParams: Record<string, unknown>) => string | undefined) | undefined {
  return descriptor.renderOutputType as
    | ((typeParams: Record<string, unknown>) => string | undefined)
    | undefined;
}

describe('codec renderOutputType', () => {
  describe('pg/char@1', () => {
    const renderer = rendererFor(pgCharDescriptor);

    it('renders Char<length> when length is present', () => {
      expect(renderer?.({ length: 36 })).toBe('Char<36>');
    });

    it('returns undefined when length is absent', () => {
      expect(renderer?.({})).toBeUndefined();
    });

    it('throws on invalid length type', () => {
      expect(() => renderer?.({ length: 'bad' })).toThrow(/expected integer "length"/);
    });
  });

  describe('pg/varchar@1', () => {
    const renderer = rendererFor(pgVarcharDescriptor);

    it('renders Varchar<length>', () => {
      expect(renderer?.({ length: 255 })).toBe('Varchar<255>');
    });

    it('returns undefined when length is absent', () => {
      expect(renderer?.({})).toBeUndefined();
    });

    it('throws on invalid length type', () => {
      expect(() => renderer?.({ length: 'bad' })).toThrow(/expected integer "length"/);
    });
  });

  describe('sql/char@1', () => {
    const renderer = rendererFor(sqlCharDescriptor);

    it('renders Char<length>', () => {
      expect(renderer?.({ length: 36 })).toBe('Char<36>');
    });
  });

  describe('sql/varchar@1', () => {
    const renderer = rendererFor(sqlVarcharDescriptor);

    it('renders Varchar<length>', () => {
      expect(renderer?.({ length: 100 })).toBe('Varchar<100>');
    });
  });

  describe('pg/numeric@1', () => {
    const renderer = rendererFor(pgNumericDescriptor);

    it('renders Numeric<P, S> when both precision and scale are present', () => {
      expect(renderer?.({ precision: 10, scale: 2 })).toBe('Numeric<10, 2>');
    });

    it('renders Numeric<P> when only precision is present', () => {
      expect(renderer?.({ precision: 10 })).toBe('Numeric<10>');
    });

    it('returns undefined when precision is absent', () => {
      expect(renderer?.({})).toBeUndefined();
    });
  });

  describe('pg/bit@1', () => {
    const renderer = rendererFor(pgBitDescriptor);

    it('renders Bit<length>', () => {
      expect(renderer?.({ length: 8 })).toBe('Bit<8>');
    });

    it('returns undefined when length is absent', () => {
      expect(renderer?.({})).toBeUndefined();
    });
  });

  describe('pg/varbit@1', () => {
    const renderer = rendererFor(pgVarbitDescriptor);

    it('renders VarBit<length>', () => {
      expect(renderer?.({ length: 16 })).toBe('VarBit<16>');
    });
  });

  describe('pg/timetz@1', () => {
    const renderer = rendererFor(pgTimetzDescriptor);

    it('renders Timetz<P>', () => {
      expect(renderer?.({ precision: 3 })).toBe('Timetz<3>');
    });
  });

  describe('pg/interval@1', () => {
    const renderer = rendererFor(pgIntervalDescriptor);

    it('renders Interval<P>', () => {
      expect(renderer?.({ precision: 3 })).toBe('Interval<3>');
    });
  });

  // Phase C: pg/json@1 and pg/jsonb@1 no longer carry renderOutputType. The schema-typed JSON column surface that drove typeParams.schemaJson / typeParams.type retired in favor of the per-library extension (`@internal/extension-arktype-json`). Untyped raw json/jsonb columns have no typeParams; the framework emit path falls through to the generic CodecTypes accessor.
  describe('pg/jsonb@1', () => {
    it('has no renderOutputType (raw JSONB)', () => {
      expect(rendererFor(pgJsonbDescriptor)).toBeUndefined();
    });
  });

  describe('pg/json@1', () => {
    it('has no renderOutputType (raw JSON)', () => {
      expect(rendererFor(pgJsonDescriptor)).toBeUndefined();
    });
  });

  describe('non-parameterized codecs', () => {
    it('pg/int4@1 has no renderOutputType', () => {
      expect(rendererFor(pgInt4Descriptor)).toBeUndefined();
    });

    it('pg/text@1 has no renderOutputType', () => {
      expect(rendererFor(pgTextDescriptor)).toBeUndefined();
    });

    it('pg/bool@1 has no renderOutputType', () => {
      expect(rendererFor(pgBoolDescriptor)).toBeUndefined();
    });
  });
});
