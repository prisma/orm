import type {
  AuthoringPslBlockDescriptorNamespace,
  AuthoringTypeNamespace,
} from '@internal/framework-components/authoring';
import { describe, expect, it } from 'vitest';
import { entityRef } from '../src/attribute-spec/combinators/entity-ref';
import { fieldRef, referencedFieldRef } from '../src/attribute-spec/combinators/field-ref';
import { list } from '../src/attribute-spec/combinators/list';
import { str } from '../src/attribute-spec/combinators/str';
import { fieldAttribute } from '../src/attribute-spec/field-attribute';
import { interpretAttribute } from '../src/attribute-spec/interpret';
import { modelAttribute } from '../src/attribute-spec/model-attribute';
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
import { buildSymbolTable, type FieldSymbol, type ModelSymbol } from '../src/symbol-table';
import type { FieldAttributeAst, ModelAttributeAst } from '../src/syntax/ast/attributes';

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
  named: {
    name: { type: optional(str()), documentation: 'fixture' },
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

const baseSpec = modelAttribute('base', {
  documentation: 'fixture',
  positional: [{ key: 'model', type: entityRef(), documentation: 'fixture' }],
});

const indexSpec = modelAttribute('index', {
  documentation: 'fixture',
  positional: [{ key: 'fields', type: list(fieldRef()), documentation: 'fixture' }],
});

const ATTRIBUTE_SPECS: AttributeSpecRegistry = {
  model: (name) => (name === 'base' ? baseSpec : name === 'index' ? indexSpec : undefined),
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
  const { binder, diagnostics } = createBinder({
    sources,
    symbolTable,
    typeConstructors: TYPE_CONSTRUCTORS,
    attributeSpecs: ATTRIBUTE_SPECS,
  });
  return { sources, symbolTable, binder, binderDiagnostics: diagnostics };
}

function fieldAttributeNode(field: FieldSymbol, name: string): FieldAttributeAst {
  for (const attribute of field.node.attributes()) {
    if (attribute.name()?.path().join('.') === name) return attribute;
  }
  throw new Error(`no @${name}`);
}

function modelAttributeNode(model: ModelSymbol, name: string): ModelAttributeAst {
  for (const attribute of model.node.attributes()) {
    if (attribute.name()?.path().join('.') === name) return attribute;
  }
  throw new Error(`no @@${name}`);
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

function interpretRelation(text: string, withBinder: boolean) {
  const { sources, symbolTable, binder, binderDiagnostics } = bind(text);
  const post = symbolTable.topLevel.models['Post']!;
  const field = post.fields['author']!;
  const ctx = withBinder
    ? fieldAttributeContext({ binder, sources, model: post, field })
    : {
        sources,
        selfModel: post,
        field,
        resolveReferencedModel: () => referencedModel(binder, field),
      };
  return {
    binderDiagnostics,
    result: interpretAttribute(fieldAttributeNode(field, 'relation'), relationSpec, ctx),
  };
}

describe('reference combinators with a binder-backed context', () => {
  it('parses a valid relation to the same output as the legacy path', () => {
    const legacy = interpretRelation(RELATION_SCHEMA, false);
    const bound = interpretRelation(RELATION_SCHEMA, true);

    const expected = { fields: ['authorId'], references: ['id'] };
    expect(legacy.result.ok).toBe(true);
    expect(bound.result.ok).toBe(true);
    if (legacy.result.ok) expect(legacy.result.value).toEqual(expected);
    if (bound.result.ok) expect(bound.result.value).toEqual(expected);
    expect(bound.binderDiagnostics).toEqual([]);
  });

  it('leaves an unknown referenced field to the binder alone', () => {
    const schema = [
      'model User {',
      '  id Int',
      '}',
      'model Post {',
      '  authorId Int',
      '  author User @relation(fields: [authorId], references: [absent])',
      '}',
    ].join('\n');
    const legacy = interpretRelation(schema, false);
    const bound = interpretRelation(schema, true);

    expect(legacy.result.ok).toBe(false);
    expect(bound.result.ok).toBe(true);
    expect(bound.binderDiagnostics.map(({ code, message }) => [code, message])).toEqual([
      ['PSL_UNRESOLVED_REFERENCE', 'Cannot find field "absent" on the type of "Post.author"'],
    ]);
  });

  it('leaves an unknown local field to the binder alone', () => {
    const schema = [
      'model User {',
      '  id Int',
      '}',
      'model Post {',
      '  authorId Int',
      '  author User @relation(fields: [nope], references: [id])',
      '}',
    ].join('\n');
    const bound = interpretRelation(schema, true);

    expect(bound.result.ok).toBe(true);
    expect(bound.binderDiagnostics.map(({ code, message }) => [code, message])).toEqual([
      ['PSL_UNRESOLVED_REFERENCE', 'Cannot find field "nope" on "Post"'],
    ]);
  });

  it('leaves an unknown entity to the binder alone', () => {
    const { sources, symbolTable, binder, binderDiagnostics } = bind(
      'model Child {\n  id Int\n  @@base(Ghost)\n}',
    );
    const child = symbolTable.topLevel.models['Child']!;
    const ctx = modelAttributeContext({ binder, sources, model: child });
    const result = interpretAttribute(modelAttributeNode(child, 'base'), baseSpec, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ model: 'Ghost' });
    expect(binderDiagnostics.map(({ code, message }) => [code, message])).toEqual([
      ['PSL_UNRESOLVED_REFERENCE', 'Cannot find entity "Ghost"'],
    ]);
  });

  it('stays silent on both sides for a cross-space relation', () => {
    const schema = [
      'model Post {',
      '  authorId Int',
      '  author auth:User @relation(fields: [authorId], references: [id])',
      '}',
    ].join('\n');
    const { sources, symbolTable, binder, binderDiagnostics } = bind(schema);
    const post = symbolTable.topLevel.models['Post']!;
    const field = post.fields['author']!;
    const ctx = fieldAttributeContext({ binder, sources, model: post, field });
    const result = interpretAttribute(fieldAttributeNode(field, 'relation'), relationSpec, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ fields: ['authorId'], references: ['id'] });
    expect(binderDiagnostics).toEqual([]);
  });

  it('keeps shape failures as the combinator voice', () => {
    const { sources, symbolTable, binder, binderDiagnostics } = bind(
      'model User {\n  id Int\n  @@index("id")\n}',
    );
    const user = symbolTable.topLevel.models['User']!;
    const ctx = modelAttributeContext({ binder, sources, model: user });
    const result = interpretAttribute(modelAttributeNode(user, 'index'), indexSpec, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.map(({ code, message }) => [code, message])).toEqual([
        ['PSL_INVALID_ATTRIBUTE_SYNTAX', 'Expected a list of field name'],
      ]);
    }
    expect(binderDiagnostics).toEqual([]);
  });

  it('keeps a non-identifier in a reference slot as the combinator voice', () => {
    const { sources, symbolTable, binder, binderDiagnostics } = bind(
      'model User {\n  id Int\n  @@index(["id"])\n}',
    );
    const user = symbolTable.topLevel.models['User']!;
    const ctx = modelAttributeContext({ binder, sources, model: user });
    const result = interpretAttribute(modelAttributeNode(user, 'index'), indexSpec, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.map(({ message }) => message)).toEqual(['Expected a field name']);
    }
    expect(binderDiagnostics).toEqual([]);
  });
});

describe('reference combinators without a binder', () => {
  it('still reports an unknown local field itself', () => {
    const { sources, symbolTable } = bind('model User {\n  id Int\n  @@index([nope])\n}');
    const user = symbolTable.topLevel.models['User']!;
    const result = interpretAttribute(modelAttributeNode(user, 'index'), indexSpec, {
      sources,
      selfModel: user,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.map(({ message }) => message)).toEqual([
        'Field "nope" does not exist on model "User"',
      ]);
    }
  });

  it('still reports an unknown referenced field itself', () => {
    const legacy = interpretRelation(
      [
        'model User {',
        '  id Int',
        '}',
        'model Post {',
        '  authorId Int',
        '  author User @relation(fields: [authorId], references: [absent])',
        '}',
      ].join('\n'),
      false,
    );

    expect(legacy.result.ok).toBe(false);
    if (!legacy.result.ok) {
      expect(legacy.result.failure.map(({ message }) => message)).toEqual([
        'Field "absent" does not exist on model "User"',
      ]);
    }
  });
});
