import { describe, expect, it } from 'vitest';
import { blockAttribute } from '../src/attribute-spec/block-attribute';
import { entityRef } from '../src/attribute-spec/combinators/entity-ref';
import { identifier } from '../src/attribute-spec/combinators/identifier';
import { list } from '../src/attribute-spec/combinators/list';
import { oneOf } from '../src/attribute-spec/combinators/one-of';
import { modelAttribute } from '../src/attribute-spec/model-attribute';
import type { ArgType, AttributeCtx } from '../src/attribute-spec/types';
import { createBinder } from '../src/binder';
import { mapBlock } from '../src/block-spec/constructors';
import { parse } from '../src/parse';
import { buildSymbolTable } from '../src/symbol-table';
import { ArrayLiteralAst, type ExpressionAst, PathExprAst } from '../src/syntax/ast/expressions';
import type { SyntaxNode } from '../src/syntax/red';
import { binderContext } from './support';

const modelRef = entityRef({ kind: 'model' });
const roleRef = entityRef({ kind: 'block', keyword: 'role' });

const namespaces = [
  'model Top {}',
  'namespace auth {',
  ' model Account {}',
  ' model User {}',
  ' role auditor {}',
  '}',
  'namespace reporting {',
  ' model Report {}',
  '}',
].join('\n');

function bind(source: string, rule: ArgType<unknown, AttributeCtx>) {
  const { document, sources } = parse(`${source}\n${namespaces}`, 'qualified.psl');
  const { symbolTable } = buildSymbolTable({ documents: [document], sources });
  const parameters = {
    positional: [{ key: 'target', type: rule, documentation: 'target' }],
    documentation: 'references',
  };
  const result = createBinder({
    sources,
    symbolTable,
    context: binderContext({
      attributeSpecs: {
        model: {
          refs: () => modelAttribute('refs', parameters),
          extends: () => modelAttribute('extends', parameters),
        },
        field: {},
      },
      pslBlockDescriptors: {
        policy: {
          kind: 'pslBlock',
          keyword: 'policy',
          discriminator: 'policy',
          name: { required: true },
          spec: () => mapBlock({ value: { type: rule, documentation: 'target' } }),
          attributes: { refs: () => blockAttribute('refs', parameters) },
        },
      },
    }),
  });
  const auth = symbolTable.topLevel.namespaces['auth']!;
  const parseValue = (expression: ExpressionAst) =>
    rule.parse(expression, { sources, symbols: symbolTable, binder: result.binder });
  return { ...result, sources, symbolTable, auth, parseValue };
}

function parsedValue(parsed: ReturnType<ReturnType<typeof bind>['parseValue']>): unknown {
  if (!parsed.ok) throw new Error(`Expected a parsed value: ${JSON.stringify(parsed.failure)}`);
  return parsed.value;
}

function entryValue(result: ReturnType<typeof bind>, block: string): ExpressionAst {
  const symbol =
    result.symbolTable.topLevel.blocks[block] ??
    result.symbolTable.topLevel.namespaces['app']?.blocks[block];
  return [...symbol!.node.entries()][0]!.value()!;
}

function span(result: ReturnType<typeof bind>, expression: ExpressionAst) {
  const file = result.sources.sourceFileFor(expression.syntax);
  return {
    start: file.positionAt(expression.syntax.offset),
    end: file.positionAt(expression.syntax.endOffset),
  };
}

function qualifierOf(expression: ExpressionAst): SyntaxNode {
  const [qualifier] = PathExprAst.cast(expression.syntax)!.segments();
  return qualifier!.syntax;
}

function firstModelArgument(result: ReturnType<typeof bind>, model: string): ExpressionAst {
  const holder = result.symbolTable.topLevel.models[model]!;
  return [...[...holder.node.attributes()][0]!.argList()!.args()][0]!.value()!;
}

