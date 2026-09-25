import type {
  AuthoringPslBlockDescriptorNamespace,
  AuthoringTypeConstructorDescriptor,
  AuthoringTypeNamespace,
} from '@internal/framework-components/authoring';
import { describe, expect, it } from 'vitest';
import { entityRef } from '../src/attribute-spec/combinators/entity-ref';
import { fieldRef, referencedFieldRef } from '../src/attribute-spec/combinators/field-ref';
import { list } from '../src/attribute-spec/combinators/list';
import { str } from '../src/attribute-spec/combinators/str';
import { fieldAttribute } from '../src/attribute-spec/field-attribute';
import { modelAttribute } from '../src/attribute-spec/model-attribute';
import type {
  AttributeSpecContext,
  FieldAttributeSpecContext,
} from '../src/attribute-spec/spec-context';
import {
  createBinder,
  type DescribeUnsupportedAttribute,
  typeReferenceNode,
  type UnsupportedAttribute,
} from '../src/binder';
import { contributedTypeScope } from '../src/contributed-type-scope';
import { parse } from '../src/parse';
import { PslSources } from '../src/source-file';
import {
  buildSymbolTable,
  type CompositeTypeSymbol,
  type FieldSymbol,
  type ModelSymbol,
  type SymbolTable,
} from '../src/symbol-table';
import { ArrayLiteralAst } from '../src/syntax/ast/expressions';
import type { SyntaxNode } from '../src/syntax/red';

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

const fieldListParam = (key: string) => ({
  key,
  type: list(fieldRef()),
  documentation: 'fixture',
});

const modelSpec = (name: string, positional: ReturnType<typeof fieldListParam>[]) =>
  modelAttribute(name, { documentation: 'fixture', positional });

const MODEL_SPECS = {
  id: () => modelSpec('id', [fieldListParam('fields')]),
  index: () => modelSpec('index', [fieldListParam('fields')]),
  unique: () => modelSpec('unique', [fieldListParam('fields')]),
  base: () =>
    modelAttribute('base', {
      documentation: 'fixture',
      positional: [{ key: 'model', type: entityRef({ kind: 'model' }), documentation: 'fixture' }],
    }),
  map: () =>
    modelAttribute('map', {
      documentation: 'fixture',
      positional: [{ key: 'name', type: str(), documentation: 'fixture' }],
    }),
};

const FIELD_SPECS = {
  id: () => fieldAttribute('id', { documentation: 'fixture' }),
  contextual: () => fieldAttribute('contextual', { documentation: 'fixture' }),
  relation: () =>
    fieldAttribute('relation', {
      documentation: 'fixture',
      named: {
        fields: { type: list(fieldRef()), documentation: 'fixture' },
        references: { type: list(referencedFieldRef()), documentation: 'fixture' },
        name: { type: str(), documentation: 'fixture' },
      },
    }),
};

const ATTRIBUTE_SPECS = { model: MODEL_SPECS, field: FIELD_SPECS };

const NO_CONTROL_DEFAULTS = {
  defaultFunctionRegistry: new Map(),
  dataTypeEntries: {},
};

function attributeNodes(
  owner: ModelSymbol | CompositeTypeSymbol | FieldSymbol,
  attributeName: string,
  argName?: string,
): readonly SyntaxNode[] {
  for (const attribute of owner.node.attributes()) {
    if (attribute.name()?.path().join('.') !== attributeName) continue;
    for (const arg of attribute.argList()?.args() ?? []) {
      if (arg.name()?.name() !== argName) continue;
      const value = arg.value();
      if (value === undefined) return [];
      const array = ArrayLiteralAst.cast(value.syntax);
      if (array === undefined) return [value.syntax];
      return Array.from(array.elements(), (element) => element.syntax);
    }
  }
  return [];
}

function attributeNameNode(
  owner: ModelSymbol | CompositeTypeSymbol | FieldSymbol,
  attributeName: string,
): SyntaxNode {
  for (const attribute of owner.node.attributes()) {
    const name = attribute.name();
    if (name?.path().join('.') === attributeName) return name.syntax;
  }
  throw new Error(`no @${attributeName}`);
}

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
    ...createBinder({
      sources,
      symbolTable,
      typeConstructors: TYPE_CONSTRUCTORS,
      attributeSpecs: ATTRIBUTE_SPECS,
      controlMutationDefaults: NO_CONTROL_DEFAULTS,
    }),
  };
}

