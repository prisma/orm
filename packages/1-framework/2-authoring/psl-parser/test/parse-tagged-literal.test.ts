import { describe, expect, it } from 'vitest';
import { parse } from '../src/parse';
import type { FieldAttributeAst } from '../src/syntax/ast/attributes';
import { FieldDeclarationAst, ModelDeclarationAst } from '../src/syntax/ast/declarations';
import { StringLiteralExprAst, TaggedLiteralExprAst } from '../src/syntax/ast/expressions';
import { IdentifierAst } from '../src/syntax/ast/identifier';
import { printSyntax } from '../src/syntax/ast-helpers';
import { highlight, printTree } from './support';

function firstDefaultArg(source: string) {
  const result = parse(source, 'test.psl');
  let attribute: FieldAttributeAst | undefined;
  for (const model of result.document.declarations()) {
    const m = ModelDeclarationAst.cast(model.syntax);
    if (!m) continue;
    for (const field of m.fields()) {
      for (const attr of field.attributes()) {
        attribute = attr;
      }
    }
  }
  if (!attribute) throw new Error('expected a field attribute');
  const arg = [...(attribute.argList()?.args() ?? [])][0];
  if (!arg) throw new Error('expected an attribute argument');
  return { result, attribute, value: arg.value() };
}

function taggedDefault(argument: string) {
  const { result, value } = firstDefaultArg(`model T {\n  id String @default(${argument})\n}\n`);
  const literal = value ? TaggedLiteralExprAst.cast(value.syntax) : undefined;
  if (!literal) throw new Error(`expected a tagged literal, got ${value?.syntax.kind}`);
  return { result, literal };
}

function stringDefault(argument: string) {
  const { result, value } = firstDefaultArg(`model T {\n  id String @default(${argument})\n}\n`);
  const literal = value ? StringLiteralExprAst.cast(value.syntax) : undefined;
  if (!literal) throw new Error(`expected a string literal, got ${value?.syntax.kind}`);
  return { result, literal };
}

