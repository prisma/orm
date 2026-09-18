import type {
  AuthoringPslBlockDescriptorNamespace,
  AuthoringTypeNamespace,
} from '@internal/framework-components/authoring';
import { describe, expect, it } from 'vitest';
import { fieldRef, referencedFieldRef } from '../src/attribute-spec/combinators/field-ref';
import { list } from '../src/attribute-spec/combinators/list';
import { str } from '../src/attribute-spec/combinators/str';
import { fieldAttribute } from '../src/attribute-spec/field-attribute';
import { optional } from '../src/attribute-spec/optional';
import type { AttributeSpecRegistry } from '../src/binder';
import { createBinder } from '../src/binder';
import {
  fieldAttributeContext,
  modelAttributeContext,
  referencedModel,
} from '../src/binder-context';
import { parse } from '../src/parse';
import { PslSources } from '../src/source-file';
import { buildSymbolTable, type ModelSymbol } from '../src/symbol-table';
import { ArrayLiteralAst } from '../src/syntax/ast/expressions';

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

const TYPE_CONSTRUCTORS: AuthoringTypeNamespace = {
  Int: { kind: 'typeConstructor', output: { codecId: 'fixture/scalar@1', nativeType: 'integer' } },
  String: { kind: 'typeConstructor', output: { codecId: 'fixture/scalar@1', nativeType: 'text' } },
};

const relationSpec = fieldAttribute('relation', {
  documentation: 'fixture',
  positional: [{ key: 'name', type: optional(str()), documentation: 'fixture' }],
  named: {
    fields: {
      type: optional(list(fieldRef(), { allowEmpty: false, unique: true })),
      documentation: 'fixture',
    },
    references: {
      type: optional(list(referencedFieldRef(), { allowEmpty: false, unique: true })),
      documentation: 'fixture',
    },
  },
});

const ATTRIBUTE_SPECS: AttributeSpecRegistry = {
  model: () => undefined,
  field: (name) => (name === 'relation' ? relationSpec : undefined),
};

function bind(text: string) {
  const { document, sources: parsed } = parse(text, 'schema.psl');
  const sources = new PslSources([[document.syntax, parsed.sourceFileFor(document.syntax)]]);
  const { symbolTable } = buildSymbolTable({
    documents: [document],
    sources,
    pslBlockDescriptors: ENUM_DESCRIPTORS,
  });
  return {
    sources,
    symbolTable,
    ...createBinder({
      sources,
      symbolTable,
      typeConstructors: TYPE_CONSTRUCTORS,
      attributeSpecs: ATTRIBUTE_SPECS,
    }),
  };
}

const RELATION_SCHEMA = [
  'model User {',
  '  id Int',
  '}',
  'model Post {',
  '  authorId Int',
  '  author User @relation(fields: [authorId], references: [id])',
  '}',
].join('\n');

describe('referencedModel', () => {
  it('returns the model a relation field points at', () => {
    const { symbolTable, binder } = bind(RELATION_SCHEMA);
    const post = symbolTable.topLevel.models['Post']!;

    expect(referencedModel(binder, post.fields['author']!)).toBe(
      symbolTable.topLevel.models['User'],
    );
  });

  it('returns undefined for a cross-space field type', () => {
    const { symbolTable, binder } = bind('model Cart {\n  user auth:User\n}');
    const cart = symbolTable.topLevel.models['Cart']!;

    expect(referencedModel(binder, cart.fields['user']!)).toBeUndefined();
  });

  it('returns undefined for an unresolved field type', () => {
    const { symbolTable, binder } = bind('model Cart {\n  owner Ghost\n}');
    const cart = symbolTable.topLevel.models['Cart']!;

    expect(referencedModel(binder, cart.fields['owner']!)).toBeUndefined();
  });

  it('returns undefined when the type resolves to something other than a model', () => {
    const { symbolTable, binder } = bind(
      [
        'enum Role {',
        '  Admin',
        '}',
        'type Address {',
        '  street String',
        '}',
        'model User {',
        '  role Role',
        '  address Address',
        '  name String',
        '}',
      ].join('\n'),
    );
    const user = symbolTable.topLevel.models['User']!;

    expect(referencedModel(binder, user.fields['role']!)).toBeUndefined();
    expect(referencedModel(binder, user.fields['address']!)).toBeUndefined();
    expect(referencedModel(binder, user.fields['name']!)).toBeUndefined();
  });
});

