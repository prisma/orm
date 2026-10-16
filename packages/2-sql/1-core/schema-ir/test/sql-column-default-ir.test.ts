import {
  printedTaggedLiteralReadsBack,
  printTaggedLiteral,
} from '@internal/framework-components/authoring';
import type { ToCanonicalForm } from '@internal/framework-components/codec';
import { diffSchemas } from '@internal/framework-components/control';
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
      expect(expected.explainMismatch(undefined)).toEqual({
        text: 'The contract holds this default in a form its data type does not store: pg/timestamptz needs a UTC offset, but "2024-01-01 00:00:00" has none. Re-emit the contract, then try again.',
        cause: 'expected-refused',
      });
    });

    it('gives no explanation for a default its data type holds', () => {
      const expected = new SqlColumnDefaultIR({
        resolved: { kind: 'literal', value: '2024-01-01T00:00:00Z' },
        toCanonicalForm: timestamptz,
      });
      expect(expected.explainMismatch(undefined)).toBeUndefined();
    });

    describe('two default expressions', () => {
      const sqlExpressionLiteralFor = (text: string) =>
        printedTaggedLiteralReadsBack(text) ? printTaggedLiteral('sql', text) : undefined;
      const HEDGE =
        'The database may store a default expression in its own form, so the two can mean the same.';

      function declared(text: string): SqlColumnDefaultIR {
        return new SqlColumnDefaultIR({
          resolved: { kind: 'function', expression: text },
          sqlExpressionLiteralFor,
        });
      }

      function stored(raw: string, parsed = raw): SqlColumnDefaultIR {
        return new SqlColumnDefaultIR({ resolved: { kind: 'function', expression: parsed }, raw });
      }

      it('shows the text the database reads back and the literal that writes it', () => {
        expect(
          declared("now() - interval '1 day'").explainMismatch(
            stored("(now() - '1 day'::interval)"),
          ),
        ).toEqual({
          text: `The database reads this default back as sql\`(now() - '1 day'::interval)\`; the contract declares sql\`now() - interval '1 day'\`. ${HEDGE} If they do, write the default as sql\`(now() - '1 day'::interval)\`.`,
          cause: 'possibly-equivalent',
        });
      });

      it('writes a text holding a backtick in the double-quote form', () => {
        expect(declared("lower('a`b')").explainMismatch(stored("lower('a`b'::text)"))?.text).toBe(
          `The database reads this default back as sql"lower('a\`b'::text)"; the contract declares sql"lower('a\`b')". ${HEDGE} If they do, write the default as sql"lower('a\`b'::text)".`,
        );
      });

      it('doubles a backslash, so the literal reads back as the stored text', () => {
        expect(
          declared(String.raw`lower('a\\b')`).explainMismatch(
            stored(String.raw`lower('a\\b'::text)`),
          )?.text,
        ).toBe(
          String.raw`The database reads this default back as sql` +
            '`' +
            String.raw`lower('a\\\\b'::text)` +
            '`' +
            String.raw`; the contract declares sql` +
            '`' +
            String.raw`lower('a\\\\b')` +
            '`' +
            `. ${HEDGE} If they do, write the default as sql\`` +
            String.raw`lower('a\\\\b'::text)` +
            '`.',
        );
      });

      it('writes a multi-line text on its own lines', () => {
        expect(
          declared('now()').explainMismatch(stored('CASE\n  WHEN true THEN now()\nEND'))?.text,
        ).toBe(
          `The database reads this default back as sql\`\nCASE\n  WHEN true THEN now()\nEND\n\`; the contract declares sql\`now()\`. ${HEDGE} If they do, write the default as sql\`\nCASE\n  WHEN true THEN now()\nEND\n\`.`,
        );
      });

      it('writes the parsed text when no literal writes the stored text', () => {
        expect(
          declared('now()').explainMismatch(
            stored('\nCASE\n  WHEN true THEN now()\nEND', 'CASE\n  WHEN true THEN now()\nEND'),
          )?.text,
        ).toBe(
          `The database reads this default back as sql\`\nCASE\n  WHEN true THEN now()\nEND\n\`; the contract declares sql\`now()\`. ${HEDGE} If they do, write the default as sql\`\nCASE\n  WHEN true THEN now()\nEND\n\`.`,
        );
      });

      it('says when no literal writes the stored or the parsed text, and quotes it plainly', () => {
        expect(declared('now()').explainMismatch(stored('now()\r'))).toEqual({
          text: `The database reads this default back as "now()\\r"; the contract declares sql\`now()\`. ${HEDGE} No \`sql\` literal writes that text unchanged, so change the default's SQL in the contract until the database stores it as written.`,
          cause: 'possibly-equivalent',
        });
      });

      it('shows the text the database stores, not its parsed form', () => {
        expect(
          declared('now() + 1').explainMismatch(stored('CURRENT_TIMESTAMP', 'now()'))?.text,
        ).toContain('reads this default back as sql`CURRENT_TIMESTAMP`');
      });

      it('explains real drift between two expressions too, as possibly equivalent', () => {
        expect(declared('now()').explainMismatch(stored('gen_random_uuid()'))?.cause).toBe(
          'possibly-equivalent',
        );
      });

      it('explains the mismatch without a way to write a literal, quoting the texts plainly', () => {
        const expected = new SqlColumnDefaultIR({
          resolved: { kind: 'function', expression: 'now()' },
        });
        expect(expected.explainMismatch(stored('(now())'))).toEqual({
          text: `The database reads this default back as "(now())"; the contract declares "now()". ${HEDGE} If they do, write the default as "(now())".`,
          cause: 'possibly-equivalent',
        });
      });

      it('gives no explanation for an expression against a literal', () => {
        const actual = new SqlColumnDefaultIR({ resolved: { kind: 'literal', value: 'x' } });
        expect(declared('now()').explainMismatch(actual)).toBeUndefined();
      });

      it('gives no explanation for a literal against an expression', () => {
        const expected = new SqlColumnDefaultIR({
          resolved: { kind: 'literal', value: 'x' },
          sqlExpressionLiteralFor,
        });
        expect(expected.explainMismatch(stored('now()'))).toBeUndefined();
      });

      it('gives no explanation for an expression the database lacks', () => {
        expect(declared('now()').explainMismatch(undefined)).toBeUndefined();
      });

      it('gives no explanation for an expression against an unparsed database default', () => {
        expect(
          declared('now()').explainMismatch(new SqlColumnDefaultIR({ raw: 'now()' })),
        ).toBeUndefined();
      });

      it('raises no issue for texts that differ only in case, so nothing is explained', () => {
        expect(diffSchemas(declared('now()'), stored('NOW()'))).toEqual([]);
      });
    });
  });
});
