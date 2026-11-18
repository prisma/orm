import {
  printedTaggedLiteralReadsBack,
  printTaggedLiteral,
} from '@internal/framework-components/authoring';
import { dataType } from '@internal/framework-components/codec';
import { diffSchemas } from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';

import { SqlColumnDefaultIR } from '../src/ir/sql-column-default-ir';

const text = dataType('t/text', { read: (json) => json });
const numeric = dataType('t/numeric', { read: (json) => json });

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

  it('keeps the value and the reason it could not be read out of JSON', () => {
    const node = new SqlColumnDefaultIR({
      resolved: { kind: 'literal', value: 'draft' },
      value: text.fromContract('draft', {}),
      unreadable: 'no',
    });
    expect(JSON.parse(JSON.stringify(node))).toEqual({
      nodeKind: 'sql-column-default',
      resolved: { kind: 'literal', value: 'draft' },
    });
  });

  describe('isEqualTo (this = expected)', () => {
    const literal = (value: string, read?: string) =>
      new SqlColumnDefaultIR({
        resolved: { kind: 'literal', value },
        value: text.fromContract(read ?? value, {}),
      });

    it('compares two values of the column type as values', () => {
      expect(literal('draft').isEqualTo(literal('draft'))).toBe(true);
    });

    it('is false when the values differ', () => {
      expect(literal('draft').isEqualTo(literal('published'))).toBe(false);
    });

    it('compares the values, not the stored JSON beside them', () => {
      expect(literal('draft', 'a').isEqualTo(literal('draft', 'b'))).toBe(false);
    });

    it('is false when the values are held under different parameters', () => {
      const under = (scale: number) =>
        new SqlColumnDefaultIR({
          resolved: { kind: 'literal', value: '1.50' },
          value: numeric.fromContract('1.50', { scale }),
        });
      expect(under(2).isEqualTo(under(3))).toBe(false);
    });

    it('compares a list element by element, with SQL NULL as null', () => {
      const list = (elements: readonly (string | null)[]) =>
        new SqlColumnDefaultIR({
          resolved: { kind: 'literal', value: [...elements] },
          value: elements.map((element) =>
            element === null ? null : text.fromContract(element, {}),
          ),
        });
      expect({
        same: list(['a', null]).isEqualTo(list(['a', null])),
        otherElement: list(['a', null]).isEqualTo(list(['a', 'b'])),
        otherLength: list(['a']).isEqualTo(list(['a', null])),
      }).toEqual({ same: true, otherElement: false, otherLength: false });
    });

    it('compares stored JSON as canonical JSON when a side has no value', () => {
      const expected = new SqlColumnDefaultIR({
        resolved: { kind: 'literal', value: { a: 1, b: 2 } },
      });
      const actual = new SqlColumnDefaultIR({
        resolved: { kind: 'literal', value: { b: 2, a: 1 } },
      });
      expect(expected.isEqualTo(actual)).toBe(true);
    });

    it('compares a Date default only as the value its codec read, never through its ISO text', () => {
      const date = new Date('2024-01-02T03:04:05.000Z');
      const expected = new SqlColumnDefaultIR({ resolved: { kind: 'literal', value: date } });
      const reported = new SqlColumnDefaultIR({
        resolved: { kind: 'literal', value: '2024-01-02T03:04:05.000Z' },
      });
      expect(expected.isEqualTo(reported)).toBe(false);
    });

    it('compares function expressions case- and whitespace-insensitively', () => {
      const expected = new SqlColumnDefaultIR({
        resolved: { kind: 'function', expression: 'NOW()' },
      });
      const actual = new SqlColumnDefaultIR({
        resolved: { kind: 'function', expression: 'now ()' },
      });
      expect(expected.isEqualTo(actual)).toBe(true);
    });

    it('compares an expression default with the text the database reports for a literal', () => {
      const expected = new SqlColumnDefaultIR({
        resolved: { kind: 'function', expression: "'{}'::jsonb" },
      });
      const actual = (raw: string) =>
        new SqlColumnDefaultIR({ resolved: { kind: 'literal', value: {} }, raw });
      expect({
        same: expected.isEqualTo(actual("'{}'::jsonb")),
        other: expected.isEqualTo(actual("'[]'::jsonb")),
      }).toEqual({ same: true, other: false });
    });

    it('compares an expression that writes a literal with the reported literal by their values', () => {
      const expected = new SqlColumnDefaultIR({
        resolved: { kind: 'function', expression: "'hello'::text" },
      });
      const actual = (reported: string) =>
        new SqlColumnDefaultIR({
          resolved: { kind: 'literal', value: reported },
          raw: `'${reported}'::character varying`,
          value: text.fromContract(reported, {}),
          expressionValue: text.fromContract('hello', {}),
        });
      expect({
        same: expected.isEqualTo(actual('hello')),
        other: expected.isEqualTo(actual('bye')),
      }).toEqual({ same: true, other: false });
    });

    it('compares an expression that writes a literal by value, not by its text, when both have one', () => {
      const expected = new SqlColumnDefaultIR({
        resolved: { kind: 'function', expression: "'Hello'::text" },
      });
      const actual = new SqlColumnDefaultIR({
        resolved: { kind: 'literal', value: 'hello' },
        raw: "'hello'::text",
        value: text.fromContract('hello', {}),
        expressionValue: text.fromContract('Hello', {}),
      });
      expect(expected.isEqualTo(actual)).toBe(false);
    });

    it('keeps case and spaces inside quotes when it compares text', () => {
      const expected = (expression: string) =>
        new SqlColumnDefaultIR({ resolved: { kind: 'function', expression } });
      expect({
        case: expected("'Hello'").isEqualTo(new SqlColumnDefaultIR({ raw: "'hello'" })),
        spaces: expected("'a b'").isEqualTo(new SqlColumnDefaultIR({ raw: "'ab'" })),
        quotedIdentifier: expected('"Seq"').isEqualTo(new SqlColumnDefaultIR({ raw: '"seq"' })),
        outside: expected("'a b'::TEXT").isEqualTo(
          new SqlColumnDefaultIR({ raw: "'a b' :: text" }),
        ),
        escapedQuote: expected("'it''s A'").isEqualTo(new SqlColumnDefaultIR({ raw: "'it''s a'" })),
      }).toEqual({
        case: false,
        spaces: false,
        quotedIdentifier: false,
        outside: true,
        escapedQuote: false,
      });
    });

    it('compares an expression with the reported text of a default no codec read', () => {
      const expected = new SqlColumnDefaultIR({
        resolved: { kind: 'function', expression: "'x'" },
      });
      expect({
        same: expected.isEqualTo(new SqlColumnDefaultIR({ raw: "'x'" })),
        other: expected.isEqualTo(new SqlColumnDefaultIR({ raw: "'y'" })),
      }).toEqual({ same: true, other: false });
    });

    it('is false for a literal against a function', () => {
      const expected = new SqlColumnDefaultIR({ resolved: { kind: 'literal', value: 'now()' } });
      const actual = new SqlColumnDefaultIR({
        resolved: { kind: 'function', expression: 'now()' },
      });
      expect(expected.isEqualTo(actual)).toBe(false);
    });

    it('is false when the expected is resolved but the actual carries only raw text', () => {
      const expected = new SqlColumnDefaultIR({ resolved: { kind: 'literal', value: 'x' } });
      const actual = new SqlColumnDefaultIR({ raw: "'x'::text" });
      expect(expected.isEqualTo(actual)).toBe(false);
    });

    it('falls back to raw text equality for raw-only nodes', () => {
      const a = new SqlColumnDefaultIR({ raw: "'x'" });
      expect({
        same: a.isEqualTo(new SqlColumnDefaultIR({ raw: "'x'" })),
        other: a.isEqualTo(new SqlColumnDefaultIR({ raw: "'y'" })),
      }).toEqual({ same: true, other: false });
    });
  });

  describe('explainMismatch (this = expected)', () => {
    const expected = new SqlColumnDefaultIR({ resolved: { kind: 'literal', value: 'x' } });

    it('gives the reason the column codec could not read the database default', () => {
      const actual = new SqlColumnDefaultIR({
        raw: "'x'::text",
        unreadable: 'The codec refused it.',
      });
      expect(expected.explainMismatch(actual)).toEqual({
        text: 'The codec refused it.',
        cause: 'differs',
      });
    });

    it('names the value the contract holds and the value the database holds', () => {
      const actual = new SqlColumnDefaultIR({ resolved: { kind: 'literal', value: 'y' } });
      expect({
        read: expected.explainMismatch(actual),
        missing: expected.explainMismatch(undefined),
      }).toEqual({
        read: { text: 'The contract holds "x", and the database holds "y".', cause: 'differs' },
        missing: undefined,
      });
    });

    it('names a value by the value its type read, with the text the database reports', () => {
      const date = dataType('t/date', { read: (json) => json });
      const contract = new SqlColumnDefaultIR({
        resolved: { kind: 'literal', value: '-000043-03-15' },
        value: date.fromContract('-000043-03-15', {}),
      });
      const database = new SqlColumnDefaultIR({
        resolved: { kind: 'literal', value: '-000044-03-15' },
        raw: "'0045-03-15 BC'::date",
        value: date.fromContract('-000044-03-15', {}),
      });
      expect(contract.explainMismatch(database)).toEqual({
        text: `The contract holds "-000043-03-15", and the database holds "-000044-03-15" ('0045-03-15 BC'::date).`,
        cause: 'differs',
      });
    });

    it('names an expression by its text', () => {
      const contract = new SqlColumnDefaultIR({
        resolved: { kind: 'function', expression: 'now()' },
      });
      const database = new SqlColumnDefaultIR({ raw: "'x'::text" });
      expect(contract.explainMismatch(database)).toEqual({
        text: "The contract holds now(), and the database holds 'x'::text.",
        cause: 'differs',
      });
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

      it('escapes a backslash before another, so the literal reads back as the stored text', () => {
        expect(
          declared(String.raw`lower('a\\b')`).explainMismatch(
            stored(String.raw`lower('a\\b'::text)`),
          )?.text,
        ).toBe(
          String.raw`The database reads this default back as sql` +
            '`' +
            String.raw`lower('a\\\b'::text)` +
            '`' +
            String.raw`; the contract declares sql` +
            '`' +
            String.raw`lower('a\\\b')` +
            '`' +
            `. ${HEDGE} If they do, write the default as sql\`` +
            String.raw`lower('a\\\b'::text)` +
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

      it('gives no explanation for an expression the database lacks', () => {
        expect(declared('now()').explainMismatch(undefined)).toBeUndefined();
      });

      it('explains an expression against a literal by the value each side holds', () => {
        const actual = new SqlColumnDefaultIR({ resolved: { kind: 'literal', value: 'x' } });
        expect(declared('now()').explainMismatch(actual)).toEqual({
          text: 'The contract holds now(), and the database holds "x".',
          cause: 'differs',
        });
      });

      it('raises no issue for texts that differ only in case, so nothing is explained', () => {
        expect(diffSchemas(declared('now()'), stored('NOW()'))).toEqual([]);
      });
    });
  });
});