function bindWithUnsupportedDescriber(
  describeUnsupportedAttribute: DescribeUnsupportedAttribute,
  ...texts: string[]
) {
  const { sources, symbolTable } = build(...texts);
  return {
    symbolTable,
    ...createBinder({
      sources,
      symbolTable,
      typeConstructors: TYPE_CONSTRUCTORS,
      attributeSpecs: ATTRIBUTE_SPECS,
      controlMutationDefaults: NO_CONTROL_DEFAULTS,
      describeUnsupportedAttribute,
    }),
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
      namespace: symbolTable.topLevel.namespaces['app'],
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

  it('falls back to the contributedTypes scope for a scalar name', () => {
    const { symbolTable, binder, diagnostics } = bind('model User {\n  name String\n}');
    const resolution = binder.symbolForNode(typeNodeOf(symbolTable, 'User', 'name'));

    expect(diagnostics).toEqual([]);
    expect(resolution).toMatchObject({
      kind: 'contributedType',
      symbol: { kind: 'contributedType', name: 'String', path: ['String'] },
    });
  });

  it('lets a user declaration shadow a contributedTypes symbol silently', () => {
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
      namespace: symbolTable.topLevel.namespaces['app'],
    });
  });

  it('resolves a qualified reference into a contributedTypes type namespace', () => {
    const { symbolTable, binder, diagnostics } = bind(
      'model Doc {\n  embedding pgvector.Vector\n}',
    );

    expect(diagnostics).toEqual([]);
    expect(binder.symbolForNode(typeNodeOf(symbolTable, 'Doc', 'embedding'))).toMatchObject({
      kind: 'contributedType',
      symbol: { name: 'Vector', path: ['pgvector', 'Vector'] },
    });
  });

  it('reports a qualifier that is not a namespace as what it is', () => {
    const { symbolTable, binder, diagnostics } = bind(
      'model app {\n  id Int\n}\nmodel Cart {\n  slot app.Thing\n}',
    );

    expect(binder.symbolForNode(typeNodeOf(symbolTable, 'Cart', 'slot'))).toEqual({
      kind: 'unresolved',
      name: 'app',
    });
    expect(diagnostics.map(({ code, message }) => [code, message])).toEqual([
      ['PSL_UNRESOLVED_REFERENCE', '"app" is a model, not a namespace'],
    ]);
  });

  it('reports an enum qualifier as an enum, not a namespace', () => {
    const { diagnostics } = bind('enum Role {\n  Admin\n}\nmodel Cart {\n  slot Role.Admin\n}');

    expect(diagnostics.map(({ message }) => message)).toEqual([
      '"Role" is an enum, not a namespace',
    ]);
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
        data: { reference: 'type', name: 'Dog' },
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
      namespace: symbolTable.topLevel.namespaces['app'],
    });
  });
});

describe('contributedTypes scope', () => {
  it('returns the same scope object for the same registry', () => {
    expect(contributedTypeScope(TYPE_CONSTRUCTORS)).toBe(contributedTypeScope(TYPE_CONSTRUCTORS));
    expect(contributedTypeScope({ ...TYPE_CONSTRUCTORS })).not.toBe(
      contributedTypeScope(TYPE_CONSTRUCTORS),
    );
  });

  it('shares contributedTypes symbols across two binders built over different documents', () => {
    const first = bind('model User {\n  name String\n}');
    const second = bind('model Other {\n  title String\n}');

    const firstSymbol = first.binder.symbolForNode(typeNodeOf(first.symbolTable, 'User', 'name'));
    const secondSymbol = second.binder.symbolForNode(
      typeNodeOf(second.symbolTable, 'Other', 'title'),
    );

    expect(firstSymbol?.kind).toBe('contributedType');
    expect(firstSymbol).not.toBe(secondSymbol);
    if (firstSymbol?.kind === 'contributedType' && secondSymbol?.kind === 'contributedType') {
      expect(firstSymbol.symbol).toBe(secondSymbol.symbol);
    }
  });
});

const RELATION_SCHEMA = [
  'model User {',
  '  id Int @id',
  '  email String',
  '}',
  'model Post {',
  '  id Int @id',
  '  authorId Int',
  '  author User @relation(fields: [authorId], references: [id])',
  '}',
].join('\n');

