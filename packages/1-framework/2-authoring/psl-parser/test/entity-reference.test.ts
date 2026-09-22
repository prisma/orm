import { ok } from '@internal/utils/result';
import { describe, expect, it } from 'vitest';
import type { EntitySelector } from '../src/exports';
import { blockAttribute, entityRef, identifier, list, oneOf } from '../src/exports';
import { parse } from '../src/parse';
import { buildSymbolTable } from '../src/symbol-table';
import { ModelAttributeAst } from '../src/syntax/ast/attributes';
import { IdentifierAst } from '../src/syntax/ast/identifier';
import { SyntaxNode } from '../src/syntax/red';

function fixture(value: string, local = true) {
  const members = [
    ...(local ? [`model Owner {\n @@test(${value})\n}`] : []),
    'model Shared {}',
    'type Global {}',
    'permission Writer {}',
  ];
  const declarations = [
    'model Shared {}',
    'model Global {}',
    'model Fallback {}',
    'type Address {}',
    'types { Email = String }',
    'permission Reader {}',
    `namespace Local {\n${members.join('\n')}\n}`,
    'namespace Sibling {\n model Hidden {}\n model Shared {}\n}',
    ...(local ? [] : [`model Owner {\n @@test(${value})\n}`]),
  ];
  const { document, sources } = parse(declarations.join('\n'), 'references.prisma');
  const { symbolTable, diagnostics } = buildSymbolTable({
    documents: [document],
    sources,
    pslBlockDescriptors: {},
  });
  expect(diagnostics).toEqual([]);
  const namespace = symbolTable.topLevel.namespaces['Local'];
  if (!namespace) throw new Error('Missing namespace');
  for (const syntax of document.syntax.descendants()) {
    if (!(syntax instanceof SyntaxNode)) continue;
    const attribute = ModelAttributeAst.cast(syntax);
    const expression = attribute?.argList()?.args()[Symbol.iterator]().next().value?.value();
    if (expression)
      return {
        expression,
        ctx: { sources, symbols: symbolTable },
        sources,
        table: symbolTable,
        namespace,
      };
  }
  throw new Error('Missing expression');
}

