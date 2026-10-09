import { describe, expect, it } from 'vitest';
import { indentTaggedTemplates } from '../src/indent-tagged-templates';
import { formatMigrationTs } from '../src/migration-ts';

describe('indentTaggedTemplates', () => {
  it('moves a multi-line tagged template under the line it opens on', () => {
    const source = [
      '        checkExpression(',
      "          'profile_valid',",
      '          sql`',
      'a > 0',
      '',
      '  AND b < 1',
      '`,',
      '        ),',
    ].join('\n');

    expect(indentTaggedTemplates(source)).toBe(
      [
        '        checkExpression(',
        "          'profile_valid',",
        '          sql`',
        '            a > 0',
        '',
        '              AND b < 1',
        '          `,',
        '        ),',
      ].join('\n'),
    );
  });

  it.each([
    ['a one-line template', 'x = sql`a`;'],
    ['an untagged template ending a line', 'x = [`a`'],
    ['a backtick inside a string', "x = 'a`';"],
    ['a template opened inside a comment', '// sql`'],
  ])('leaves %s alone', (_name, source) => {
    expect(indentTaggedTemplates(source)).toBe(source);
  });

  it.each([
    ['an interpolation in the body', 'x = sql`\n  a $' + '{b}\n`;'],
    ['a template that never closes', 'x = sql`\n  a'],
    ['a string still open at the end of a line', "x = 'a\ny = sql`\n  a\n`;"],
  ])('returns the source unchanged for %s', (_name, source) => {
    expect(indentTaggedTemplates(source)).toBe(source);
  });
});

describe('formatMigrationTs', () => {
  it('indents a multi-line template that prettier moved the code around', async () => {
    const source = [
      'const ops = [',
      '      this.createTable({ schema: "public", table: "profile", columns: [col("id", "int4", { notNull: true })], constraints: [checkExpression("profile_valid_0a1b2c3d", sql`',
      '        "id" > 0',
      '          AND "id" < 100',
      '      `)] }),',
      '];',
      '',
    ].join('\n');

    const formatted = await formatMigrationTs(source);
    const lines = formatted.split('\n');
    const opening = lines.findIndex((line) => line.endsWith('sql`'));
    const openingIndent = lines[opening]?.match(/^ */)?.[0] ?? '';

    expect(lines.slice(opening + 1, opening + 4)).toEqual([
      `${openingIndent}  "id" > 0`,
      `${openingIndent}    AND "id" < 100`,
      `${openingIndent}\`,`,
    ]);
    expect(openingIndent.length).toBeGreaterThan(6);
  });
});