describe('createBinder — attribute names', () => {
  it('resolves an attribute name to an attribute symbol', () => {
    const { symbolTable, binder, diagnostics } = bind(RELATION_SCHEMA);
    const post = symbolTable.topLevel.models['Post']!;

    expect(diagnostics).toEqual([]);
    expect(
      binder.symbolForNode(attributeNameNode(post.fields['author']!, 'relation')),
    ).toMatchObject({
      kind: 'attribute',
      symbol: { kind: 'attribute', name: 'relation', level: 'field' },
    });
    expect(binder.symbolForNode(attributeNameNode(post.fields['id']!, 'id'))).toMatchObject({
      kind: 'attribute',
      symbol: { kind: 'attribute', name: 'id', level: 'field' },
    });
  });

  it('reaches the spec through the attribute symbol', () => {
    const { symbolTable, binder } = bind(RELATION_SCHEMA);
    const post = symbolTable.topLevel.models['Post']!;
    const resolution = binder.symbolForNode(attributeNameNode(post.fields['author']!, 'relation'));

    expect(resolution?.kind).toBe('attribute');
    if (resolution?.kind === 'attribute') {
      expect(Object.keys(resolution.symbol.spec.named)).toEqual(['fields', 'references', 'name']);
    }
  });

  it('leaves an attribute name outside the namespace to its target', () => {
    const { symbolTable, binder, diagnostics } = bind('model User {\n  id Int @bogus\n  @@nope\n}');
    const user = symbolTable.topLevel.models['User']!;

    expect(binder.symbolForNode(attributeNameNode(user.fields['id']!, 'bogus'))).toBeUndefined();
    expect(binder.symbolForNode(attributeNameNode(user, 'nope'))).toBeUndefined();
    expect(diagnostics).toEqual([]);
  });

  it('records nothing for a non-reference argument', () => {
    const { symbolTable, binder, diagnostics } = bind(
      'model User {\n  id Int\n  @@map("users")\n}',
    );
    const user = symbolTable.topLevel.models['User']!;
    const [nameNode] = attributeNodes(user, 'map');

    expect(diagnostics).toEqual([]);
    expect(nameNode).toBeDefined();
    expect(nameNode === undefined ? undefined : binder.symbolForNode(nameNode)).toBeUndefined();
  });
});

describe('createBinder — describeUnsupportedAttribute', () => {
  const UNSUPPORTED_SCHEMA = [
    'model User {',
    '  id Int @id @bogus',
    '  @@map("users")',
    '  @@nope',
    '}',
    'type Address {',
    '  street String @sensitivity("high")',
    '}',
  ].join('\n');

  function record(): {
    readonly seen: UnsupportedAttribute[];
    readonly describe: DescribeUnsupportedAttribute;
  } {
    const seen: UnsupportedAttribute[] = [];
    return {
      seen,
      describe: (unsupported) => {
        seen.push(unsupported);
        return undefined;
      },
    };
  }

  it('calls back for names outside the namespace and stays silent for registered ones', () => {
    const { seen, describe } = record();
    bindWithUnsupportedDescriber(describe, UNSUPPORTED_SCHEMA);

    expect(
      seen.map(({ attribute, level, owner, field }) => ({
        name: attribute.name,
        level,
        owner: owner.name,
        field: field?.name,
      })),
    ).toEqual([
      { name: 'nope', level: 'model', owner: 'User', field: undefined },
      { name: 'bogus', level: 'field', owner: 'User', field: 'id' },
      { name: 'sensitivity', level: 'field', owner: 'Address', field: 'street' },
    ]);
  });

  it('collects a returned diagnostic into the binder diagnostics', () => {
    const { diagnostics } = bindWithUnsupportedDescriber(
      ({ attribute, level, owner, field }) => ({
        filename: '0.psl',
        code: 'FIXTURE_UNSUPPORTED_ATTRIBUTE',
        message: `${level}:${owner.name}${field === undefined ? '' : `.${field.name}`}:${attribute.name}`,
        range: { start: { line: 1, character: 1 }, end: { line: 1, character: 1 } },
      }),
      UNSUPPORTED_SCHEMA,
    );

    expect(diagnostics.map(({ code, message }) => ({ code, message }))).toEqual([
      { code: 'FIXTURE_UNSUPPORTED_ATTRIBUTE', message: 'model:User:nope' },
      { code: 'FIXTURE_UNSUPPORTED_ATTRIBUTE', message: 'field:User.id:bogus' },
      { code: 'FIXTURE_UNSUPPORTED_ATTRIBUTE', message: 'field:Address.street:sensitivity' },
    ]);
  });

  it('stays silent when the callback returns undefined', () => {
    const { diagnostics } = bindWithUnsupportedDescriber(() => undefined, UNSUPPORTED_SCHEMA);
    expect(diagnostics).toEqual([]);
  });

  it('stays silent when no callback is supplied', () => {
    const { diagnostics } = bind(UNSUPPORTED_SCHEMA);
    expect(diagnostics).toEqual([]);
  });

  it('resolves an attribute the callback described to no symbol', () => {
    const { symbolTable, binder } = bindWithUnsupportedDescriber(
      () => ({
        filename: '0.psl',
        code: 'FIXTURE_UNSUPPORTED_ATTRIBUTE',
        message: 'unsupported',
        range: { start: { line: 1, character: 1 }, end: { line: 1, character: 1 } },
      }),
      UNSUPPORTED_SCHEMA,
    );
    const user = symbolTable.topLevel.models['User']!;

    expect(binder.symbolForNode(attributeNameNode(user.fields['id']!, 'bogus'))).toBeUndefined();
    expect(binder.symbolForNode(attributeNameNode(user, 'nope'))).toBeUndefined();
  });
});

