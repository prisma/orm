import { describe, expect, it } from 'vitest';
import { type ParseResult, parse } from '../src/parse';
import { GenericBlockDeclarationAst, ModelDeclarationAst } from '../src/syntax/ast/declarations';
import { filterChildren, printSyntax } from '../src/syntax/ast-helpers';
import type { SyntaxNode } from '../src/syntax/red';

function parseLossless(source: string, options: Parameters<typeof parse>[2] = {}): ParseResult {
  const result = parse(source, 'test.psl', options);
  expect(printSyntax(result.document.syntax)).toBe(source);
  return result;
}

function reported(result: ParseResult, source: string): string[] {
  const lines = source.split('\n');
  return result.diagnostics.map(({ code, message, range }) => {
    const text = (lines[range.start.line] ?? '').slice(range.start.character, range.end.character);
    return `${code}: ${message} at "${text}"`;
  });
}

function descendantKinds(node: SyntaxNode): string[] {
  return Array.from(node.childNodes()).flatMap((child) => [child.kind, ...descendantKinds(child)]);
}

function memberTexts(result: ParseResult): string[] {
  const [block] = Array.from(result.document.syntax.childNodes());
  return Array.from(block?.childNodes() ?? [], (member) => `${member.kind} ${printSyntax(member)}`);
}

function fieldNames(result: ParseResult): (string | undefined)[] {
  const [model] = Array.from(filterChildren(result.document.syntax, ModelDeclarationAst.cast));
  return Array.from(model?.fields() ?? [], (field) => field.name()?.name());
}

function entryKeys(result: ParseResult): (string | undefined)[] {
  const [block] = Array.from(
    filterChildren(result.document.syntax, GenericBlockDeclarationAst.cast),
  );
  return Array.from(block?.entries() ?? [], (entry) => entry.key()?.name());
}

describe('a field whose attribute arguments fail to parse', () => {
  it('keeps the rest of its line and reports the argument error only', () => {
    const source = 'model User {\n  id Int @default(+foo)\n  name String\n}';
    const result = parseLossless(source);

    expect(reported(result, source)).toEqual([
      'PSL_INVALID_ATTRIBUTE_SYNTAX: Unexpected "+" in attribute arguments at "+"',
    ]);
    expect(descendantKinds(result.document.syntax)).not.toContain('MixinInclusion');
    expect(memberTexts(result)).toEqual([
      'Identifier User',
      'FieldDeclaration id Int @default(+foo)',
      'FieldDeclaration name String',
    ]);
    expect(fieldNames(result)).toEqual(['id', 'name']);
  });

  it('does not read a name left on the line as another field', () => {
    const source = 'model User {\n  id Int @default(1 extra String)\n  name String\n}';
    const result = parseLossless(source);

    expect(reported(result, source)).toEqual([
      'PSL_INVALID_ATTRIBUTE_SYNTAX: Unexpected "extra" in attribute arguments at "extra"',
    ]);
    expect(fieldNames(result)).toEqual(['id', 'name']);
  });

  it('does not read a block attribute left on the line as a member', () => {
    const source = 'model User {\n  id Int @default(1 @@map("x"))\n}';
    const result = parseLossless(source);

    expect(reported(result, source)).toEqual([
      'PSL_INVALID_ATTRIBUTE_SYNTAX: Unexpected "@@" in attribute arguments at "@@"',
    ]);
    expect(descendantKinds(result.document.syntax)).not.toContain('ModelAttribute');
  });

  it('keeps the rest of the line after a failure in a nested list or call', () => {
    const source = 'model User {\n  id Int @default(fn([1 +a], 2))\n  name String\n}';
    const result = parseLossless(source);

    expect(reported(result, source)).toEqual([
      'PSL_INVALID_ATTRIBUTE_SYNTAX: Unexpected "+" in attribute arguments at "+"',
    ]);
    expect(fieldNames(result)).toEqual(['id', 'name']);
  });

  it('keeps the rest of its line after type arguments that fail to parse', () => {
    const source = 'model User {\n  embedding Vector(+dims) @unique\n  name String\n}';
    const result = parseLossless(source);

    expect(reported(result, source)).toEqual([
      'PSL_INVALID_MODEL_MEMBER: Unexpected "+" in type arguments at "+"',
    ]);
    expect(descendantKinds(result.document.syntax)).not.toContain('MixinInclusion');
    expect(fieldNames(result)).toEqual(['embedding', 'name']);
  });

  it('reports nothing more for arguments left open at the end of a line', () => {
    const source = 'model User {\n  name String @default("anonymous"\n  active Boolean\n}';
    const result = parseLossless(source);

    expect(result.diagnostics).toEqual([]);
    expect(fieldNames(result)).toEqual(['name', 'active']);
  });

  it('leaves the closing brace of the block to the block', () => {
    const result = parseLossless('model User { id Int @default(1 }');
    const [model] = Array.from(filterChildren(result.document.syntax, ModelDeclarationAst.cast));

    expect(result.diagnostics).toEqual([]);
    expect(model?.rbrace()).toBeDefined();
  });
});

