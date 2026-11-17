import { describe, expect, it } from 'vitest';
import {
  checkSqlExpressionText,
  type SqlQuotingRules,
} from '../src/core/migrations/sql-expression-text';

const standardQuoting: SqlQuotingRules = [
  { open: "'", close: "'", doubledCloseEscapes: true, backslashEscapes: false },
  { open: '"', close: '"', doubledCloseEscapes: true, backslashEscapes: false },
  { open: '`', close: '`', doubledCloseEscapes: true, backslashEscapes: false },
  { open: '[', close: ']', doubledCloseEscapes: false, backslashEscapes: false },
];
const escapeStringQuoting: SqlQuotingRules = [
  { open: "E'", close: "'", doubledCloseEscapes: true, backslashEscapes: true },
  { open: "'", close: "'", doubledCloseEscapes: true, backslashEscapes: false },
  { open: '"', close: '"', doubledCloseEscapes: true, backslashEscapes: false },
];
const check = (text: string) => checkSqlExpressionText(text, standardQuoting);

describe('checkSqlExpressionText', () => {
  it('accepts one expression, with quoted literals and identifiers that hold anything', () => {
    expect(
      [
        'CAST("age" AS INTEGER)',
        `trim("age")::integer`,
        `';'`,
        `'-- not a comment'`,
        `'it''s /* fine */'`,
        `"odd;name"`,
        `"a""b" || 'x'`,
        `extract(year FROM "created")`,
        `(SELECT max(id) FROM "Other")`,
        `CASE WHEN "age" = '' THEN 0 ELSE CAST("age" AS INTEGER) END`,
        '`back;tick`',
        '[bracket;name]',
        `"name" IS DISTINCT FROM 'al'`,
        `"name" is not distinct from 'al'`,
        `coalesce("a", "b")`,
        'ARRAY[1, 2]',
      ].map(check),
    ).toEqual(Array(16).fill(undefined));
  });

  it('reads only the quotes the rules name', () => {
    expect([
      checkSqlExpressionText(`ARRAY[']']::int8[]`, escapeStringQuoting),
      checkSqlExpressionText('`a;b`', escapeStringQuoting),
      checkSqlExpressionText('[a;b]', escapeStringQuoting),
    ]).toEqual([
      undefined,
      'a semicolon outside a quoted literal',
      'a semicolon outside a quoted literal',
    ]);
  });

  it('reads backslash escapes only in quotes whose rule has them', () => {
    expect([
      checkSqlExpressionText(`E'it\\'s'`, escapeStringQuoting),
      checkSqlExpressionText(`e'it\\'s'`, escapeStringQuoting),
      checkSqlExpressionText(`E'\\'' ; DROP TABLE "User"; --'`, escapeStringQuoting),
      checkSqlExpressionText(`'a\\' || 'b'`, escapeStringQuoting),
      checkSqlExpressionText(`"name" || E'x'`, escapeStringQuoting),
      checkSqlExpressionText(`E'\\'' ; DROP TABLE "User"; --'`, standardQuoting),
    ]).toEqual([
      undefined,
      undefined,
      'a semicolon outside a quoted literal',
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('refuses FROM that does not directly follow DISTINCT', () => {
    expect([check(`DISTINCT "name" FROM "User"`), check(`"name" IS DISTINCT + FROM`)]).toEqual([
      'the keyword FROM outside parentheses',
      'the keyword FROM outside parentheses',
    ]);
  });

  it('refuses a semicolon, a comment, dollar quoting, an unclosed quote and unbalanced parentheses', () => {
    expect(
      [
        '0; DROP TABLE x',
        '"age" -- trailing',
        '"age" /* note */',
        '$$x$$',
        '$tag$x$tag$',
        `'unclosed`,
        '"unclosed',
        'CAST("age" AS INTEGER',
        'age)',
      ].map((text) => check(text) !== undefined),
    ).toEqual(Array(9).fill(true));
  });

  it('refuses a keyword or a comma that would reshape the statement around it, outside parentheses', () => {
    expect(
      [
        '"age" FROM "User"',
        '1 UNION SELECT 2',
        '"age" WHERE 1 = 1',
        '1 ORDER BY 1',
        '1 GROUP BY 1',
        '1 LIMIT 1',
        '1 INTERSECT SELECT 1',
        '1 EXCEPT SELECT 1',
        '1 HAVING 1',
        '1 RETURNING 1',
        'trim("age")::integer, ALTER COLUMN "label" DROP DEFAULT',
      ].map(check),
    ).toEqual([
      'the keyword FROM outside parentheses',
      'the keyword UNION outside parentheses',
      'the keyword WHERE outside parentheses',
      'the keyword ORDER outside parentheses',
      'the keyword GROUP outside parentheses',
      'the keyword LIMIT outside parentheses',
      'the keyword INTERSECT outside parentheses',
      'the keyword EXCEPT outside parentheses',
      'the keyword HAVING outside parentheses',
      'the keyword RETURNING outside parentheses',
      'a comma outside parentheses',
    ]);
  });

  it('names what it refuses', () => {
    expect([
      check('0; DROP TABLE x'),
      check('"age" -- trailing'),
      check(`'unclosed`),
      check('age)'),
    ]).toEqual([
      'a semicolon outside a quoted literal',
      'a SQL comment',
      'a quote that is not closed',
      'parentheses that do not match',
    ]);
  });
});
