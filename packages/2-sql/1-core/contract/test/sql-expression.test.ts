import { dataType } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import {
  assertNothingCastsFromSqlExpression,
  canonicalSqlText,
  printSqlExpressionLiteral,
  SQL_EXPRESSION_DATA_TYPE_ID,
  SQL_EXPRESSION_TAG,
  sqlExpressionAuthoringEntry,
  sqlExpressionDataType,
  sqlTextFromCanonical,
  sqlTextsReadBack,
} from '../src/sql-expression';

describe('sqlExpressionDataType', () => {
  it('has the id sql/expression and declares no casts and no list cast', () => {
    expect({
      id: sqlExpressionDataType.id,
      constant: SQL_EXPRESSION_DATA_TYPE_ID,
      casts: sqlExpressionDataType.casts,
      listCast: sqlExpressionDataType.listCast,
    }).toEqual({
      id: 'sql/expression',
      constant: 'sql/expression',
      casts: {},
      listCast: undefined,
    });
  });
});

describe('sqlExpressionAuthoringEntry', () => {
  it('is written with the sql tag', () => {
    expect({
      tag: SQL_EXPRESSION_TAG,
      written: { kind: sqlExpressionAuthoringEntry.written.kind },
      documentation: sqlExpressionAuthoringEntry.documentation,
    }).toEqual({
      tag: 'sql',
      written: { kind: 'tag' },
      documentation:
        "A SQL expression in the target database's language. Prisma passes it to the database unchanged.",
    });
    expect(sqlExpressionAuthoringEntry.written).toMatchObject({ kind: 'tag', tag: 'sql' });
  });

  it('reads a text as itself and prints it back', () => {
    const { written } = sqlExpressionAuthoringEntry;
    if (written.kind !== 'tag') throw new Error('the entry is written with a tag');
    const text = "now() + interval '3 days'";
    expect(sqlExpressionAuthoringEntry.print(written.parse(text))).toBe(text);
  });
});

describe('sqlTextFromCanonical', () => {
  it('returns a string', () => {
    expect(sqlTextFromCanonical('now()')).toBe('now()');
  });

  it.each([[1], [null], [{ text: 'x' }], [['x']]])('throws for %j', (value) => {
    expect(() => sqlTextFromCanonical(value)).toThrow(
      `A sql/expression value is a string, got ${JSON.stringify(value)}.`,
    );
  });
});

describe('printSqlExpressionLiteral', () => {
  it('prints a sql literal', () => {
    expect(printSqlExpressionLiteral('gen_random_uuid()')).toBe('sql`gen_random_uuid()`');
  });

  it('throws for a text that would not read back unchanged', () => {
    expect(() => printSqlExpressionLiteral('  a = 1')).toThrow(
      'A sql literal cannot hold "  a = 1": it would read back as different text.',
    );
  });

  it.each(['\n\n(a > 0)', '(a > 0)\n\n', '\n  \n(a > 0)', '\r\n\r\n(a)', '  a\n  \n    b\n'])(
    'prints the canonical text of %j without throwing',
    (text) => {
      const canonical = canonicalSqlText(text);
      expect(canonical).toBeDefined();
      expect(() => printSqlExpressionLiteral(canonical ?? '')).not.toThrow();
    },
  );
});

describe('canonicalSqlText', () => {
  it('is the canonical text of a SQL body', () => {
    expect(canonicalSqlText('\n  a = 1\n    AND b = 2\n')).toBe('a = 1\n  AND b = 2');
  });

  it('is undefined for a body that has no canonical text', () => {
    expect(canonicalSqlText('a\u0000')).toBeUndefined();
  });
});

describe('assertNothingCastsFromSqlExpression', () => {
  const text = { type: dataType('pg/text', {}), contributedBy: 'postgres' };

  it('accepts data types that do not cast from sql/expression', () => {
    const json = {
      type: dataType('pg/jsonb', { casts: { 'pg/text': (value) => value } }),
      contributedBy: 'postgres',
    };
    const sqlExpression = { type: sqlExpressionDataType, contributedBy: 'sql' };
    expect(() => assertNothingCastsFromSqlExpression([text, json, sqlExpression])).not.toThrow();
  });

  it('refuses a data type with a cast from sql/expression', () => {
    const geometry = {
      type: dataType('postgis/geometry', {
        casts: { [SQL_EXPRESSION_DATA_TYPE_ID]: (value) => value },
      }),
      contributedBy: 'postgis',
    };
    expect(() => assertNothingCastsFromSqlExpression([text, geometry])).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.DATA_TYPE_CASTS_FROM_SQL_EXPRESSION',
        message:
          'Data type "postgis/geometry" from "postgis" declares a cast from sql/expression. No data type may cast from sql/expression: a sql literal is SQL the database runs, not a value of another type.',
        details: { dataType: 'postgis/geometry', contributedBy: 'postgis' },
      }),
    );
  });

  it('refuses a data type with a list cast from sql/expression', () => {
    const vector = {
      type: dataType('pgvector/vector', {
        listCast: { of: [SQL_EXPRESSION_DATA_TYPE_ID], cast: (elements) => elements },
      }),
      contributedBy: 'pgvector',
    };
    expect(() => assertNothingCastsFromSqlExpression([vector])).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.DATA_TYPE_CASTS_FROM_SQL_EXPRESSION',
        message:
          'Data type "pgvector/vector" from "pgvector" declares a list cast from sql/expression. No data type may cast from sql/expression: a sql literal is SQL the database runs, not a value of another type.',
        details: { dataType: 'pgvector/vector', contributedBy: 'pgvector' },
      }),
    );
  });
});

describe('sqlTextsReadBack', () => {
  it.each([
    ['no texts', [], true],
    ['absent texts', [undefined, undefined], true],
    ['texts that read back', ['a = 1', undefined, 'a = 1\n  AND b = 2'], true],
    ['one text that does not', ['a = 1', 'a = 1\n'], false],
  ] as const)('%s: %s', (_, texts, expected) => {
    expect(sqlTextsReadBack(texts)).toBe(expected);
  });
});