describe('TaggedLiteral parsing', () => {
  it('reads a tag followed by a backtick string', () => {
    const { result, literal } = taggedDefault('sql`gen_random_uuid()`');
    expect(result.diagnostics).toEqual([]);
    expect(literal.tagName()).toBe('sql');
    expect(literal.tag()?.path()).toEqual(['sql']);
    expect(literal.literal()?.quote()).toBe('`');
    expect(literal.literal()?.value()).toBe('gen_random_uuid()');
    expect(literal.body()).toBe('gen_random_uuid()');
  });

  it('is a qualified name followed by a string literal expression', () => {
    const { literal } = taggedDefault('pg.sql`now()`');
    expect(printTree(literal.syntax.green)).toMatchInlineSnapshot(`
      "TaggedLiteral
        QualifiedName
          Identifier
            Ident "pg"
          Dot "."
          Identifier
            Ident "sql"
        StringLiteralExpr
          StringLiteral "\`now()\`""
    `);
  });

  it('canonicalizes a multi-line body', () => {
    const { result, literal } = taggedDefault(
      "sql`\n    (now()\n      + '00:03:00'::interval)\n  `",
    );
    expect(result.diagnostics).toEqual([]);
    expect(literal.literal()?.value()).toBe("\n    (now()\n      + '00:03:00'::interval)\n  ");
    expect(literal.body()).toBe("(now()\n  + '00:03:00'::interval)");
  });

  it('passes a body containing a dollar-brace sequence through verbatim', () => {
    const { result, literal } = taggedDefault('sql`a $' + '{x} b`');
    expect(result.diagnostics).toEqual([]);
    expect(literal.body()).toBe('a $' + '{x} b');
  });

  it.each([
    ['whitespace', 'sql `x`'],
    ['a newline', 'sql\n`x`'],
    ['a comment', 'sql // raw\n`x`'],
    ['whitespace inside the qualified name', 'pg . sql"x"'],
  ])('allows %s between the tag and the string', (_name, argument) => {
    const source = `model T {\n  id String @default(${argument})\n}\n`;
    const { result, literal } = taggedDefault(argument);
    expect(result.diagnostics).toEqual([]);
    expect(literal.body()).toBe('x');
    expect(printSyntax(result.document.syntax)).toBe(source);
  });

  it('reads a tag followed by a double- or single-quoted string with the same body', () => {
    const double = taggedDefault('sql"now()"');
    const single = taggedDefault("sql'now()'");
    expect([double.result.diagnostics, single.result.diagnostics]).toEqual([[], []]);
    expect([double.literal.literal()?.quote(), single.literal.literal()?.quote()]).toEqual([
      '"',
      "'",
    ]);
    expect(single.literal.body()).toBe('now()');
    expect(double.literal.body()).toBe('now()');
  });

  it('resolves double-quoted string escapes in the body', () => {
    const { result, literal } = taggedDefault('sql"a\\"b `c`"');
    expect(result.diagnostics).toEqual([]);
    expect(literal.body()).toBe('a"b `c`');
  });

  it('gives the same body for a backtick and a double-quoted string', () => {
    expect(taggedDefault('sql`gen_random_uuid()`').literal.body()).toBe(
      taggedDefault('sql"gen_random_uuid()"').literal.body(),
    );
  });

  it('resumes at the closing brace after an unterminated backtick string, so the next model still parses', () => {
    const source =
      'model A {\n  id String @default(sql`abc\n  more\n}\n\nmodel B {\n  id Int @id\n}\n';
    const result = parse(source, 'test.psl');
    expect(result.diagnostics.map((d) => d.code)).toEqual(['PSL_UNTERMINATED_STRING']);
    const models = [...result.document.declarations()].map((d) =>
      ModelDeclarationAst.cast(d.syntax)?.name()?.name(),
    );
    expect(models).toEqual(['A', 'B']);
    expect(printSyntax(result.document.syntax)).toBe(source);
  });

  it('swallows to the end of the input when no line starts with a closing brace', () => {
    const source = 'model A {\n  id String @default(sql`abc\n  more\n';
    const result = parse(source, 'test.psl');
    expect(result.diagnostics.map((d) => d.code)).toContain('PSL_UNTERMINATED_STRING');
    expect(printSyntax(result.document.syntax)).toBe(source);
  });

  it('reports an unterminated backtick string as PSL_UNTERMINATED_STRING at the string', () => {
    const source = 'model T {\n  id String @default(sql`abc\n}\n';
    const result = parse(source, 'test.psl');
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      code: 'PSL_UNTERMINATED_STRING',
      message: 'Unterminated string literal',
    });
    expect(
      highlight(result.sources.sourceFileFor(result.document.syntax), result.diagnostics[0]!.range),
    ).toMatchInlineSnapshot(`
      "
      model T {
        id String @default(sql\`abc
                              ~~~~
      }
      ~

      "
    `);
    expect(printSyntax(result.document.syntax)).toBe(source);
  });

  it('round-trips the source through printSyntax', () => {
    const source =
      'model T {\n  a String @default(sql`\n    x\n  `)\n  b String @default(pg.sql"y")\n}\n';
    const result = parse(source, 'test.psl');
    expect(result.diagnostics).toEqual([]);
    expect(printSyntax(result.document.syntax)).toBe(source);
  });

  it('is accepted anywhere an expression is, including array elements and block values', () => {
    const source = 'generator g {\n  x = sql`a`\n}\nmodel T {\n  a String @x([sql`a`, t"b"])\n}\n';
    const result = parse(source, 'test.psl');
    expect(result.diagnostics).toEqual([]);
    expect(printSyntax(result.document.syntax)).toBe(source);
  });

  it('still parses a bare identifier and a function call as before', () => {
    const { result, value } = firstDefaultArg('model T {\n  id String @default(now)\n}\n');
    expect(result.diagnostics).toEqual([]);
    expect(value && IdentifierAst.cast(value.syntax)?.name()).toBe('now');
    const call = firstDefaultArg('model T {\n  id String @default(pg.now())\n}\n');
    expect(call.value?.syntax.kind).toBe('FunctionCall');
  });

  it('exposes the field through the typed layer', () => {
    const result = parse('model T {\n  id String @default(sql`x`)\n}\n', 'test.psl');
    const model = ModelDeclarationAst.cast([...result.document.declarations()][0]!.syntax);
    const field = [...model!.fields()][0];
    expect(field).toBeInstanceOf(FieldDeclarationAst);
  });
});