describe('createBinder — fieldRef arguments', () => {
  it('resolves @relation(fields:) against the declaring owner', () => {
    const { symbolTable, binder, diagnostics } = bind(RELATION_SCHEMA);
    const post = symbolTable.topLevel.models['Post']!;
    const [node] = attributeNodes(post.fields['author']!, 'relation', 'fields');

    expect(diagnostics).toEqual([]);
    expect(node === undefined ? undefined : binder.symbolForNode(node)).toEqual({
      kind: 'field',
      symbol: post.fields['authorId'],
    });
  });

  it('resolves @@id, @@unique, and @@index lists and reports one unknown name', () => {
    const { symbolTable, binder, diagnostics } = bind(
      [
        'model User {',
        '  id Int',
        '  name String',
        '  @@id([id])',
        '  @@unique([name])',
        '  @@index([name, missing])',
        '}',
      ].join('\n'),
    );
    const user = symbolTable.topLevel.models['User']!;
    const resolved = (attribute: string, index: number) => {
      const node = attributeNodes(user, attribute)[index];
      return node === undefined ? undefined : binder.symbolForNode(node);
    };

    expect(resolved('id', 0)).toEqual({ kind: 'field', symbol: user.fields['id'] });
    expect(resolved('unique', 0)).toEqual({ kind: 'field', symbol: user.fields['name'] });
    expect(resolved('index', 0)).toEqual({ kind: 'field', symbol: user.fields['name'] });
    expect(resolved('index', 1)).toEqual({ kind: 'unresolved', name: 'missing' });
    expect(diagnostics.map(({ code, message }) => [code, message])).toEqual([
      ['PSL_UNRESOLVED_REFERENCE', 'Cannot find field "missing" on "User"'],
    ]);
  });
});

describe('createBinder — referencedFieldRef arguments', () => {
  it('resolves @relation(references:) against the phase-1 type target', () => {
    const { symbolTable, binder, diagnostics } = bind(RELATION_SCHEMA);
    const post = symbolTable.topLevel.models['Post']!;
    const user = symbolTable.topLevel.models['User']!;
    const [node] = attributeNodes(post.fields['author']!, 'relation', 'references');

    expect(diagnostics).toEqual([]);
    expect(node === undefined ? undefined : binder.symbolForNode(node)).toEqual({
      kind: 'field',
      symbol: user.fields['id'],
    });
  });

  it('yields cross-space without a diagnostic when the field type is cross-space', () => {
    const { symbolTable, binder, diagnostics } = bind(
      [
        'model Cart {',
        '  id Int',
        '  userId Int',
        '  user auth:User @relation(fields: [userId], references: [id])',
        '}',
      ].join('\n'),
    );
    const cart = symbolTable.topLevel.models['Cart']!;
    const [referenced] = attributeNodes(cart.fields['user']!, 'relation', 'references');
    const [local] = attributeNodes(cart.fields['user']!, 'relation', 'fields');

    expect(diagnostics).toEqual([]);
    expect(referenced === undefined ? undefined : binder.symbolForNode(referenced)).toEqual({
      kind: 'crossSpace',
    });
    expect(local === undefined ? undefined : binder.symbolForNode(local)).toEqual({
      kind: 'field',
      symbol: cart.fields['userId'],
    });
  });

  it('reports a referenced field when the declaring field type is unresolved', () => {
    const { symbolTable, binder, diagnostics } = bind(
      [
        'model Cart {',
        '  id Int',
        '  ownerId Int',
        '  owner Ghost @relation(fields: [ownerId], references: [id])',
        '}',
      ].join('\n'),
    );
    const cart = symbolTable.topLevel.models['Cart']!;
    const [referenced] = attributeNodes(cart.fields['owner']!, 'relation', 'references');

    expect(referenced === undefined ? undefined : binder.symbolForNode(referenced)).toEqual({
      kind: 'unresolved',
      name: 'id',
    });
    expect(diagnostics.map(({ code, message }) => [code, message])).toEqual([
      ['PSL_UNRESOLVED_REFERENCE', 'Cannot find type "Ghost"'],
      ['PSL_UNRESOLVED_REFERENCE', 'Cannot find field "id" on the type of "Cart.owner"'],
    ]);
  });

  it('reports a referenced field missing on a resolved target', () => {
    const { diagnostics } = bind(
      [
        'model User {',
        '  id Int',
        '}',
        'model Cart {',
        '  userId Int',
        '  user User @relation(fields: [userId], references: [absent])',
        '}',
      ].join('\n'),
    );

    expect(diagnostics.map(({ message }) => message)).toEqual([
      'Cannot find field "absent" on the type of "Cart.user"',
    ]);
  });
});

