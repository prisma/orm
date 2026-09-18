import type {
  AuthoringPslBlockDescriptorNamespace,
  AuthoringTypeConstructorDescriptor,
  AuthoringTypeNamespace,
} from '@internal/framework-components/authoring';
import { describe, expect, it } from 'vitest';
import { createBinder, typeReferenceNode } from '../src/binder';
import { parse } from '../src/parse';
import { PslSources } from '../src/source-file';
import { buildSymbolTable, type FieldSymbol, type SymbolTable } from '../src/symbol-table';
import { universeScope } from '../src/universe-scope';

const ENUM_DESCRIPTORS: AuthoringPslBlockDescriptorNamespace = {
  enum: {
    kind: 'pslBlock',
    keyword: 'enum',
    discriminator: 'enum',
    name: { required: true },
    parameters: {},
    variadicParameters: true,
  },
};

function scalar(nativeType: string): AuthoringTypeConstructorDescriptor {
  return { kind: 'typeConstructor', output: { codecId: 'fixture/scalar@1', nativeType } };
}

const TYPE_CONSTRUCTORS: AuthoringTypeNamespace = {
  String: scalar('text'),
  Int: scalar('integer'),
  Uuid: scalar('uuid'),
  pgvector: { Vector: scalar('vector') },
};

function build(...texts: string[]) {
  const parsed = texts.map((text, index) => parse(text, `${index}.psl`));
  const documents = parsed.map(({ document }) => document);
  const sources = new PslSources(
    parsed.map(
      ({ document, sources }) => [document.syntax, sources.sourceFileFor(document.syntax)] as const,
    ),
  );
  const { symbolTable } = buildSymbolTable({
    documents,
    sources,
    pslBlockDescriptors: ENUM_DESCRIPTORS,
  });
  return { sources, symbolTable };
}

function bind(...texts: string[]) {
  const { sources, symbolTable } = build(...texts);
  return {
    symbolTable,
    ...createBinder({ sources, symbolTable, typeConstructors: TYPE_CONSTRUCTORS }),
  };
}

function fieldOf(symbolTable: SymbolTable, ownerPath: string, fieldName: string): FieldSymbol {
  const [first = '', second] = ownerPath.split('.');
  const scope =
    second === undefined ? symbolTable.topLevel : symbolTable.topLevel.namespaces[first];
  const ownerName = second ?? first;
  const owner = scope?.models[ownerName] ?? scope?.compositeTypes[ownerName];
  const field = owner?.fields[fieldName];
  if (field === undefined) throw new Error(`no field ${ownerPath}.${fieldName}`);
  return field;
}

function typeNodeOf(symbolTable: SymbolTable, ownerPath: string, fieldName: string) {
  const node = typeReferenceNode(fieldOf(symbolTable, ownerPath, fieldName));
  if (node === undefined) throw new Error(`no type node for ${ownerPath}.${fieldName}`);
  return node;
}

describe('createBinder — declarations', () => {
  it('registers model, composite type, and field declaration nodes', () => {
    const { symbolTable, binder } = bind(
      'model User {\n  id Int\n}\ntype Address {\n  street String\n}',
    );
    const user = symbolTable.topLevel.models['User']!;
    const address = symbolTable.topLevel.compositeTypes['Address']!;

    expect(binder.declaredSymbol(user.node.syntax)).toBe(user);
    expect(binder.declaredSymbol(address.node.syntax)).toBe(address);
    expect(binder.declaredSymbol(user.fields['id']!.node.syntax)).toBe(user.fields['id']);
    expect(binder.declaredSymbol(address.fields['street']!.node.syntax)).toBe(
      address.fields['street'],
    );
  });

  it('registers declarations inside namespaces', () => {
    const { symbolTable, binder } = bind('namespace app {\n  model Item {\n    id Int\n  }\n}');
    const item = symbolTable.topLevel.namespaces['app']!.models['Item']!;
    expect(binder.declaredSymbol(item.node.syntax)).toBe(item);
    expect(binder.declaredSymbol(item.fields['id']!.node.syntax)).toBe(item.fields['id']);
  });

  it('returns undefined for a node that declares nothing', () => {
    const { symbolTable, binder } = bind('model User {\n  id Int\n}');
    const user = symbolTable.topLevel.models['User']!;
    expect(binder.declaredSymbol(user.node.syntax.root())).toBeUndefined();
  });

  it('returns stable results for repeated queries', () => {
    const { symbolTable, binder } = bind('model User {\n  id Int\n}');
    const node = symbolTable.topLevel.models['User']!.node.syntax;
    expect(binder.declaredSymbol(node)).toBe(binder.declaredSymbol(node));

    const typeNode = typeNodeOf(symbolTable, 'User', 'id');
    expect(binder.symbolForNode(typeNode)).toBe(binder.symbolForNode(typeNode));
  });
});

