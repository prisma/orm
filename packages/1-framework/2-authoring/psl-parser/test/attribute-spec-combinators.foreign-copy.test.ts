import { describe, expect, it } from 'vitest';
import type { InterpretCtx } from '../src/exports';
import {
  bool,
  entityRef,
  fieldRef,
  funcCall,
  identifier,
  int,
  json,
  list,
  num,
  record,
  str,
} from '../src/exports';
import { Cursor, parse, parseAttribute } from '../src/parse';
import { buildSymbolTable } from '../src/symbol-table';
import { FieldAttributeAst } from '../src/syntax/ast/attributes';
import type { ExpressionAst } from '../src/syntax/ast/expressions';
import type { SyntaxNode } from '../src/syntax/red';
import { createSyntaxTree } from '../src/syntax/red';

class ForeignCopyOfAnAstNode {
  readonly syntax: SyntaxNode;
  constructor(syntax: SyntaxNode) {
    this.syntax = syntax;
  }
}

function foreignArg(source: string): { arg: ExpressionAst; ctx: InterpretCtx } {
  const cursor = new Cursor(`@demo(${source})`);
  const node = FieldAttributeAst.cast(createSyntaxTree(parseAttribute(cursor)));
  const value = Array.from(node?.argList()?.args() ?? [])[0]?.value();
  if (value === undefined) throw new Error('expected one argument');
  const { document, sourceFile } = parse('model M {\n  id Int @id\n}\n');
  const { table } = buildSymbolTable({ document, sourceFile, pslBlockDescriptors: {} });
  const selfModel = table.topLevel.models['M'];
  if (selfModel === undefined) throw new Error('expected model M');
  return {
    arg: new ForeignCopyOfAnAstNode(value.syntax) as unknown as ExpressionAst,
    ctx: {
      level: 'field',
      sourceId: 'schema.prisma',
      sourceFile: cursor.sourceFile,
      selfModel,
      resolveReferencedModel: () => undefined,
    },
  };
}

describe('combinators dispatch on syntax kind, not on AST class identity', () => {
  it.each([
    ['str', str(), '"x"', 'x'],
    ['int', int(), '3', 3],
    ['num', num(), '2.5', 2.5],
    ['bool', bool(), 'true', true],
    ['identifier', identifier('Cascade'), 'Cascade', 'Cascade'],
    ['entityRef', entityRef(), 'User', 'User'],
    ['fieldRef', fieldRef('self'), 'id', 'id'],
    ['json', json(), '"{\\"a\\":1}"', { a: 1 }],
    ['list', list(str()), '["a", "b"]', ['a', 'b']],
    ['record', record(int()), '{ a: 1 }', { a: 1 }],
  ])('%s accepts a node from another module copy', (_name, argType, source, expected) => {
    const { arg, ctx } = foreignArg(source);

    const result = argType.parse(arg, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(expected);
  });

  it('funcCall accepts a node from another module copy', () => {
    const { arg, ctx } = foreignArg('now()');

    const result = funcCall('now', {}).parse(arg, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toMatchObject({ fn: 'now', args: {} });
  });
});
