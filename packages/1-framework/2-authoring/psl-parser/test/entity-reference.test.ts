import { ok } from '@internal/utils/result';
import { describe, expect, it } from 'vitest';
import type { EntitySelector } from '../src/exports';
import { createEntityResolver, entityRef, identifier, list, oneOf } from '../src/exports';
import { Cursor, parse, parseAttribute } from '../src/parse';
import { buildSymbolTable } from '../src/symbol-table';
import { FieldAttributeAst } from '../src/syntax/ast/attributes';
import { createSyntaxTree } from '../src/syntax/red';

function symbols(source: string) {
  const { document, sourceFile } = parse(source);
  const result = buildSymbolTable({ document, sourceFile, pslBlockDescriptors: {} });
  expect(result.diagnostics).toEqual([]);
  return result.table;
}

function argument(source: string) {
  const cursor = new Cursor(`@test(${source})`);
  const attribute = FieldAttributeAst.cast(createSyntaxTree(parseAttribute(cursor)));
  const expression = [...(attribute?.argList()?.args() ?? [])][0]?.value();
  if (!expression) throw new Error('Missing expression');
  return { expression, ctx: { sourceId: 'references.prisma', sourceFile: cursor.sourceFile } };
}

const declarations = [
  'model Owner {}',
  'model Shared {}',
  'model Global {}',
  'model Fallback {}',
  'type Address {}',
  'types { Email = String }',
  'permission Reader {}',
  'namespace Local {\n model Owner {}\n model Shared {}\n type Global {}\n permission Writer {}\n}',
  'namespace Sibling {\n model Hidden {}\n model Shared {}\n}',
];

function fixture(reverse = false) {
  const table = symbols((reverse ? [...declarations].reverse() : declarations).join('\n'));
  const namespace = table.topLevel.namespaces['Local'];
  const owner = namespace?.models['Owner'];
  const topOwner = table.topLevel.models['Owner'];
  if (!namespace || !owner || !topOwner) throw new Error('Missing owner');
  return {
    table,
    namespace,
    resolve: createEntityResolver({ symbols: table, owner }),
    topResolve: createEntityResolver({ symbols: table, owner: topOwner }),
  };
}

describe('factory-bound entity resolution', () => {
  it.each([false, true])(
    'selects lexical identities independently of declaration order (%s)',
    (reverse) => {
      const { table, namespace, resolve, topResolve } = fixture(reverse);
      expect(resolve('Shared')).toEqual({ declaration: namespace.models['Shared'], namespace });
      expect(resolve('Shared')?.declaration).toBe(namespace.models['Shared']);
      expect(resolve('Address')).toEqual({
        declaration: table.topLevel.compositeTypes['Address'],
        namespace: undefined,
      });
      expect(resolve('Email')?.declaration).toBe(table.topLevel.namedTypes['Email']);
      expect(resolve('Fallback')?.declaration).toBe(table.topLevel.models['Fallback']);
      expect(resolve('Fallback')?.namespace).toBeUndefined();
      expect(resolve('Hidden')).toBeUndefined();
      expect(topResolve('Shared')?.declaration).toBe(table.topLevel.models['Shared']);
      expect(topResolve('Writer')).toBeUndefined();
      expect(resolve('Missing')).toBeUndefined();
      expect(resolve('toString')).toBeUndefined();
      expect(resolve('Shared')).toBe(resolve('Shared'));
    },
  );

  it('binds composite and block owners by identity rather than matching top-level names', () => {
    const { table, namespace } = fixture();
    const composite = namespace.compositeTypes['Global'];
    const block = namespace.blocks['Writer'];
    if (!composite || !block) throw new Error('Missing owner');
    for (const owner of [composite, block]) {
      const resolve = createEntityResolver({ symbols: table, owner });
      expect(resolve('Shared')?.declaration).toBe(namespace.models['Shared']);
    }
  });

  it('rejects the selected wrong-kind shadow instead of falling back', () => {
    const { resolve, namespace } = fixture();
    const { expression, ctx } = argument('Global');
    expect(resolve('Global')?.declaration).toBe(namespace.compositeTypes['Global']);
    expect(entityRef({ kind: 'model' }, resolve).parse(expression, ctx)).toMatchObject({
      ok: false,
      failure: [
        {
          message: 'Expected model reference "Global", found compositeType',
          sourceId: 'references.prisma',
          span: { start: { offset: 6 }, end: { offset: 12 } },
        },
      ],
    });
  });
});