describe('createBinder — the scope chain', () => {
  it('prefers the declaring namespace over a top-level declaration of the same name', () => {
    const { symbolTable, binder, diagnostics } = bind(
      [
        'model Account {',
        '  id Int',
        '}',
        'model Outside {',
        '  account Account',
        '}',
        'namespace app {',
        '  model Account {',
        '    id Int',
        '  }',
        '  model Inside {',
        '    account Account',
        '  }',
        '}',
      ].join('\n'),
    );

    expect(diagnostics).toEqual([]);
    expect(binder.symbolForNode(typeNodeOf(symbolTable, 'app.Inside', 'account'))).toEqual({
      kind: 'model',
      symbol: symbolTable.topLevel.namespaces['app']!.models['Account'],
    });
    expect(binder.symbolForNode(typeNodeOf(symbolTable, 'Outside', 'account'))).toEqual({
      kind: 'model',
      symbol: symbolTable.topLevel.models['Account'],
    });
  });

  it('never consults a sibling namespace', () => {
    const { symbolTable, binder, diagnostics } = bind(
      [
        'namespace one {',
        '  model Hidden {',
        '    id Int',
        '  }',
        '}',
        'namespace two {',
        '  model Seeker {',
        '    target Hidden',
        '  }',
        '}',
      ].join('\n'),
    );

    expect(binder.symbolForNode(typeNodeOf(symbolTable, 'two.Seeker', 'target'))).toEqual({
      kind: 'unresolved',
      name: 'Hidden',
    });
    expect(diagnostics.map(({ code }) => code)).toEqual(['PSL_UNRESOLVED_REFERENCE']);
  });

  it('falls back to the universe scope for a scalar name', () => {
    const { symbolTable, binder, diagnostics } = bind('model User {\n  name String\n}');
    const resolution = binder.symbolForNode(typeNodeOf(symbolTable, 'User', 'name'));

    expect(diagnostics).toEqual([]);
    expect(resolution).toMatchObject({
      kind: 'universe',
      symbol: { kind: 'universe', name: 'String', path: ['String'] },
    });
  });

  it('lets a user declaration shadow a universe symbol silently', () => {
    const { symbolTable, binder, diagnostics } = bind(
      'model Uuid {\n  id Int\n}\nmodel User {\n  key Uuid\n}',
    );

    expect(diagnostics).toEqual([]);
    expect(binder.symbolForNode(typeNodeOf(symbolTable, 'User', 'key'))).toEqual({
      kind: 'model',
      symbol: symbolTable.topLevel.models['Uuid'],
    });
  });

  it('resolves composite types, named types, and blocks', () => {
    const { symbolTable, binder, diagnostics } = bind(
      [
        'types { Email = String }',
        'type Address {',
        '  street String',
        '}',
        'enum Role {',
        '  Admin',
        '}',
        'model User {',
        '  address Address',
        '  email Email',
        '  role Role',
        '}',
      ].join('\n'),
    );

    expect(diagnostics).toEqual([]);
    expect(binder.symbolForNode(typeNodeOf(symbolTable, 'User', 'address'))).toEqual({
      kind: 'compositeType',
      symbol: symbolTable.topLevel.compositeTypes['Address'],
    });
    expect(binder.symbolForNode(typeNodeOf(symbolTable, 'User', 'email'))).toEqual({
      kind: 'namedType',
      symbol: symbolTable.topLevel.namedTypes['Email'],
    });
    expect(binder.symbolForNode(typeNodeOf(symbolTable, 'User', 'role'))).toEqual({
      kind: 'block',
      symbol: symbolTable.topLevel.blocks['Role'],
    });
  });
});

describe('createBinder — qualified references', () => {
  it('resolves a namespace-qualified reference', () => {
    const { symbolTable, binder, diagnostics } = bind(
      [
        'namespace app {',
        '  model Item {',
        '    id Int',
        '  }',
        '}',
        'model Cart {',
        '  item app.Item',
        '}',
      ].join('\n'),
    );

    expect(diagnostics).toEqual([]);
    expect(binder.symbolForNode(typeNodeOf(symbolTable, 'Cart', 'item'))).toEqual({
      kind: 'model',
      symbol: symbolTable.topLevel.namespaces['app']!.models['Item'],
    });
  });

  it('resolves a qualified reference into a universe type namespace', () => {
    const { symbolTable, binder, diagnostics } = bind(
      'model Doc {\n  embedding pgvector.Vector\n}',
    );

    expect(diagnostics).toEqual([]);
    expect(binder.symbolForNode(typeNodeOf(symbolTable, 'Doc', 'embedding'))).toMatchObject({
      kind: 'universe',
      symbol: { name: 'Vector', path: ['pgvector', 'Vector'] },
    });
  });

  it('reports an unresolved qualified reference against a known namespace', () => {
    const { symbolTable, binder, diagnostics } = bind(
      [
        'namespace app {',
        '  model Item {',
        '    id Int',
        '  }',
        '}',
        'model Cart {',
        '  item app.Missing',
        '}',
      ].join('\n'),
    );

    expect(binder.symbolForNode(typeNodeOf(symbolTable, 'Cart', 'item'))).toEqual({
      kind: 'unresolved',
      name: 'app.Missing',
    });
    expect(diagnostics.map(({ code }) => code)).toEqual(['PSL_UNRESOLVED_REFERENCE']);
  });
});

