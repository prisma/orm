import { dataType } from '@internal/framework-components/codec';
import { blindCast } from '@internal/utils/casts';
import { describe, expect, it } from 'vitest';
import {
  assertNothingCastsFromSqlExpression,
  canonicalSqlText,
  isSqlExpression,
  printSqlExpressionLiteral,
  requireSqlExpression,
  SQL_EXPRESSION_DATA_TYPE_ID,
  SQL_EXPRESSION_TAG,
  SqlExpression,
  sql,
  sqlExpressionAuthoringEntry,
  sqlExpressionDataType,
  sqlExpressionRegistration,
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

describe('sqlExpressionRegistration', () => {
  it('holds the data type and its authoring entry, keyed by its id', () => {
    expect(sqlExpressionRegistration).toEqual({
      dataTypes: [sqlExpressionDataType],
      authoring: { dataTypes: { [SQL_EXPRESSION_DATA_TYPE_ID]: sqlExpressionAuthoringEntry } },
    });
    expect(sqlExpressionRegistration.dataTypes[0]).toBe(sqlExpressionDataType);
    expect(sqlExpressionRegistration.authoring.dataTypes[SQL_EXPRESSION_DATA_TYPE_ID]).toBe(
      sqlExpressionAuthoringEntry,
    );
  });

  it('freezes the registration, its containers, the data type and its casts, and the authoring entry and its written form', () => {
    expect({
      registration: Object.isFrozen(sqlExpressionRegistration),
      dataTypes: Object.isFrozen(sqlExpressionRegistration.dataTypes),
      authoring: Object.isFrozen(sqlExpressionRegistration.authoring),
      authoringDataTypes: Object.isFrozen(sqlExpressionRegistration.authoring.dataTypes),
      dataType: Object.isFrozen(sqlExpressionDataType),
      casts: Object.isFrozen(sqlExpressionDataType.casts),
      entry: Object.isFrozen(sqlExpressionAuthoringEntry),
      written: Object.isFrozen(sqlExpressionAuthoringEntry.written),
    }).toEqual({
      registration: true,
      dataTypes: true,
      authoring: true,
      authoringDataTypes: true,
      dataType: true,
      casts: true,
      entry: true,
      written: true,
    });
  });
});

describe('SqlExpression', () => {
  it('canonicalizes its text as a PSL sql literal is canonicalized', () => {
    expect(new SqlExpression('\n    a = 1\n      AND b = 2\n').text).toBe('a = 1\n  AND b = 2');
  });

  it('is frozen', () => {
    expect(Object.isFrozen(new SqlExpression('a'))).toBe(true);
  });

  it('refuses a NUL character with CONTRACT.SQL_EXPRESSION_INVALID', () => {
    expect(() => new SqlExpression('a\u0000b')).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.SQL_EXPRESSION_INVALID',
        message: 'Tagged literals must not contain NUL characters.',
        meta: { reason: 'nul', offset: 1 },
      }),
    );
  });

  it('refuses a text over the size limit with CONTRACT.SQL_EXPRESSION_INVALID', () => {
    expect(() => new SqlExpression('x'.repeat(65537))).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.SQL_EXPRESSION_INVALID',
        message: 'Tagged literal exceeds 65536 bytes.',
        meta: { reason: 'too-large', offset: 65536 },
      }),
    );
  });
});