describe('string literal quote styles', () => {
  it.each([
    ['"a"', '"'],
    ["'a'", "'"],
    ['sql`a`', '`'],
  ])('reports the quote of %s', (argument, quote) => {
    const literal = argument.startsWith('sql')
      ? taggedDefault(argument).literal.literal()
      : stringDefault(argument).literal;
    expect(literal?.quote()).toBe(quote);
  });

  it.each([
    ['resolves an escaped backtick', 'sql`a\\`b`', 'a`b'],
    ['resolves a double backslash to one backslash', 'sql`a\\\\b`', 'a\\b'],
    ['keeps a backslash before a dollar sign as written', 'sql`\\$1`', '\\$1'],
    ['keeps a backslash before a dollar brace as written', `sql\`\\$${'{x}'}\``, `\\$${'{x}'}`],
    ['keeps every other backslash sequence as written', "sql`E'\\n'`", "E'\\n'"],
    ['keeps an escaped double quote as written', 'sql`a\\"b`', 'a\\"b'],
  ])('a backtick string %s', (_name, argument, value) => {
    expect(taggedDefault(argument).literal.literal()?.value()).toBe(value);
  });

  it('keeps the double-quoted escapes', () => {
    expect(stringDefault('"a\\nb\\"c\\u0041"').literal.value()).toBe('a\nb"cA');
  });
});

describe('a backtick string with no tag', () => {
  const requiresTag = {
    code: 'PSL_BACKTICK_STRING_REQUIRES_TAG',
    message: 'A backtick string must follow a tag, as in tag`...`.',
  };

  it('is reported at the string when it is an attribute argument', () => {
    const source = 'model T {\n  id String @map(`x`)\n}\n';
    const result = parse(source, 'test.psl');
    expect(result.diagnostics).toEqual([expect.objectContaining(requiresTag)]);
    expect(
      highlight(result.sources.sourceFileFor(result.document.syntax), result.diagnostics[0]!.range),
    ).toMatchInlineSnapshot(`
      "
      model T {
        id String @map(\`x\`)
                       ~~~
      }

      "
    `);
    expect(printSyntax(result.document.syntax)).toBe(source);
  });

  it('is reported at the string when it is a key-value value', () => {
    const source = 'generator g {\n  provider = `x`\n}\n';
    const result = parse(source, 'test.psl');
    expect(result.diagnostics).toEqual([expect.objectContaining(requiresTag)]);
    expect(
      highlight(result.sources.sourceFileFor(result.document.syntax), result.diagnostics[0]!.range),
    ).toMatchInlineSnapshot(`
      "
      generator g {
        provider = \`x\`
                   ~~~
      }

      "
    `);
  });

  it('is reported alongside PSL_UNTERMINATED_STRING when it is also unterminated', () => {
    const source = 'model T {\n  id String @default(`abc\n}\n';
    const result = parse(source, 'test.psl');
    expect(result.diagnostics.map((d) => d.code).sort()).toEqual([
      'PSL_BACKTICK_STRING_REQUIRES_TAG',
      'PSL_UNTERMINATED_STRING',
    ]);
    expect(printSyntax(result.document.syntax)).toBe(source);
  });

  it('at the top level is reported like a double-quoted string there', () => {
    expect(parse('`oops', 'test.psl').diagnostics.map((d) => d.code)).toEqual(
      parse('"oops', 'test.psl').diagnostics.map((d) => d.code),
    );
  });
});
