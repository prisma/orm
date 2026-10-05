import { describe, expect, it } from 'vitest';
import { parse } from '../src/parse';
import { PathExprAst } from '../src/syntax/ast/expressions';
import type { GreenElement } from '../src/syntax/green';
import { SyntaxNode } from '../src/syntax/red';

type Shape = string | readonly [string, ...Shape[]];

function shape(element: GreenElement): Shape | undefined {
  if (element.type === 'token') {
    if (element.kind === 'Whitespace' || element.kind === 'Newline') return undefined;
    return `${element.kind} ${element.text}`;
  }
  return [
    element.kind,
    ...element.children.flatMap((child) => {
      const rendered = shape(child);
      return rendered === undefined ? [] : [rendered];
    }),
  ];
}

function findDescendant(node: SyntaxNode, kind: string): SyntaxNode | undefined {
  for (const child of node.children()) {
    if (!(child instanceof SyntaxNode)) continue;
    if (child.kind === kind) return child;
    const nested = findDescendant(child, kind);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

function descendant(node: SyntaxNode, kind: string): SyntaxNode {
  const found = findDescendant(node, kind);
  if (found === undefined) throw new Error(`No ${kind} node`);
  return found;
}

function parsed(source: string) {
  const { document, diagnostics } = parse(source, 'trailing-dot.psl');
  return {
    root: document.syntax,
    shapeOf: (kind: string) => shape(descendant(document.syntax, kind).green),
    missingName: diagnostics
      .filter(({ code }) => code === 'PSL_INVALID_QUALIFIED_NAME')
      .map(({ message, range }) => ({ message, range })),
  };
}

const auth = ['Identifier', 'Ident auth'] as const;
const trailingPath = ['PathExpr', auth, 'Dot .'] as const;
const missingName = (line: number, character: number) => ({
  message: 'Qualified name is missing a name after the separator',
  range: { start: { line, character }, end: { line, character } },
});

describe('a qualified name ending in a dot', () => {
  it('keeps the dot in a block value', () => {
    const result = parsed('p x {\n  target = auth.\n}');
    expect(result.shapeOf('KeyValuePair')).toEqual([
      'KeyValuePair',
      ['Identifier', 'Ident target'],
      'Equals =',
      trailingPath,
    ]);
    expect(result.shapeOf('GenericBlockDeclaration')).toEqual([
      'GenericBlockDeclaration',
      'Ident p',
      ['Identifier', 'Ident x'],
      'LBrace {',
      ['KeyValuePair', ['Identifier', 'Ident target'], 'Equals =', trailingPath],
      'RBrace }',
    ]);
    expect(result.missingName).toEqual([missingName(1, 16)]);
  });

  it('keeps the dot in an unclosed list', () => {
    const result = parsed('p x {\n  roles = [auth.\n}');
    expect(result.shapeOf('ArrayLiteral')).toEqual(['ArrayLiteral', 'LBracket [', trailingPath]);
    expect(result.missingName).toEqual([missingName(1, 16)]);
  });

  it('keeps the dot in a closed list', () => {
    const result = parsed('p x {\n  roles = [auth.]\n}');
    expect(result.shapeOf('ArrayLiteral')).toEqual([
      'ArrayLiteral',
      'LBracket [',
      trailingPath,
      'RBracket ]',
    ]);
    expect(result.missingName).toEqual([missingName(1, 16)]);
  });

  it('keeps the dot in an attribute argument', () => {
    const result = parsed('model M {\n  @@x(auth.)\n}');
    expect(result.shapeOf('AttributeArgList')).toEqual([
      'AttributeArgList',
      'LParen (',
      ['AttributeArg', trailingPath],
      'RParen )',
    ]);
    expect(result.missingName).toEqual([missingName(1, 11)]);
  });

  it('reads the missing segment as an empty name', () => {
    const result = parsed('p x {\n  target = auth.\n}');
    expect(PathExprAst.cast(descendant(result.root, 'PathExpr'))?.path()).toEqual(['auth', '']);
  });
});

describe('a qualified name does not continue across a newline', () => {
  it('stops a value path at the end of its line', () => {
    const result = parsed('p x {\n  roles = [auth.\n  permissive = true\n}');
    expect(result.shapeOf('PathExpr')).toEqual(trailingPath);
    expect(result.missingName).toEqual([missingName(1, 16)]);
  });

  it('stops a value path before a dot on the next line', () => {
    const result = parsed('p x {\n  target = auth\n  .other = true\n}');
    expect(result.shapeOf('KeyValuePair')).toEqual([
      'KeyValuePair',
      ['Identifier', 'Ident target'],
      'Equals =',
      auth,
    ]);
  });

  it('stops a field type at the end of its line', () => {
    const result = parsed('model M {\n  a auth.\n  b Int\n}');
    expect(result.shapeOf('FieldDeclaration')).toEqual([
      'FieldDeclaration',
      ['Identifier', 'Ident a'],
      ['TypeAnnotation', ['QualifiedName', auth, 'Dot .']],
    ]);
    expect(result.missingName).toEqual([missingName(1, 9)]);
  });
});