describe('checked references and unchecked identifiers', () => {
  it.each<[EntitySelector, string]>([
    [{ kind: 'model' }, 'Shared'],
    [{ kind: 'compositeType' }, 'Address'],
    [{ kind: 'namedType' }, 'Email'],
    [{ kind: 'block', keyword: 'permission' }, 'Reader'],
  ])('returns the selected identity for %j', (selector, name) => {
    const { topResolve } = fixture();
    const { expression, ctx } = argument(name);
    const rule = entityRef(selector, topResolve);
    expect(rule.expected).toEqual(selector);
    const result = rule.parse(expression, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(topResolve(name));
  });

  it.each<EntitySelector>([
    { kind: 'model' },
    { kind: 'compositeType' },
    { kind: 'namedType' },
    { kind: 'block', keyword: 'permission' },
  ])('rejects a different declaration kind for %j', (selector) => {
    const { topResolve } = fixture();
    const name = selector.kind === 'model' ? 'Address' : 'Shared';
    const { expression, ctx } = argument(name);
    const result = entityRef(selector, topResolve).parse(expression, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure).toHaveLength(1);
  });

  it('checks contributed block keywords', () => {
    const { topResolve } = fixture();
    const { expression, ctx } = argument('Reader');
    expect(
      entityRef({ kind: 'block', keyword: 'other' }, topResolve).parse(expression, ctx),
    ).toMatchObject({
      ok: false,
      failure: [{ message: 'Expected other reference "Reader", found permission' }],
    });
  });

  it('anchors missing references at the expression', () => {
    const { resolve } = fixture();
    const { expression, ctx } = argument('Missing');
    expect(entityRef({ kind: 'model' }, resolve).parse(expression, ctx)).toMatchObject({
      ok: false,
      failure: [
        {
          code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
          message: 'Unknown model reference "Missing"',
          sourceId: 'references.prisma',
          span: { start: { offset: 6 }, end: { offset: 13 } },
        },
      ],
    });
  });

  it('preserves wrapper identity so repeated list entries fail uniqueness', () => {
    const { resolve } = fixture();
    const rule = list(entityRef({ kind: 'model' }, resolve), { unique: true });
    const { expression, ctx } = argument('[Shared, Shared]');
    expect(rule.parse(expression, ctx)).toMatchObject({
      ok: false,
      failure: [{ message: 'Duplicate list entry' }],
    });
    const distinct = argument('[Shared, Owner]');
    expect(rule.parse(distinct.expression, distinct.ctx)).toEqual(
      ok([resolve('Shared'), resolve('Owner')]),
    );
  });

  it.each(['Shared', 'Missing', 'Global'])(
    'keeps reference-first alternatives diagnostic-pure for %s',
    (name) => {
      const { resolve } = fixture();
      const rule = oneOf(entityRef({ kind: 'model' }, resolve), identifier());
      const { expression, ctx } = argument(name);
      expect(rule.parse(expression, ctx)).toEqual(ok(name === 'Shared' ? resolve(name) : name));
    },
  );

  it('aggregates all-failure alternatives at their source', () => {
    const { resolve } = fixture();
    const { expression, ctx } = argument('42');
    expect(
      oneOf(entityRef({ kind: 'model' }, resolve), identifier()).parse(expression, ctx),
    ).toMatchObject({
      ok: false,
      failure: [
        { message: 'Expected one of: model reference | identifier', sourceId: 'references.prisma' },
      ],
    });
  });

  it('exposes unrestricted metadata and preserves exact names', () => {
    const { expression, ctx } = argument('External');
    expect(identifier()).toMatchObject({
      kind: 'identifier',
      name: undefined,
      label: 'identifier',
    });
    expect(identifier().parse(expression, ctx)).toEqual(ok('External'));
  });

  it.each(['"Shared"', '42', '[Shared]', 'Shared()', 'true'])(
    'rejects non-identifier syntax %s',
    (source) => {
      const { resolve } = fixture();
      const { expression, ctx } = argument(source);
      expect(entityRef({ kind: 'model' }, resolve).parse(expression, ctx).ok).toBe(false);
      expect(identifier().parse(expression, ctx).ok).toBe(false);
    },
  );
});
