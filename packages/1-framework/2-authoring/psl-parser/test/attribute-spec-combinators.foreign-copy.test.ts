import { describe, expect, it } from 'vitest';
import type { ModelAttributeCtx } from '../src/exports';
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
  numLiteral,
  record,
  str,
} from '../src/exports';
import { parse } from '../src/parse';
import { buildSymbolTable } from '../src/symbol-table';
import type { ExpressionAst } from '../src/syntax/ast/expressions';
import type { SyntaxNode } from '../src/syntax/red';

class ForeignCopyOfAnAstNode {
  readonly syntax: SyntaxNode;
  constructor(syntax: SyntaxNode) {
    this.syntax = syntax;
  }
}

function foreignArg(source: string): { arg: ExpressionAst; ctx: ModelAttributeCtx } {
  const { document, sources } = parse(`model M {\n  id Int @demo(${source})\n}\n`, 'schema.prisma');
  const { symbolTable } = buildSymbolTable({
    documents: [document],
    sources,
    pslBlockDescriptors: {},
  });
  const selfModel = symbolTable.topLevel.models['M'];
  if (selfModel === undefined) throw new Error('expected model M');
  const node = selfModel.fields['id']?.node.attributes()[Symbol.iterator]().next().value;
  const value = node?.argList()?.args()[Symbol.iterator]().next().value?.value();
  if (value === undefined) throw new Error('expected one argument');
  return {
    arg: new ForeignCopyOfAnAstNode(value.syntax) as unknown as ExpressionAst,
    ctx: {
      sources,
      symbols: symbolTable,
      selfModel,
    },
  };
}

describe('combinators dispatch on syntax kind, not on AST class identity', () => {
  it.each([
    ['str', str(), '"x"', 'x'],
    ['int', int(), '3', 3],
    ['num', num(), '2.5', 2.5],
    ['numLiteral', numLiteral(), '2.50', { text: '2.50' }],
    ['bool', bool(), 'true', true],
    [
      'identifier',
      identifier('Cascade', { documentation: 'An accepted identifier in this test grammar.' }),
      'Cascade',
      'Cascade',
    ],
    ['unrestricted identifier', identifier(), 'User', 'User'],
    ['fieldRef', fieldRef(), 'id', 'id'],
    ['json', json(), '"{\\"a\\":1}"', { a: 1 }],
    ['list', list(str()), '["a", "b"]', ['a', 'b']],
    ['record', record(int()), '{ a: 1 }', { a: 1 }],
  ])('%s accepts a node from another module copy', (_name, argType, source, expected) => {
    const { arg, ctx } = foreignArg(source);

    const result = argType.parse(arg, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(expected);
  });

  it('entityRef accepts a node from another module copy and preserves identity', () => {
    const { arg, ctx } = foreignArg('M');
    const reference = { declaration: ctx.selfModel, namespace: undefined };
    const result = entityRef({ kind: 'model' }).parse(arg, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(reference);
  });

  it('funcCall accepts a node from another module copy', () => {
    const { arg, ctx } = foreignArg('now()');

    const result = funcCall('now', { documentation: 'Calls the named value generator.' }).parse(
      arg,
      ctx,
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toMatchObject({ fn: 'now', args: {} });
  });
});
