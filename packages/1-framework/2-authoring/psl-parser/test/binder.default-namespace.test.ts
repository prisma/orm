import type { AuthoringTypeConstructorDescriptor } from '@internal/framework-components/authoring';
import { describe, expect, it } from 'vitest';
import { createBinder, typeReferenceNode } from '../src/binder';
import { parse } from '../src/parse';
import { buildSymbolTable, type NamespaceSymbol } from '../src/symbol-table';
import { QualifiedNameAst } from '../src/syntax/ast/qualified-name';
import { binderContext } from './support';

const scalar: AuthoringTypeConstructorDescriptor = {
  kind: 'typeConstructor',
  output: { codecId: 'fixture/scalar@1' },
};

function bind(defaultNamespaceId: string, source: string) {
  const { document, sources } = parse(source, 'schema.prisma');
  const table = buildSymbolTable({ documents: [document], sources, defaultNamespaceId });
  const bound = createBinder({
    sources,
    symbolTable: table.symbolTable,
    context: binderContext({ contributedTypes: { Int: scalar } }),
  });
  const typeNode = (namespace: NamespaceSymbol, model: string, field: string) => {
    const symbol = namespace.models[model]?.fields[field];
    const node = symbol === undefined ? undefined : typeReferenceNode(symbol);
    if (node === undefined) throw new Error(`no type node for ${model}.${field}`);
    return node;
  };
  return {
    document,
    symbolTable: table.symbolTable,
    binder: bound.binder,
    diagnostics: [...table.diagnostics, ...bound.diagnostics],
    typeNode,
    typeOf: (namespace: NamespaceSymbol, model: string, field: string) =>
      bound.binder.symbolForNode(typeNode(namespace, model, field)),
  };
}

const schema = (block: string | undefined, qualifier: string, authMembers = '') =>
  [
    'model Account {\n  id Int\n}',
    ...(block === undefined ? [] : [`namespace ${block} {\n  model Invoice {\n    id Int\n  }\n}`]),
    `model Ledger {\n  account ${qualifier}Account\n}`,
    'namespace auth {',
    authMembers,
    `  model Session {\n    account ${qualifier}Account`,
    ...(block === undefined ? [] : [`    invoice ${qualifier}Invoice`]),
    '  }\n}',
  ].join('\n');

describe('binding against the default namespace', () => {
  it.each([
    ['public', 'public', ''],
    ['public', 'public', 'public.'],
    ['public', undefined, 'public.'],
    ['__unbound__', 'unbound', 'unbound.'],
    ['__unbound__', '__unbound__', 'unbound.'],
    ['__unbound__', undefined, '__unbound__.'],
  ])(
    'with default %s and block %s, resolves "%sName" to top-level and block-declared members from every scope',
    (id, block, qualifier) => {
      const { symbolTable, binder, diagnostics, typeOf, typeNode } = bind(
        id,
        schema(block, qualifier),
      );
      const { defaultNamespace } = symbolTable;
      const auth = symbolTable.namespaces['auth']!;
      const member = (name: string) => ({
        kind: 'model',
        symbol: defaultNamespace.models[name],
        namespace: defaultNamespace,
      });

      expect(diagnostics).toEqual([]);
      expect(typeOf(defaultNamespace, 'Ledger', 'account')).toEqual(member('Account'));
      expect(typeOf(auth, 'Session', 'account')).toEqual(member('Account'));
      if (block !== undefined)
        expect(typeOf(auth, 'Session', 'invoice')).toEqual(member('Invoice'));
      if (qualifier !== '') {
        const written = QualifiedNameAst.cast(typeNode(auth, 'Session', 'account'))?.namespace();
        expect(binder.symbolForNode(written!.syntax)).toEqual({
          kind: 'namespace',
          symbol: defaultNamespace,
        });
      }
    },
  );

  it('lets a member of the referring namespace shadow a default-namespace member', () => {
    const { symbolTable, diagnostics, typeOf } = bind(
      'public',
      schema(
        'public',
        '',
        '  model Account {\n    id Int\n  }\n  type Invoice {\n    total Int\n  }',
      ),
    );
    const auth = symbolTable.namespaces['auth']!;

    expect(diagnostics).toEqual([]);
    expect(typeOf(auth, 'Session', 'account')).toEqual({
      kind: 'model',
      symbol: auth.models['Account'],
      namespace: auth,
    });
    expect(typeOf(auth, 'Session', 'invoice')).toEqual({
      kind: 'compositeType',
      symbol: auth.compositeTypes['Invoice'],
      namespace: auth,
    });
  });

  it('lists each namespace once under its name and looks it up under every spelling', () => {
    const { symbolTable, binder, document } = bind(
      'public',
      `${schema('public', '')}\nnamespace __unbound__ {\n  model Tenant {\n    id Int\n  }\n}`,
    );
    const { defaultNamespace } = symbolTable;
    const unbound = symbolTable.namespaces['__unbound__']!;
    const scope = binder.scopeAt(document.syntax);

    expect([...scope.entries()].map(([name]) => name).join(' ')).toBe(
      'Account Invoice Ledger public auth unbound Int',
    );
    expect(scope.lookup('public')).toEqual({ kind: 'namespace', symbol: defaultNamespace });
    expect(scope.lookup('unbound')).toEqual({ kind: 'namespace', symbol: unbound });
    expect(scope.lookup('__unbound__')).toEqual({ kind: 'namespace', symbol: unbound });
  });
});
