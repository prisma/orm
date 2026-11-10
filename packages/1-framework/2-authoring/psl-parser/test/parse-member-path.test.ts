import { describe, expect, it } from 'vitest';
import { Cursor, parse, parseExpression } from '../src/parse';
import { ModelDeclarationAst } from '../src/syntax/ast/declarations';
import {
  ArrayLiteralAst,
  castExpression,
  dottedPathsIn,
  FunctionCallAst,
  PathExprAst,
} from '../src/syntax/ast/expressions';
import { IdentifierAst } from '../src/syntax/ast/identifier';
import { printSyntax } from '../src/syntax/ast-helpers';
import { type GreenNode, greenNode, greenToken } from '../src/syntax/green';
import { createSyntaxTree } from '../src/syntax/red';
import { printTree } from './support';

function parseOneExpression(source: string) {
  const cursor = new Cursor('test.psl', source);
  const node = parseExpression(cursor);
  if (node === undefined) throw new Error(`"${source}" parsed as no expression`);
  return { node, diagnostics: cursor.diagnostics };
}

function expressionOf(node: GreenNode) {
  const expression = castExpression(createSyntaxTree(node));
  if (expression === undefined) throw new Error(`${node.kind} is not an expression`);
  return expression;
}

describe('a dotted path in expression position', () => {
  it('parses into one PathExpr', () => {
    const { node, diagnostics } = parseOneExpression('address.city');

    expect(printTree(node)).toMatchInlineSnapshot(`
      "PathExpr
        Identifier
          Ident "address"
        Dot "."
        Identifier
          Ident "city""
    `);
    expect(diagnostics).toEqual([]);
  });

  it('reads every segment, however deep', () => {
    const { node, diagnostics } = parseOneExpression('address.geo.lat');
    const path = PathExprAst.cast(createSyntaxTree(node));

    expect(path?.path()).toEqual(['address', 'geo', 'lat']);
    expect(diagnostics).toEqual([]);
  });

  it('yields one identifier per segment', () => {
    const { node } = parseOneExpression('address.geo.lat');
    const path = PathExprAst.cast(createSyntaxTree(node));

    expect([...(path?.segments() ?? [])].map((segment) => segment.name())).toEqual([
      'address',
      'geo',
      'lat',
    ]);
  });

  it('keeps a single identifier an Identifier', () => {
    const { node } = parseOneExpression('city');

    expect(expressionOf(node)).toBeInstanceOf(IdentifierAst);
  });
});

describe('a call on a dotted path', () => {
  it('gives a one-dot callee the node it has without the call', () => {
    const uncalled = parseOneExpression('address.city');
    const called = parseOneExpression('address.city(sort: Asc)');
    const call = FunctionCallAst.cast(createSyntaxTree(called.node));

    expect({
      callee: call?.memberPath()?.syntax.green,
      qualified: call?.name() !== undefined,
      diagnostics: called.diagnostics,
    }).toEqual({ callee: uncalled.node, qualified: false, diagnostics: [] });
  });

  it('reads identifier segments that sit directly under the call node', () => {
    const call = FunctionCallAst.cast(
      createSyntaxTree(
        greenNode('FunctionCall', [
          greenNode('Identifier', [greenToken('Ident', 'pgvector')]),
          greenToken('Dot', '.'),
          greenNode('Identifier', [greenToken('Ident', 'Vector')]),
          greenToken('LParen', '('),
          greenToken('RParen', ')'),
        ]),
      ),
    );

    expect({ name: call?.name(), memberPath: call?.memberPath(), path: call?.path() }).toEqual({
      name: undefined,
      memberPath: undefined,
      path: ['pgvector', 'Vector'],
    });
  });

  it('keeps an undotted callee a name', () => {
    const { node } = parseOneExpression('now()');
    const call = FunctionCallAst.cast(createSyntaxTree(node));

    expect({ name: call?.name()?.identifier()?.name(), path: call?.memberPath() }).toEqual({
      name: 'now',
      path: undefined,
    });
  });

  it('reads a deeper callee as a path, with no diagnostic', () => {
    const source = 'address.geo.lat(sort: Desc)';
    const { node, diagnostics } = parseOneExpression(source);
    const call = FunctionCallAst.cast(createSyntaxTree(node));

    expect({
      path: call?.path(),
      qualified: call?.name() !== undefined,
      args: [...(call?.args() ?? [])].map((arg) => printSyntax(arg.syntax)),
    }).toEqual({
      path: ['address', 'geo', 'lat'],
      qualified: false,
      args: ['sort: Desc'],
    });
    expect(diagnostics).toEqual([]);
  });
});

describe('dottedPathsIn', () => {
  it('finds a dotted path at any depth of an expression', () => {
    const { node } = parseOneExpression('[a.b, "x.y", f(c.d), e.f(), { k: g.h }, plain]');

    expect(dottedPathsIn(expressionOf(node)).map((path) => path.path())).toEqual([
      ['a', 'b'],
      ['c', 'd'],
      ['e', 'f'],
      ['g', 'h'],
    ]);
  });
});

describe('an index over a composite-type field', () => {
  it('parses without diagnostics and keeps the dotted element', () => {
    const source = [
      'model Post {',
      '  title   String',
      '  address Address',
      '',
      '  @@index([title, address.city])',
      '  @@index([address.city(sort: Asc)])',
      '  @@unique([address.geo.lat(sort: Desc)])',
      '}',
    ].join('\n');
    const { document, diagnostics } = parse(source, 'schema.prisma');
    const model = [...document.declarations()].flatMap((declaration) => {
      const cast = ModelDeclarationAst.cast(declaration.syntax);
      return cast === undefined ? [] : [cast];
    })[0];
    const elementKinds = [...(model?.attributes() ?? [])].map((attribute) => {
      const [arg] = attribute.argList()?.args() ?? [];
      const array = arg?.value();
      return array instanceof ArrayLiteralAst
        ? [...array.elements()].map((element) => element.syntax.kind)
        : [];
    });

    expect(diagnostics).toEqual([]);
    expect(elementKinds).toEqual([['Identifier', 'PathExpr'], ['FunctionCall'], ['FunctionCall']]);
  });
});