describe('sql', () => {
  it('returns a SqlExpression holding the text', () => {
    const value = sql`gen_random_uuid()`;
    expect(value).toBeInstanceOf(SqlExpression);
    expect(value.text).toBe('gen_random_uuid()');
  });

  it('canonicalizes a multi-line text: blank edge lines dropped, common indentation removed', () => {
    expect(
      sql`
      (now()
        + '00:03:00'::interval)
    `.text,
    ).toBe("(now()\n  + '00:03:00'::interval)");
  });

  it('allows an empty text', () => {
    expect(sql``.text).toBe('');
  });

  it('reads the raw text: JavaScript escapes are not interpreted', () => {
    expect([sql`'\d+'`.text, sql`E'\n'`.text, sql`'C:\users'`.text]).toEqual([
      "'\\d+'",
      "E'\\n'",
      "'C:\\users'",
    ]);
  });

  it('keeps a dollar-brace sequence in the raw text: only a JavaScript interpolation is a value', () => {
    const raw = 'a $' + '{x} b';
    const strings = Object.assign([raw], { raw: [raw] });
    expect(sql(strings).text).toBe(raw);
  });

  it('resolves the three escapes a template tag understands', () => {
    expect([sql`\``.text, sql`a\\b`.text, sql`'Home | \${user}'`.text, sql`\\$x`.text]).toEqual([
      '`',
      'a\\b',
      `'Home | $${'{user}'}'`,
      '\\$x',
    ]);
  });

  it('joins interpolated sql values into the text', () => {
    const owner = sql`"userId" = auth.uid()`;
    expect(sql`${owner} AND deleted_at IS NULL`.text).toBe(
      '"userId" = auth.uid() AND deleted_at IS NULL',
    );
  });

  it('canonicalizes the joined text once', () => {
    const first = sql`a = 1`;
    expect(
      sql`
        ${first}
          OR b = 2
      `.text,
    ).toBe('a = 1\n  OR b = 2');
  });

  it('joins several interpolated values in order', () => {
    const [a, b, c] = [sql`a = 1`, sql`b = 2`, sql`c = 3`];
    expect(sql`(${a} OR ${b}) AND ${c} -- end`.text).toBe('(a = 1 OR b = 2) AND c = 3 -- end');
  });

  it('indents every line of a multi-line value as the template line it sits on', () => {
    const owner = sql`
      "userId" = auth.uid()
        OR is_admin()
    `;
    const composed = sql`
      (
        ${owner}
      )
      AND deleted_at IS NULL
    `;
    expect(composed.text).toBe(
      canonicalSqlText(`
      (
        "userId" = auth.uid()
          OR is_admin()
      )
      AND deleted_at IS NULL
    `),
    );
    expect(composed.text).toBe(
      '(\n  "userId" = auth.uid()\n    OR is_admin()\n)\nAND deleted_at IS NULL',
    );
  });

  it('indents a multi-line value by the leading whitespace of its line, not by the text before it', () => {
    const twoLines = sql`
      a
      b
    `;
    expect(
      sql`
      x = 1 AND ${twoLines}
      AND y = 2
    `.text,
    ).toBe('x = 1 AND a\nb\nAND y = 2');
  });

  it('indents a second value on a line by the template line, not by the first value', () => {
    const a = new SqlExpression('x\n  y');
    const b = new SqlExpression('p\nq');
    expect(
      sql`
    ${a} AND ${b}
`.text,
    ).toBe('x\n  y AND p\nq');
  });

  it('indents a value after a multi-line value that ends on an indented line by the template line', () => {
    const a = new SqlExpression('x\n  OR y');
    const b = new SqlExpression('p\nq');
    expect(
      sql`
      (${a}) AND (${b})
      AND z
    `.text,
    ).toBe('(x\n  OR y) AND (p\nq)\nAND z');
    expect(
      sql`
      ${a}${b}
    `.text,
    ).toBe('x\n  OR yp\nq');
  });

  it('takes the indentation of a new template line after a value', () => {
    const a = new SqlExpression('x\n  y');
    const b = new SqlExpression('p\nq');
    expect(
      sql`
      ${a}
        AND ${b}
    `.text,
    ).toBe('x\n  y\n  AND p\n  q');
  });

  it('inserts interpolated text as it is, resolving escapes only in the template', () => {
    const inner = new SqlExpression('a\\\\b');
    expect(sql`${inner} \\ c`.text).toBe('a\\\\b \\ c');
  });

  it.each([
    ['a string', 'x', 0],
    ['a number', 1, 0],
    ['an object with a text', { text: 'x' }, 1],
  ] as const)(
    'refuses %s interpolated with CONTRACT.SQL_EXPRESSION_INTERPOLATION',
    (_, value, index) => {
      const untyped = sql as (
        strings: TemplateStringsArray,
        ...values: readonly unknown[]
      ) => unknown;
      const run = () => (index === 0 ? untyped`a ${value} b` : untyped`a ${sql`x`} ${value} b`);
      expect(run).toThrow(
        expect.objectContaining({
          code: 'CONTRACT.SQL_EXPRESSION_INTERPOLATION',
          message:
            'sql`...` only interpolates other sql`...` values; write any other text inside the template.',
          meta: { index },
        }),
      );
    },
  );
});

describe('sql with a value another copy of the package made', () => {
  it('interpolates its canonical text, as it does a value this copy made', () => {
    const text = '\n    a = 1\n      AND b\n  ';
    const fromAnotherCopy = blindCast<
      SqlExpression,
      "a sql value from another installed copy carries the marker but is not this copy's class"
    >({ [Symbol.for('@prisma/sql-expression')]: true, text });
    const interpolate = (value: SqlExpression) => sql`
      (
        ${value}
      ) OR c
    `;
    expect(interpolate(fromAnotherCopy).text).toBe(interpolate(new SqlExpression(text)).text);
  });
});

describe('isSqlExpression', () => {
  it.each([
    ['a sql value', sql`x`, true],
    [
      'a value made by another copy of the package',
      { [Symbol.for('@prisma/sql-expression')]: true, text: 'x' },
      true,
    ],
    ['an object with a text', { text: 'x' }, false],
    [
      'a marked object whose text is not a string',
      { [Symbol.for('@prisma/sql-expression')]: true, text: 1 },
      false,
    ],
    ['a string', 'x', false],
    ['null', null, false],
    ['undefined', undefined, false],
  ] as const)('%s: %s', (_, value, expected) => {
    expect(isSqlExpression(value)).toBe(expected);
  });
});

describe('requireSqlExpression', () => {
  const marker = Symbol.for('@prisma/sql-expression');

  it('returns a sql value this copy made as the same object', () => {
    const value = sql`x`;
    expect(requireSqlExpression(value, 'Index "a" where')).toBe(value);
  });

  it('canonicalizes the text of a sql value another copy made', () => {
    const value = { [marker]: true, text: '\n    a = 1\n      AND b\n  ' };
    const read = requireSqlExpression(value, 'Index "a" where');
    expect(read).toBeInstanceOf(SqlExpression);
    expect(read.text).toBe('a = 1\n  AND b');
  });

  it('refuses a NUL in the text of a sql value another copy made', () => {
    expect(() =>
      requireSqlExpression({ [marker]: true, text: 'a\u0000b' }, 'Index "a" where'),
    ).toThrow(expect.objectContaining({ code: 'CONTRACT.SQL_EXPRESSION_INVALID' }));
  });

  it.each([['x'], [1], [{ text: 'x' }], [{ [marker]: true, text: 1 }], [undefined]])(
    'refuses %j with CONTRACT.ARGUMENT_INVALID',
    (value) => {
      expect(() => requireSqlExpression(value, 'Index "a" where')).toThrow(
        expect.objectContaining({
          code: 'CONTRACT.ARGUMENT_INVALID',
          message: 'Index "a" where must be a sql`...` value.',
          meta: { what: 'Index "a" where' },
        }),
      );
    },
  );
});