describe('createBinder — entityRef arguments', () => {
  it('resolves @@base to a model through the scope chain', () => {
    const { symbolTable, binder, diagnostics } = bind(
      [
        'model Base {',
        '  id Int',
        '}',
        'namespace app {',
        '  model Base {',
        '    id Int',
        '  }',
        '  model Child {',
        '    id Int',
        '    @@base(Base)',
        '  }',
        '}',
      ].join('\n'),
    );
    const child = symbolTable.topLevel.namespaces['app']!.models['Child']!;
    const [node] = attributeNodes(child, 'base');

    expect(diagnostics).toEqual([]);
    expect(node === undefined ? undefined : binder.symbolForNode(node)).toEqual({
      kind: 'model',
      symbol: symbolTable.topLevel.namespaces['app']!.models['Base'],
      namespace: symbolTable.topLevel.namespaces['app'],
    });
  });

  it('reports a missing entity and refuses a contributedTypes symbol as an entity', () => {
    const { symbolTable, binder, diagnostics } = bind(
      [
        'model Orphan {',
        '  id Int',
        '  @@base(Ghost)',
        '}',
        'model Scalarish {',
        '  id Int',
        '  @@base(String)',
        '}',
        'enum Role {',
        '  Admin',
        '}',
        'model Enumish {',
        '  id Int',
        '  @@base(Role)',
        '}',
      ].join('\n'),
    );
    const resolvedBase = (model: string) => {
      const owner = symbolTable.topLevel.models[model]!;
      const node = attributeNodes(owner, 'base')[0];
      return node === undefined ? undefined : binder.symbolForNode(node);
    };

    expect(resolvedBase('Orphan')).toEqual({ kind: 'unresolved', name: 'Ghost' });
    expect(resolvedBase('Scalarish')).toMatchObject({ kind: 'contributedType' });
    expect(resolvedBase('Enumish')).toEqual({
      kind: 'block',
      symbol: symbolTable.topLevel.blocks['Role'],
    });
    expect(diagnostics.map(({ message }) => message)).toEqual(['Cannot find entity "Ghost"']);
  });
});

describe('createBinder — the scope stack the walk pushes and pops', () => {
  const TWO_NAMESPACES = [
    'model Shared {',
    '  id Int',
    '}',
    'namespace first {',
    '  model Local {',
    '    id Int',
    '  }',
    '  model UsesLocal {',
    '    slot Local',
    '  }',
    '  model UsesShared {',
    '    slot Shared',
    '  }',
    '}',
    'namespace second {',
    '  model UsesLeak {',
    '    slot Local',
    '  }',
    '}',
  ].join('\n');

  it('pops one namespace before entering the next, so no name leaks sideways', () => {
    const { symbolTable, binder, diagnostics } = bind(TWO_NAMESPACES);
    const first = symbolTable.topLevel.namespaces['first']!;

    expect(binder.symbolForNode(typeNodeOf(symbolTable, 'first.UsesLocal', 'slot'))).toEqual({
      kind: 'model',
      symbol: first.models['Local'],
      namespace: first,
    });
    expect(binder.symbolForNode(typeNodeOf(symbolTable, 'second.UsesLeak', 'slot'))).toEqual({
      kind: 'unresolved',
      name: 'Local',
    });
    expect(diagnostics.map(({ message }) => message)).toEqual(['Cannot find type "Local"']);
  });

  it('keeps the document scope beneath every pushed namespace', () => {
    const { symbolTable, binder } = bind(TWO_NAMESPACES);

    expect(binder.symbolForNode(typeNodeOf(symbolTable, 'first.UsesShared', 'slot'))).toEqual({
      kind: 'model',
      symbol: symbolTable.topLevel.models['Shared'],
    });
  });
});

