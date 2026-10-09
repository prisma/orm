import type { ToCanonicalForm } from '@internal/framework-components/codec';
import { structuredError } from '@internal/utils/structured-error';
import { describe, expect, it } from 'vitest';

import { SqlColumnDefaultIR } from '../src/ir/sql-column-default-ir';

describe('SqlColumnDefaultIR', () => {
  it('id is the fixed sentinel (one default per column)', () => {
    expect(new SqlColumnDefaultIR({ raw: "'x'" }).id).toBe('default');
  });

  it('nodeKind is the column-default kind', () => {
    expect(new SqlColumnDefaultIR({ raw: "'x'" }).nodeKind).toBe('sql-column-default');
  });

  it('children is empty (a default is a leaf)', () => {
    expect(new SqlColumnDefaultIR({ raw: "'x'" }).children()).toEqual([]);
  });

  describe('isEqualTo (this = expected)', () => {
    it('literal defaults compare structurally, ignoring raw strings', () => {
      const expected = new SqlColumnDefaultIR({ resolved: { kind: 'literal', value: 'draft' } });
      const actual = new SqlColumnDefaultIR({
        resolved: { kind: 'literal', value: 'draft' },
        raw: "'draft'::text",
      });
      expect(expected.isEqualTo(actual)).toBe(true);
    });

    it('false when literal values differ', () => {
      const expected = new SqlColumnDefaultIR({ resolved: { kind: 'literal', value: 'draft' } });
      const actual = new SqlColumnDefaultIR({ resolved: { kind: 'literal', value: 'published' } });
      expect(expected.isEqualTo(actual)).toBe(false);
    });

    it('function expressions compare case- and whitespace-insensitively', () => {
      const expected = new SqlColumnDefaultIR({
        resolved: { kind: 'function', expression: 'NOW()' },
      });
      const actual = new SqlColumnDefaultIR({
        resolved: { kind: 'function', expression: 'now ()' },
      });
      expect(expected.isEqualTo(actual)).toBe(true);
    });

    it('a literal compares through the canonical form the contract-derived side carries', () => {
      const timestamptz: ToCanonicalForm = (value) =>
        typeof value === 'string'
          ? value.replace(' ', 'T').replace('.000Z', 'Z').replace('+00', 'Z')
          : value;
      const expected = (withCanonicalForm: boolean) =>
        new SqlColumnDefaultIR({
          resolved: { kind: 'literal', value: new Date('2024-01-02T03:04:05.000Z') },
          nativeTypeContext: 'timestamptz',
          ...(withCanonicalForm ? { toCanonicalForm: timestamptz } : {}),
        });
      const actual = new SqlColumnDefaultIR({
        resolved: { kind: 'literal', value: '2024-01-02 03:04:05+00' },
        nativeTypeContext: 'timestamptz',
      });
      expect({
        withCanonicalForm: expected(true).isEqualTo(actual),
        withoutCanonicalForm: expected(false).isEqualTo(actual),
      }).toEqual({ withCanonicalForm: true, withoutCanonicalForm: false });
    });

    it('JSON literals compare canonically: object vs equivalent JSON string', () => {
      const expected = new SqlColumnDefaultIR({
        resolved: { kind: 'literal', value: { a: 1, b: 2 } },
        nativeTypeContext: 'jsonb',
      });
      const actual = new SqlColumnDefaultIR({
        resolved: { kind: 'literal', value: '{"b":2,"a":1}' },
        nativeTypeContext: 'jsonb',
      });
      expect(expected.isEqualTo(actual)).toBe(true);
    });

    it('false when kinds differ (literal vs function)', () => {
      const expected = new SqlColumnDefaultIR({ resolved: { kind: 'literal', value: 'now()' } });
      const actual = new SqlColumnDefaultIR({
        resolved: { kind: 'function', expression: 'now()' },
      });
      expect(expected.isEqualTo(actual)).toBe(false);
    });

    it('false when the expected is resolved but the actual carries only an unparseable raw', () => {
      const expected = new SqlColumnDefaultIR({ resolved: { kind: 'literal', value: 'x' } });
      const actual = new SqlColumnDefaultIR({ raw: 'some_unparseable_expr()' });
      expect(expected.isEqualTo(actual)).toBe(false);
    });

    it('raw-only nodes fall back to raw string equality', () => {
      const a = new SqlColumnDefaultIR({ raw: "'x'" });
      const b = new SqlColumnDefaultIR({ raw: "'x'" });
      const c = new SqlColumnDefaultIR({ raw: "'y'" });
      expect(a.isEqualTo(b)).toBe(true);
      expect(a.isEqualTo(c)).toBe(false);
    });
  });

  describe('explainMismatch (this = expected)', () => {
    const timestamptz: ToCanonicalForm = (value) => {
      if (value === '2024-01-01T00:00:00Z') return value;
      throw structuredError(
        'CONTRACT.CAST_REFUSED',
        `pg/timestamptz needs a UTC offset, but ${JSON.stringify(value)} has none.`,
      );
    };
    it('names the refusal of a contract default its data type does not hold, and says to re-emit', () => {
      const expected = new SqlColumnDefaultIR({
        resolved: { kind: 'literal', value: '2024-01-01 00:00:00' },
        toCanonicalForm: timestamptz,
      });
      expect(expected.explainMismatch()).toBe(
        'The contract holds this default in a form its data type does not store: pg/timestamptz needs a UTC offset, but "2024-01-01 00:00:00" has none. Re-emit the contract, then try again.',
      );
    });

    it('gives no explanation for a default its data type holds', () => {
      const expected = new SqlColumnDefaultIR({
        resolved: { kind: 'literal', value: '2024-01-01T00:00:00Z' },
        toCanonicalForm: timestamptz,
      });
      expect(expected.explainMismatch()).toBeUndefined();
    });
  });
});