describe('syntax-scoped entity resolution', () => {
  it('supplies the completed table to existing block attribute rules', () => {
    const { document, sources } = parse(
      'namespace Local {\n permission Reader {\n @@target(Later)\n }\n model Later {}\n}',
      'references.prisma',
    );
    const target = blockAttribute('target', {
      documentation: 'Names a model.',
      positional: [
        { key: 'model', type: entityRef({ kind: 'model' }), documentation: 'The selected model.' },
      ],
    });
    const result = buildSymbolTable({
      documents: [document],
      sources,
      pslBlockDescriptors: {
        permission: {
          name: { required: true },
          kind: 'pslBlock',
          keyword: 'permission',
          discriminator: 'permission',
          parameters: {},
          attributes: { target: () => target },
        },
      },
    });
    expect(result.diagnostics).toEqual([]);
    const namespace = result.symbolTable.topLevel.namespaces['Local'];
    expect(namespace?.blocks['Reader']?.block.attributes['target']?.args).toEqual({
      model: { declaration: namespace?.models['Later'], namespace },
    });
  });
  it('selects the local declaration, including forward references', () => {
    const { expression, ctx, namespace } = fixture('Shared');
    expect(entityRef({ kind: 'model' }).parse(expression, ctx)).toEqual(
      ok({
        declaration: namespace.models['Shared'],
        namespace,
      }),
    );
  });

  it.each<[EntitySelector, string]>([
    [{ kind: 'model' }, 'Fallback'],
    [{ kind: 'compositeType' }, 'Address'],
    [{ kind: 'namedType' }, 'Email'],
    [{ kind: 'block', keyword: 'permission' }, 'Reader'],
  ])('falls back to top-level %j', (selector, name) => {
    const { expression, ctx } = fixture(name);
    const rule = entityRef(selector);
    expect(rule.expected).toEqual(selector);
    expect(rule.parse(expression, ctx)).toMatchObject({
      ok: true,
      value: { declaration: { name, kind: selector.kind }, namespace: undefined },
    });
  });

  it('selects only top-level declarations outside namespaces', () => {
    const { expression, ctx, table } = fixture('Shared', false);
    expect(entityRef({ kind: 'model' }).parse(expression, ctx)).toEqual(
      ok({
        declaration: table.topLevel.models['Shared'],
        namespace: undefined,
      }),
    );
  });

  it.each(['Hidden', 'Missing', 'toString', 'constructor', '__proto__'])(
    'rejects unavailable and inherited names: %s',
    (name) => {
      const { expression, ctx, sources } = fixture(name);
      const sourceFile = sources.sourceFileFor(expression.syntax);
      expect(entityRef({ kind: 'model' }).parse(expression, ctx)).toMatchObject({
        ok: false,
        failure: [
          {
            message: `Unknown model reference "${name}"`,
            filename: 'references.prisma',
            range: {
              start: sourceFile.positionAt(expression.syntax.offset),
              end: sourceFile.positionAt(expression.syntax.endOffset),
            },
          },
        ],
      });
    },
  );

  it('resolves a declared __proto__ model as an own map entry', () => {
    const { document, sources } = parse(
      'model __proto__ {}\nmodel Owner {\n @@test(__proto__)\n}',
      'references.prisma',
    );
    const { symbolTable, diagnostics } = buildSymbolTable({
      documents: [document],
      sources,
      pslBlockDescriptors: {},
    });
    expect(diagnostics).toEqual([]);
    expect(Object.hasOwn(symbolTable.topLevel.models, '__proto__')).toBe(true);
    const declaration = Object.entries(symbolTable.topLevel.models).find(
      ([name]) => name === '__proto__',
    )?.[1];
    expect(declaration).toBeDefined();
    for (const syntax of document.syntax.descendants()) {
      if (!(syntax instanceof SyntaxNode)) continue;
      const attribute = ModelAttributeAst.cast(syntax);
      const expression = attribute?.argList()?.args()[Symbol.iterator]().next().value?.value();
      if (!expression) continue;
      const ctx = { sources, symbols: symbolTable };
      expect(entityRef({ kind: 'model' }).parse(expression, ctx)).toEqual(
        ok({ declaration, namespace: undefined }),
      );
      return;
    }
    throw new Error('Missing expression');
  });

  it('does not search child namespaces from top-level', () => {
    const { expression, ctx } = fixture('Writer', false);
    expect(entityRef({ kind: 'block', keyword: 'permission' }).parse(expression, ctx).ok).toBe(
      false,
    );
  });

  it('checks kind after selecting the local binding', () => {
    const { expression, ctx } = fixture('Global');
    expect(entityRef({ kind: 'model' }).parse(expression, ctx)).toMatchObject({
      ok: false,
      failure: [{ message: 'Expected model reference "Global", found compositeType' }],
    });
  });

  it.each<EntitySelector>([
    { kind: 'model' },
    { kind: 'compositeType' },
    { kind: 'namedType' },
    { kind: 'block', keyword: 'permission' },
  ])('rejects a different declaration kind for %j', (selector) => {
    const { expression, ctx } = fixture(selector.kind === 'model' ? 'Address' : 'Shared');
    const result = entityRef(selector).parse(expression, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure).toHaveLength(1);
  });

  it('reuses one grammar across documents without retaining another scope', () => {
    const rule = entityRef({ kind: 'model' });
    const local = fixture('Shared');
    const top = fixture('Shared', false);
    expect(rule.parse(local.expression, local.ctx)).toEqual(
      ok({
        declaration: local.namespace.models['Shared'],
        namespace: local.namespace,
      }),
    );
    expect(rule.parse(top.expression, top.ctx)).toEqual(
      ok({
        declaration: top.table.topLevel.models['Shared'],
        namespace: undefined,
      }),
    );
  });

  it('checks contributed block keywords', () => {
    const { expression, ctx } = fixture('Reader');
    expect(entityRef({ kind: 'block', keyword: 'other' }).parse(expression, ctx)).toMatchObject({
      ok: false,
      failure: [{ message: 'Expected other reference "Reader", found permission' }],
    });
  });

  it('shares wrapper identity across rules and repeated expressions', () => {
    const { expression, ctx } = fixture('[Shared, Shared]');
    expect(
      list(entityRef({ kind: 'model' }), { unique: true }).parse(expression, ctx),
    ).toMatchObject({
      ok: false,
      failure: [{ message: 'Duplicate list entry' }],
    });
    const single = fixture('Shared');
    const first = entityRef({ kind: 'model' }).parse(single.expression, single.ctx);
    const second = entityRef({ kind: 'model' }).parse(single.expression, single.ctx);
    if (!first.ok || !second.ok) throw new Error('Missing reference');
    expect(first.value).toBe(second.value);
  });

  it('accepts structural expressions from another AST copy', () => {
    const { expression, ctx, namespace } = fixture('Shared');
    const identifier = IdentifierAst.cast(expression.syntax);
    if (!identifier) throw new Error('Missing identifier');
    const foreign = {
      syntax: identifier.syntax,
      name: () => identifier.name(),
      token: () => identifier.token(),
    };
    expect(foreign).not.toBeInstanceOf(IdentifierAst);
    expect(entityRef({ kind: 'model' }).parse(foreign, ctx)).toEqual(
      ok({
        declaration: namespace.models['Shared'],
        namespace,
      }),
    );
  });
});

describe('checked references and unchecked identifiers', () => {
  it.each(['Shared', 'Missing', 'Global'])('keeps alternatives diagnostic-pure for %s', (name) => {
    const { expression, ctx, namespace } = fixture(name);
    expect(oneOf(entityRef({ kind: 'model' }), identifier()).parse(expression, ctx)).toEqual(
      ok(name === 'Shared' ? { declaration: namespace.models['Shared'], namespace } : name),
    );
  });

  it('aggregates all-failure alternatives at their source', () => {
    const { expression, ctx } = fixture('42');
    expect(oneOf(entityRef({ kind: 'model' }), identifier()).parse(expression, ctx)).toMatchObject({
      ok: false,
      failure: [
        { message: 'Expected one of: model reference | identifier', filename: 'references.prisma' },
      ],
    });
  });

  it('preserves unrestricted identifier metadata and names', () => {
    const { expression, ctx } = fixture('External');
    expect(identifier()).toMatchObject({
      kind: 'identifier',
      name: undefined,
      label: 'identifier',
    });
    expect(identifier().parse(expression, ctx)).toEqual(ok('External'));
  });

  it.each(['"Shared"', '42', '[Shared]', 'Shared()', 'true'])(
    'rejects non-identifiers: %s',
    (value) => {
      const { expression, ctx } = fixture(value);
      expect(entityRef({ kind: 'model' }).parse(expression, ctx).ok).toBe(false);
      expect(identifier().parse(expression, ctx).ok).toBe(false);
    },
  );
});