describe('a block attribute whose arguments fail to parse', () => {
  it('keeps the rest of its line in a model', () => {
    const source = 'model User {\n  id Int\n  @@index([id +other])\n  name String\n}';
    const result = parseLossless(source);

    expect(reported(result, source)).toEqual([
      'PSL_INVALID_ATTRIBUTE_SYNTAX: Unexpected "+" in attribute arguments at "+"',
    ]);
    expect(descendantKinds(result.document.syntax)).not.toContain('MixinInclusion');
    expect(memberTexts(result)).toEqual([
      'Identifier User',
      'FieldDeclaration id Int',
      'ModelAttribute @@index([id +other])',
      'FieldDeclaration name String',
    ]);
  });

  it('keeps the rest of its line in a key = value block', () => {
    const source = 'policy P {\n  @@map("p" +other)\n  k = 1\n}';
    const result = parseLossless(source);

    expect(reported(result, source)).toEqual([
      'PSL_INVALID_ATTRIBUTE_SYNTAX: Unexpected "+" in attribute arguments at "+"',
    ]);
    expect(descendantKinds(result.document.syntax)).not.toContain('MixinInclusion');
    expect(entryKeys(result)).toEqual(['k']);
  });
});

describe('a key = value entry whose value fails to parse', () => {
  it('keeps the rest of its line after an unclosed list', () => {
    const source = 'policy P {\n  roles = [a +b]\n  k = 1\n}';
    const result = parseLossless(source);

    expect(reported(result, source)).toEqual([
      'PSL_INVALID_EXTENSION_BLOCK_MEMBER: Unexpected "+" in the entry value at "+"',
    ]);
    expect(descendantKinds(result.document.syntax)).not.toContain('MixinInclusion');
    expect(memberTexts(result)).toEqual([
      'Identifier P',
      'KeyValuePair roles = [a +b]',
      'KeyValuePair k = 1',
    ]);
  });

  it('keeps the rest of its line after an unclosed call', () => {
    const source = 'policy P {\n  using = check(+owner)\n  k = 1\n}';
    const result = parseLossless(source);

    expect(reported(result, source)).toEqual([
      'PSL_INVALID_EXTENSION_BLOCK_MEMBER: Unexpected "+" in the entry value at "+"',
    ]);
    expect(entryKeys(result)).toEqual(['using', 'k']);
  });

  it('reports a missing value once and keeps what follows on the line', () => {
    const source = 'policy P {\n  using = +owner\n  k = 1\n}';
    const result = parseLossless(source);

    expect(reported(result, source)).toEqual([
      'PSL_INVALID_EXTENSION_BLOCK_MEMBER: Expected a value after "=" at "+"',
    ]);
    expect(descendantKinds(result.document.syntax)).not.toContain('MixinInclusion');
    expect(entryKeys(result)).toEqual(['using', 'k']);
  });

  it('reports an unterminated object value once', () => {
    const source = 'policy P {\n  opts = { a: 1 +b\n  k = 1\n}';
    const result = parseLossless(source);

    expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      'Unterminated object literal',
    ]);
    expect(entryKeys(result)).toEqual(['opts', 'k']);
  });
});

describe('an enum member whose attribute arguments fail to parse', () => {
  it('keeps the rest of its line', () => {
    const source = 'enum Role {\n  ADMIN @map("admin" +x)\n  USER\n}';
    const result = parseLossless(source);

    expect(reported(result, source)).toEqual([
      'PSL_INVALID_ATTRIBUTE_SYNTAX: Unexpected "+" in attribute arguments at "+"',
    ]);
    expect(descendantKinds(result.document.syntax)).not.toContain('MixinInclusion');
    expect(entryKeys(result)).toEqual(['ADMIN', 'USER']);
  });
});

describe('members that share a line without a failure', () => {
  it('still reads two fields on one line', () => {
    const result = parseLossless('model User { id Int @id name String @default("a") }');

    expect(result.diagnostics).toEqual([]);
    expect(fieldNames(result)).toEqual(['id', 'name']);
  });

  it('still reads two entries on one line', () => {
    const result = parseLossless('policy P { a = [1, 2] b = fn(3) }');

    expect(result.diagnostics).toEqual([]);
    expect(entryKeys(result)).toEqual(['a', 'b']);
  });
});