describe('qualified entity references', () => {
  it('binds a namespace-qualified model in a block value', () => {
    const result = bind('policy P {\n target = auth.Account\n}', modelRef);
    const value = entryValue(result, 'P');
    expect(result.diagnostics).toEqual([]);
    expect(result.binder.symbolForNode(value.syntax)).toEqual({
      kind: 'model',
      symbol: result.auth.models['Account'],
      namespace: result.auth,
    });
    expect(parsedValue(result.parseValue(value))).toEqual({
      declaration: result.auth.models['Account'],
      namespace: result.auth,
    });
  });

  it('binds namespace-qualified role blocks in a list alongside bare names', () => {
    const rule = list(oneOf(roleRef, identifier()));
    const result = bind('policy P {\n roles = [auth.auditor, custom]\n}', rule);
    const value = entryValue(result, 'P');
    const elements = [...ArrayLiteralAst.cast(value.syntax)!.elements()];
    expect(result.diagnostics).toEqual([]);
    expect(result.binder.symbolForNode(elements[0]!.syntax)).toEqual({
      kind: 'block',
      symbol: result.auth.blocks['auditor'],
      namespace: result.auth,
    });
    expect(parsedValue(result.parseValue(value))).toEqual([
      { declaration: result.auth.blocks['auditor'], namespace: result.auth },
      'custom',
    ]);
  });

  it('binds a qualified reference from inside another namespace', () => {
    const result = bind(
      'namespace app {\n policy P {\n  target = reporting.Report\n }\n}',
      modelRef,
    );
    const reporting = result.symbolTable.topLevel.namespaces['reporting']!;
    expect(result.diagnostics).toEqual([]);
    expect(result.binder.symbolForNode(entryValue(result, 'P').syntax)).toEqual({
      kind: 'model',
      symbol: reporting.models['Report'],
      namespace: reporting,
    });
  });

  it('binds a qualified reference in an attribute argument', () => {
    const result = bind('model Holder {\n @@refs(auth.Account)\n}', modelRef);
    const holder = result.symbolTable.topLevel.models['Holder']!;
    const arg = [...[...holder.node.attributes()][0]!.argList()!.args()][0]!.value()!;
    expect(result.diagnostics).toEqual([]);
    expect(result.binder.symbolForNode(arg.syntax)).toEqual({
      kind: 'model',
      symbol: result.auth.models['Account'],
      namespace: result.auth,
    });
  });

  it.each([
    ['nope.Account', 'Cannot find entity "nope.Account"'],
    ['auth.Ghost', 'Cannot find entity "auth.Ghost"'],
    ['Top.Account', '"Top" is a model, not a namespace'],
  ])('reports an unresolvable qualified reference at its span: %s', (reference, message) => {
    const result = bind(`policy P {\n target = ${reference}\n}`, modelRef);
    const value = entryValue(result, 'P');
    expect(
      result.diagnostics.map(({ code, message, range }) => ({ code, message, range })),
    ).toEqual([{ code: 'PSL_UNRESOLVED_REFERENCE', message, range: span(result, value) }]);
  });

  it('leaves a missing member name to the parser', () => {
    const result = bind('policy P {\n target = auth.\n}', modelRef);
    expect(result.diagnostics).toEqual([]);
    expect(result.binder.symbolForNode(entryValue(result, 'P').syntax)).toEqual({
      kind: 'unresolved',
      name: 'auth.',
    });
  });

  it('rejects a qualified member of the wrong kind at its span', () => {
    const result = bind('policy P {\n target = auth.auditor\n}', modelRef);
    const value = entryValue(result, 'P');
    expect(result.diagnostics).toEqual([]);
    const parsed = result.parseValue(value);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.failure.map(({ message, range }) => ({ message, range }))).toEqual([
        {
          message: 'Expected model reference "auth.auditor", found role',
          range: span(result, value),
        },
      ]);
    }
  });
});

describe('qualifiers of qualified entity references', () => {
  it('binds the qualifier in @@extends(auth.User) to the namespace', () => {
    const result = bind('model Holder {\n @@extends(auth.User)\n}', modelRef);
    const arg = firstModelArgument(result, 'Holder');
    expect(result.diagnostics).toEqual([]);
    expect(result.binder.symbolForNode(qualifierOf(arg))).toEqual({
      kind: 'namespace',
      symbol: result.auth,
    });
    expect(result.binder.symbolForNode(arg.syntax)).toEqual({
      kind: 'model',
      symbol: result.auth.models['User'],
      namespace: result.auth,
    });
  });

  it('binds the qualifier in a block value to the namespace', () => {
    const result = bind('policy P {\n target = auth.Account\n}', modelRef);
    expect(result.binder.symbolForNode(qualifierOf(entryValue(result, 'P')))).toEqual({
      kind: 'namespace',
      symbol: result.auth,
    });
  });

  it('binds the qualifier when the member is missing', () => {
    const result = bind('policy P {\n target = auth.Ghost\n}', modelRef);
    const value = entryValue(result, 'P');
    expect(result.binder.symbolForNode(qualifierOf(value))).toEqual({
      kind: 'namespace',
      symbol: result.auth,
    });
    expect(result.diagnostics.map(({ message }) => message)).toEqual([
      'Cannot find entity "auth.Ghost"',
    ]);
  });

  it('binds the qualifier when no alternative of a oneOf matches', () => {
    const result = bind('policy P {\n roles = [auth.ghost]\n}', list(oneOf(roleRef, modelRef)));
    const [element] = ArrayLiteralAst.cast(entryValue(result, 'P').syntax)!.elements();
    expect(result.binder.symbolForNode(qualifierOf(element!))).toEqual({
      kind: 'namespace',
      symbol: result.auth,
    });
    expect(result.binder.symbolForNode(element!.syntax)).toEqual({
      kind: 'unresolved',
      name: 'auth.ghost',
    });
  });

  it('binds the qualifier once when the second alternative of a oneOf matches', () => {
    const result = bind('policy P {\n roles = [auth.auditor]\n}', list(oneOf(modelRef, roleRef)));
    const [element] = ArrayLiteralAst.cast(entryValue(result, 'P').syntax)!.elements();
    expect(result.binder.symbolForNode(qualifierOf(element!))).toEqual({
      kind: 'namespace',
      symbol: result.auth,
    });
    expect(result.binder.symbolForNode(element!.syntax)).toEqual({
      kind: 'block',
      symbol: result.auth.blocks['auditor'],
      namespace: result.auth,
    });
  });

  it.each(['Top.Account', 'nope.Account'])(
    'records nothing on a qualifier that is not a namespace: %s',
    (reference) => {
      const result = bind(`policy P {\n target = ${reference}\n}`, modelRef);
      expect(result.binder.symbolForNode(qualifierOf(entryValue(result, 'P')))).toBeUndefined();
    },
  );
});