describe('createBinder — cross-space and malformed references', () => {
  it('yields a cross-space resolution without a diagnostic', () => {
    const { symbolTable, binder, diagnostics } = bind('model Cart {\n  user auth:User\n}');

    expect(diagnostics).toEqual([]);
    expect(binder.symbolForNode(typeNodeOf(symbolTable, 'Cart', 'user'))).toEqual({
      kind: 'crossSpace',
    });
  });

  it('skips a malformed type silently', () => {
    const { symbolTable, binder, diagnostics } = bind('model Cart {\n  value a.b.c\n}');

    expect(diagnostics).toEqual([]);
    expect(fieldOf(symbolTable, 'Cart', 'value').malformedType).toBe(true);
    expect(binder.symbolForNode(typeNodeOf(symbolTable, 'Cart', 'value'))).toBeUndefined();
  });
});

describe('createBinder — diagnostics', () => {
  it('locates an unresolved reference by filename and range', () => {
    const { diagnostics } = bind('model User {\n  id Int\n}', 'model Cart {\n  pet Dog\n}');

    expect(diagnostics).toEqual([
      {
        code: 'PSL_UNRESOLVED_REFERENCE',
        message: 'Cannot find type "Dog"',
        filename: '1.psl',
        range: { start: { line: 1, character: 6 }, end: { line: 1, character: 9 } },
      },
    ]);
  });

  it('never re-emits duplicate-declaration diagnostics', () => {
    const { diagnostics } = bind('model User {\n  id Int\n}\nmodel User {\n  id Int\n}');
    expect(diagnostics).toEqual([]);
  });

  it('reports every unresolved reference once', () => {
    const { diagnostics } = bind(
      'model Cart {\n  first Dog\n  second Dog\n}\nmodel Basket {\n  third Cat\n}',
    );
    expect(diagnostics.map(({ message, range }) => [message, range.start.line])).toEqual([
      ['Cannot find type "Dog"', 1],
      ['Cannot find type "Dog"', 2],
      ['Cannot find type "Cat"', 5],
    ]);
  });
});

describe('createBinder — multiple documents', () => {
  it('resolves a reference in one document to a declaration in another', () => {
    const { symbolTable, binder, diagnostics } = bind(
      'model Cart {\n  user User\n}',
      'model User {\n  id Int\n}',
    );

    expect(diagnostics).toEqual([]);
    expect(binder.symbolForNode(typeNodeOf(symbolTable, 'Cart', 'user'))).toEqual({
      kind: 'model',
      symbol: symbolTable.topLevel.models['User'],
    });
  });

  it('resolves into a namespace reopened across documents', () => {
    const { symbolTable, binder, diagnostics } = bind(
      'namespace app {\n  model Item {\n    id Int\n  }\n}',
      'namespace app {\n  model Cart {\n    item Item\n  }\n}',
    );

    expect(diagnostics).toEqual([]);
    expect(binder.symbolForNode(typeNodeOf(symbolTable, 'app.Cart', 'item'))).toEqual({
      kind: 'model',
      symbol: symbolTable.topLevel.namespaces['app']!.models['Item'],
    });
  });
});

describe('universe scope', () => {
  it('returns the same scope object for the same registry', () => {
    expect(universeScope(TYPE_CONSTRUCTORS)).toBe(universeScope(TYPE_CONSTRUCTORS));
    expect(universeScope({ ...TYPE_CONSTRUCTORS })).not.toBe(universeScope(TYPE_CONSTRUCTORS));
  });

  it('shares universe symbols across two binders built over different documents', () => {
    const first = bind('model User {\n  name String\n}');
    const second = bind('model Other {\n  title String\n}');

    const firstSymbol = first.binder.symbolForNode(typeNodeOf(first.symbolTable, 'User', 'name'));
    const secondSymbol = second.binder.symbolForNode(
      typeNodeOf(second.symbolTable, 'Other', 'title'),
    );

    expect(firstSymbol?.kind).toBe('universe');
    expect(firstSymbol).not.toBe(secondSymbol);
    if (firstSymbol?.kind === 'universe' && secondSymbol?.kind === 'universe') {
      expect(firstSymbol.symbol).toBe(secondSymbol.symbol);
    }
  });
});
