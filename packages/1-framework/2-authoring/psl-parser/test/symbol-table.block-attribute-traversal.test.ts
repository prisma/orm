import type { AuthoringPslBlockDescriptorNamespace } from '@internal/framework-components/authoring';
import { describe, expect, it, vi } from 'vitest';
import { blockAttribute, str } from '../src/exports';
import { parse } from '../src/parse';
import { type BlockSymbol, buildSymbolTable } from '../src/symbol-table';

const locations = [
  { namespace: undefined, name: 'Gear' },
  { namespace: undefined, name: '__proto__' },
  { namespace: 'Local', name: '__proto__' },
  { namespace: '__proto__', name: 'Gear' },
  { namespace: '__proto__', name: '__proto__' },
];

function fixture(
  namespace: string | undefined,
  name: string,
  attributes: string,
  duplicate = false,
) {
  const interpretedSymbols: (BlockSymbol | undefined)[] = [];
  const spec = blockAttribute('map', {
    documentation: 'Maps a widget.',
    positional: [{ key: 'name', type: str(), documentation: 'The storage name.' }],
    refine: (_args, ctx) => {
      const scope =
        namespace === undefined ? ctx.symbols.topLevel : ctx.symbols.topLevel.namespaces[namespace];
      interpretedSymbols.push(scope?.blocks[name]);
      return [];
    },
  });
  const factory = vi.fn(() => spec);
  const descriptors: AuthoringPslBlockDescriptorNamespace = {
    widget: {
      kind: 'pslBlock',
      keyword: 'widget',
      discriminator: 'widget',
      name: { required: true },
      parameters: {},
      attributes: { map: factory },
    },
  };
  const block = `widget ${name} {\n${attributes}\n}`;
  const declarations = duplicate ? `${block}\nwidget ${name} {\n@@missing()\n}` : block;
  const source =
    namespace === undefined ? declarations : `namespace ${namespace} {\n${declarations}\n}`;
  const { document, sources, diagnostics: parseDiagnostics } = parse(source, 'widgets.prisma');
  expect(parseDiagnostics).toEqual([]);
  const result = buildSymbolTable({
    documents: [document],
    sources,
    pslBlockDescriptors: descriptors,
  });
  const scope =
    namespace === undefined
      ? result.symbolTable.topLevel
      : result.symbolTable.topLevel.namespaces[namespace];
  return { ...result, scope, block: scope?.blocks[name], factory, interpretedSymbols };
}

describe.each(locations)(
  'block attribute traversal in $namespace for $name',
  ({ namespace, name }) => {
    it('interprets accepted attributes once and reports every unknown occurrence', () => {
      const result = fixture(
        namespace,
        name,
        '@@map("first")\n@@missing()\n@@missing()\n@@map("second")',
      );
      expect(result.diagnostics.map(({ code, message }) => ({ code, message }))).toEqual([
        {
          code: 'PSL_EXTENSION_UNKNOWN_BLOCK_ATTRIBUTE',
          message: `Unknown attribute "@@missing" in "widget" block "${name}"`,
        },
        {
          code: 'PSL_EXTENSION_UNKNOWN_BLOCK_ATTRIBUTE',
          message: `Unknown attribute "@@missing" in "widget" block "${name}"`,
        },
        {
          code: 'PSL_INVALID_EXTENSION_BLOCK_ATTRIBUTE',
          message: `Duplicate attribute "@@map" in "widget" block "${name}"; first occurrence wins`,
        },
      ]);
      expect(result.block?.block.attributes['map']?.args).toEqual({ name: 'first' });
      expect(result.factory).toHaveBeenCalledTimes(1);
      expect(result.scope && Object.hasOwn(result.scope.blocks, name)).toBe(true);
    });

    it('retains failed-first attribute recovery without retrying its duplicate', () => {
      const result = fixture(namespace, name, '@@map()\n@@map("second")');
      expect(result.diagnostics.map(({ code }) => code)).toEqual([
        'PSL_INVALID_ATTRIBUTE_SYNTAX',
        'PSL_INVALID_EXTENSION_BLOCK_ATTRIBUTE',
      ]);
      expect(result.block?.block.attributes).toEqual({});
      expect(result.factory).toHaveBeenCalledTimes(1);
    });

    it('interprets only the first accepted block declaration', () => {
      const result = fixture(namespace, name, '@@map("first")', true);
      expect(result.diagnostics.map(({ code, message }) => ({ code, message }))).toEqual([
        { code: 'PSL_DUPLICATE_DECLARATION', message: `Duplicate declaration of "${name}"` },
      ]);
      expect(result.block?.block.attributes['map']?.args).toEqual({ name: 'first' });
      expect(result.factory).toHaveBeenCalledTimes(1);
      expect(result.interpretedSymbols).toHaveLength(1);
      expect(result.interpretedSymbols[0]).toBe(result.block);
    });
  },
);