describe('createBinder — one kind-blind scope chain', () => {
  const SHADOWING_SCHEMA = [
    'model Foo {',
    '  id Int',
    '}',
    'namespace app {',
    '  enum Foo {',
    '    A',
    '  }',
    '  model Bar {',
    '    id Int',
    '    kind Foo',
    '    @@base(Foo)',
    '  }',
    '}',
  ].join('\n');

  it('lets a namespaced enum shadow a top-level model for an entity reference', () => {
    const { symbolTable, binder, diagnostics } = bind(SHADOWING_SCHEMA);
    const app = symbolTable.topLevel.namespaces['app']!;
    const node = attributeNodes(app.models['Bar']!, 'base')[0]!;

    expect(binder.symbolForNode(node)).toEqual({
      kind: 'block',
      symbol: app.blocks['Foo'],
      namespace: app,
    });
    expect(diagnostics).toEqual([]);
  });

  it('resolves a type reference through the same shadowing chain', () => {
    const { symbolTable, binder } = bind(SHADOWING_SCHEMA);
    const app = symbolTable.topLevel.namespaces['app']!;

    expect(binder.symbolForNode(typeNodeOf(symbolTable, 'app.Bar', 'kind'))).toEqual({
      kind: 'block',
      symbol: app.blocks['Foo'],
      namespace: app,
    });
  });

  it('reports a namespace named in type and entity position as a namespace', () => {
    const { symbolTable, binder, diagnostics } = bind(
      [
        'namespace app {',
        '  model Item {',
        '    id Int',
        '  }',
        '}',
        'model Cart {',
        '  id Int',
        '  slot app',
        '  @@base(app)',
        '}',
      ].join('\n'),
    );
    const cart = symbolTable.topLevel.models['Cart']!;
    const app = symbolTable.topLevel.namespaces['app']!;

    expect(binder.symbolForNode(typeNodeOf(symbolTable, 'Cart', 'slot'))).toEqual({
      kind: 'namespace',
      symbol: app,
    });
    expect(binder.symbolForNode(attributeNodes(cart, 'base')[0]!)).toEqual({
      kind: 'namespace',
      symbol: app,
    });
    expect(diagnostics.map(({ message }) => message)).toEqual([
      '"app" is a namespace; a type reference must name a model, composite type, enum, or named type',
    ]);
  });

  it('still reports a name no scope in the chain declares as not found', () => {
    const { diagnostics } = bind(
      ['namespace app {', '  model Bar {', '    id Int', '    @@base(Ghost)', '  }', '}'].join(
        '\n',
      ),
    );

    expect(diagnostics.map(({ message }) => message)).toEqual(['Cannot find entity "Ghost"']);
  });
});

describe('createBinder — diagnostics completeness', () => {
  it('reports every phase-1 and phase-2 failure exactly once', () => {
    const { diagnostics } = bind(
      [
        'model User {',
        '  id Int',
        '}',
        'model Post {',
        '  id Int',
        '  authorId Int',
        '  ghost Phantom',
        '  author User @relation(fields: [missingLocal], references: [absent])',
        '  @@index([id, alsoMissing])',
        '  @@base(NoSuchModel)',
        '}',
      ].join('\n'),
    );

    expect(
      diagnostics.map(({ code, message, filename, range }) => [
        code,
        message,
        filename,
        range.start.line,
      ]),
    ).toEqual([
      ['PSL_UNRESOLVED_REFERENCE', 'Cannot find type "Phantom"', '0.psl', 6],
      ['PSL_UNRESOLVED_REFERENCE', 'Cannot find field "alsoMissing" on "Post"', '0.psl', 8],
      ['PSL_UNRESOLVED_REFERENCE', 'Cannot find entity "NoSuchModel"', '0.psl', 9],
      ['PSL_UNRESOLVED_REFERENCE', 'Cannot find field "missingLocal" on "Post"', '0.psl', 7],
      [
        'PSL_UNRESOLVED_REFERENCE',
        'Cannot find field "absent" on the type of "Post.author"',
        '0.psl',
        7,
      ],
    ]);
  });

  it('leaves phase-1 type resolution unchanged when attributes are present', () => {
    const { symbolTable, binder, diagnostics } = bind(RELATION_SCHEMA);

    expect(diagnostics).toEqual([]);
    expect(binder.symbolForNode(typeNodeOf(symbolTable, 'Post', 'author'))).toEqual({
      kind: 'model',
      symbol: symbolTable.topLevel.models['User'],
    });
    expect(binder.symbolForNode(typeNodeOf(symbolTable, 'User', 'email'))).toMatchObject({
      kind: 'contributedType',
    });
  });
});