describe('fieldAttributeContext', () => {
  it('carries the binder and the declaring symbols', () => {
    const { sources, symbolTable, binder } = bind(RELATION_SCHEMA);
    const post = symbolTable.topLevel.models['Post']!;
    const ctx = fieldAttributeContext({
      binder,
      sources,
      model: post,
      field: post.fields['author']!,
    });

    expect(ctx.sources).toBe(sources);
    expect(ctx.selfModel).toBe(post);
    expect(ctx.field).toBe(post.fields['author']);
    expect(ctx.binder).toBe(binder);
    expect(referencedModel(ctx.binder, ctx.field)).toBe(symbolTable.topLevel.models['User']);
  });

  it('carries a binder that resolves no model for a cross-space relation', () => {
    const { sources, symbolTable, binder } = bind(
      'model Cart {\n  userId Int\n  user auth:User @relation(fields: [userId], references: [id])\n}',
    );
    const cart = symbolTable.topLevel.models['Cart']!;
    const ctx = fieldAttributeContext({
      binder,
      sources,
      model: cart,
      field: cart.fields['user']!,
    });

    expect(referencedModel(ctx.binder, ctx.field)).toBeUndefined();
  });
});

describe('modelAttributeContext', () => {
  it('carries the sources and the declaring model', () => {
    const { sources, symbolTable, binder } = bind(RELATION_SCHEMA);
    const post = symbolTable.topLevel.models['Post']!;
    const ctx = modelAttributeContext({ binder, sources, model: post });

    expect(ctx.sources).toBe(sources);
    expect(ctx.selfModel).toBe(post);
  });
});

describe('reference parameters under optional(list(...))', () => {
  it('resolves both sides of a relation spec shaped like a target', () => {
    const { symbolTable, binder, diagnostics } = bind(RELATION_SCHEMA);
    const post = symbolTable.topLevel.models['Post']!;
    const user = symbolTable.topLevel.models['User']!;
    const argumentNode = (argName: string) => {
      for (const attribute of post.fields['author']!.node.attributes()) {
        for (const arg of attribute.argList()?.args() ?? []) {
          if (arg.name()?.name() !== argName) continue;
          const value = arg.value();
          const array = value === undefined ? undefined : ArrayLiteralAst.cast(value.syntax);
          return Array.from(array?.elements() ?? [], (element) => element.syntax)[0];
        }
      }
      return undefined;
    };

    expect(diagnostics).toEqual([]);
    const fields = argumentNode('fields');
    const references = argumentNode('references');
    expect(fields).toBeDefined();
    expect(references).toBeDefined();
    expect(fields === undefined ? undefined : binder.symbolForNode(fields)).toEqual({
      kind: 'field',
      symbol: post.fields['authorId'],
    });
    expect(references === undefined ? undefined : binder.symbolForNode(references)).toEqual({
      kind: 'field',
      symbol: user.fields['id'],
    });
  });

  it('reports an unknown name through the optional wrapper', () => {
    const { diagnostics } = bind(
      [
        'model User {',
        '  id Int',
        '}',
        'model Post {',
        '  authorId Int',
        '  author User @relation(fields: [nope], references: [alsoNope])',
        '}',
      ].join('\n'),
    );

    expect(diagnostics.map(({ message }) => message)).toEqual([
      'Cannot find field "nope" on "Post"',
      'Cannot find field "alsoNope" on the type of "Post.author"',
    ]);
  });
});

describe('typed model surface', () => {
  it('narrows a binder resolution to a model symbol', () => {
    const { symbolTable, binder } = bind(RELATION_SCHEMA);
    const post = symbolTable.topLevel.models['Post']!;
    const resolved: ModelSymbol | undefined = referencedModel(binder, post.fields['author']!);

    expect(resolved?.name).toBe('User');
  });
});