describe('attribute-spec registry shape', () => {
  it('accepts a spec assembled from the combinators in this package', () => {
    const assembled = modelAttribute('index', {
      documentation: 'fixture',
      positional: [{ key: 'fields', type: list(fieldRef()), documentation: 'fixture' }],
    });
    const base = modelAttribute('base', {
      documentation: 'fixture',
      positional: [{ key: 'model', type: entityRef({ kind: 'model' }), documentation: 'fixture' }],
    });
    const relation = fieldAttribute('relation', {
      documentation: 'fixture',
      named: {
        fields: { type: list(fieldRef()), documentation: 'fixture' },
        references: { type: list(referencedFieldRef()), documentation: 'fixture' },
      },
    });
    const registry = {
      model: { index: () => assembled, base: () => base },
      field: { relation: () => relation },
    };

    const { sources, symbolTable } = build(
      [
        'model User {',
        '  id Int',
        '  @@index([id, missing])',
        '}',
        'model Post {',
        '  userId Int',
        '  user User @relation(fields: [userId], references: [id])',
        '}',
      ].join('\n'),
    );
    const { binder, diagnostics } = createBinder({
      sources,
      symbolTable,
      typeConstructors: TYPE_CONSTRUCTORS,
      attributeSpecs: registry,
      controlMutationDefaults: NO_CONTROL_DEFAULTS,
    });
    const user = symbolTable.topLevel.models['User']!;
    const post = symbolTable.topLevel.models['Post']!;
    const resolve = (node: SyntaxNode | undefined) =>
      node === undefined ? undefined : binder.symbolForNode(node);

    expect(resolve(attributeNodes(user, 'index')[0])).toEqual({
      kind: 'field',
      symbol: user.fields['id'],
    });
    expect(resolve(attributeNodes(post.fields['user']!, 'relation', 'fields')[0])).toEqual({
      kind: 'field',
      symbol: post.fields['userId'],
    });
    expect(resolve(attributeNodes(post.fields['user']!, 'relation', 'references')[0])).toEqual({
      kind: 'field',
      symbol: user.fields['id'],
    });
    expect(diagnostics.map(({ message }) => message)).toEqual([
      'Cannot find field "missing" on "User"',
    ]);
  });
});

describe('referencedFieldRef on a cross-space list', () => {
  it('marks every element of the list cross-space', () => {
    const { symbolTable, binder, diagnostics } = bind(
      [
        'model Cart {',
        '  aId Int',
        '  bId Int',
        '  user auth:User @relation(fields: [aId, bId], references: [a, b])',
        '}',
      ].join('\n'),
    );
    const cart = symbolTable.topLevel.models['Cart']!;
    const nodes = attributeNodes(cart.fields['user']!, 'relation', 'references');

    expect(diagnostics).toEqual([]);
    expect(nodes).toHaveLength(2);
    for (const node of nodes) {
      expect(binder.symbolForNode(node)).toEqual({ kind: 'crossSpace' });
    }
  });
});

describe('createBinder — prototype-named declarations', () => {
  const PROTOTYPE_SCHEMA = [
    'model constructor {',
    '  id Int @id',
    '  toString String',
    '}',
    'model Cart {',
    '  ownerId Int',
    '  owner constructor @relation(fields: [ownerId], references: [id])',
    '  @@index([ownerId])',
    '}',
    'namespace valueOf {',
    '  model toString {',
    '    id Int @id',
    '  }',
    '  model Basket {',
    '    id Int @id',
    '    @@base(toString)',
    '  }',
    '}',
  ].join('\n');

  it('resolves a prototype-named type, entity, and field reference', () => {
    const { symbolTable, binder, diagnostics } = bind(PROTOTYPE_SCHEMA);
    const cart = symbolTable.topLevel.models['Cart']!;
    const prototypeNamed = symbolTable.topLevel.models['constructor']!;
    const namespaced = symbolTable.topLevel.namespaces['valueOf']!;

    expect(diagnostics).toEqual([]);
    expect(binder.symbolForNode(typeNodeOf(symbolTable, 'Cart', 'owner'))).toEqual({
      kind: 'model',
      symbol: prototypeNamed,
    });
    expect(
      binder.symbolForNode(attributeNodes(cart.fields['owner']!, 'relation', 'references')[0]!),
    ).toEqual({ kind: 'field', symbol: prototypeNamed.fields['id'] });
    expect(binder.symbolForNode(attributeNodes(namespaced.models['Basket']!, 'base')[0]!)).toEqual({
      kind: 'model',
      symbol: namespaced.models['toString'],
      namespace: namespaced,
    });
  });

  it('leaves an undeclared prototype-named reference unresolved', () => {
    const { symbolTable, binder, diagnostics } = bind(
      [
        'model Cart {',
        '  id Int @id',
        '  slot valueOf',
        '  @@index([hasOwnProperty])',
        '  @@base(propertyIsEnumerable)',
        '}',
      ].join('\n'),
    );
    const cart = symbolTable.topLevel.models['Cart']!;

    expect(binder.symbolForNode(typeNodeOf(symbolTable, 'Cart', 'slot'))).toEqual({
      kind: 'unresolved',
      name: 'valueOf',
    });
    expect(binder.symbolForNode(attributeNodes(cart, 'index')[0]!)).toEqual({
      kind: 'unresolved',
      name: 'hasOwnProperty',
    });
    expect(binder.symbolForNode(attributeNodes(cart, 'base')[0]!)).toEqual({
      kind: 'unresolved',
      name: 'propertyIsEnumerable',
    });
    expect(diagnostics.map(({ message }) => message)).toEqual([
      'Cannot find type "valueOf"',
      'Cannot find field "hasOwnProperty" on "Cart"',
      'Cannot find entity "propertyIsEnumerable"',
    ]);
  });
});

describe('createBinder — reference slots the binder stays silent about', () => {
  it('records nothing for a non-identifier in a reference slot', () => {
    const { symbolTable, binder, diagnostics } = bind(
      ['model User {', '  id Int', '  @@index(["id", 7])', '  @@base("Base")', '}'].join('\n'),
    );
    const user = symbolTable.topLevel.models['User']!;
    const indexNodes = attributeNodes(user, 'index');
    const baseNodes = attributeNodes(user, 'base');

    expect(indexNodes).toHaveLength(2);
    expect(baseNodes).toHaveLength(1);
    for (const node of [...indexNodes, ...baseNodes]) {
      expect(binder.symbolForNode(node)).toBeUndefined();
    }
    expect(diagnostics).toEqual([]);
  });
});

describe('the binder calls the real spec factories', () => {
  it('builds each factory its construction context', () => {
    const seen: string[] = [];
    const { sources, symbolTable } = build(
      ['model User {', '  id Int', '  name String @contextual', '  @@index([id])', '}'].join('\n'),
    );
    const registry = {
      model: {
        index: (ctx: AttributeSpecContext) => {
          seen.push(`model:index:${ctx.model.name}`);
          return modelSpec('index', [fieldListParam('fields')]);
        },
      },
      field: {
        contextual: (ctx: FieldAttributeSpecContext) => {
          seen.push(`field:contextual:${ctx.model.name}.${ctx.field.name}`);
          return fieldAttribute('contextual', { documentation: 'fixture' });
        },
      },
    };
    const { binder, diagnostics } = createBinder({
      sources,
      symbolTable,
      typeConstructors: TYPE_CONSTRUCTORS,
      attributeSpecs: registry,
      controlMutationDefaults: NO_CONTROL_DEFAULTS,
    });
    const user = symbolTable.topLevel.models['User']!;

    expect(seen).toContain('model:index:User');
    expect(seen).toContain('field:contextual:User.name');
    expect(diagnostics).toEqual([]);
    expect(
      binder.symbolForNode(attributeNameNode(user.fields['name']!, 'contextual')),
    ).toMatchObject({
      kind: 'attribute',
      symbol: { kind: 'attribute', name: 'contextual', level: 'field' },
    });
    expect(binder.symbolForNode(attributeNodes(user, 'index')[0]!)).toEqual({
      kind: 'field',
      symbol: user.fields['id'],
    });
  });
});

describe('binder diagnostics carry their reference class', () => {
  it('tags type, field and entity failures distinctly', () => {
    const { diagnostics } = bind(
      [
        'model Post {',
        '  ghost Phantom',
        '  id Int',
        '  @@index([missingField])',
        '  @@base(NoSuchModel)',
        '}',
      ].join('\n'),
    );

    expect(diagnostics.map(({ code, data }) => [code, data?.['reference']])).toEqual([
      ['PSL_UNRESOLVED_REFERENCE', 'type'],
      ['PSL_UNRESOLVED_REFERENCE', 'field'],
      ['PSL_UNRESOLVED_REFERENCE', 'entity'],
    ]);
  });
});

describe('the references table records what it examined', () => {
  it('records an unresolved entry for a type it could not resolve', () => {
    const { symbolTable, binder } = bind('model Cart {\n  owner Ghost\n}');

    expect(binder.symbolForNode(typeNodeOf(symbolTable, 'Cart', 'owner'))).toEqual({
      kind: 'unresolved',
      name: 'Ghost',
    });
  });

  it('records an unresolved entry for an attribute argument it could not resolve', () => {
    const { symbolTable, binder } = bind('model User {\n  id Int\n  @@index([missing])\n}');
    const user = symbolTable.topLevel.models['User']!;
    const [node] = attributeNodes(user, 'index');

    expect(node).toBeDefined();
    expect(node === undefined ? undefined : binder.symbolForNode(node)).toEqual({
      kind: 'unresolved',
      name: 'missing',
    });
  });

  it('leaves a malformed type unexamined', () => {
    const { symbolTable, binder } = bind('model Cart {\n  value a.b.c\n}');

    expect(fieldOf(symbolTable, 'Cart', 'value').malformedType).toBe(true);
    expect(binder.symbolForNode(typeNodeOf(symbolTable, 'Cart', 'value'))).toBeUndefined();
  });
});
