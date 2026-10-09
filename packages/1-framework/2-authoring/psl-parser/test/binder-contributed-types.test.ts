import type {
  AuthoringFieldPresetDescriptor,
  AuthoringTypeConstructorDescriptor,
} from '@internal/framework-components/authoring';
import { describe, expect, it } from 'vitest';
import { EMPTY_DATA_TYPES } from '../src/attribute-spec/spec-context';
import {
  type BinderContext,
  contributedTypeOf,
  createBinder,
  typeReferenceNode,
} from '../src/binder';
import { parse } from '../src/parse';
import { PslSources } from '../src/source-file';
import { buildSymbolTable, type FieldSymbol, type NamedTypeSymbol } from '../src/symbol-table';
import { PathExprAst } from '../src/syntax/ast/expressions';
import type { SyntaxNode } from '../src/syntax/red';

const createdAt: AuthoringFieldPresetDescriptor = {
  kind: 'fieldPreset',
  output: { codecId: 'fixture/timestamp@1' },
};

const uuid: AuthoringFieldPresetDescriptor = {
  kind: 'fieldPreset',
  args: [{ kind: 'number', name: 'version' }],
  output: { codecId: 'fixture/uuid@1', id: true },
};

const text: AuthoringTypeConstructorDescriptor = {
  kind: 'typeConstructor',
  output: { codecId: 'fixture/text@1' },
};

const varchar: AuthoringTypeConstructorDescriptor = {
  kind: 'typeConstructor',
  args: [{ kind: 'number', name: 'length' }],
  output: { codecId: 'fixture/varchar@1' },
};

const tagged: AuthoringTypeConstructorDescriptor = {
  kind: 'typeConstructor',
  entityRefArg: { index: 0, entityKind: 'tag' },
  output: { codecId: 'fixture/tagged@1' },
};

const secondTagged: AuthoringTypeConstructorDescriptor = {
  kind: 'typeConstructor',
  entityRefArg: { index: 1, entityKind: 'tag' },
  output: { codecId: 'fixture/tagged@1' },
};

function context(): BinderContext {
  return {
    authoringContributions: {
      type: { String: text, db: { VarChar: varchar, tagged, secondTagged } },
      field: { temporal: { createdAt }, db: { uuid } },
      entityTypes: {},
      attributeSpecs: { model: {}, field: {} },
      modelAttributes: {},
      pslBlockDescriptors: {},
      dataTypes: {},
    },
    controlMutationDefaults: { defaultFunctionRegistry: new Map() },
    dataTypes: EMPTY_DATA_TYPES,
  };
}

function bindProject(text: string) {
  const { document, sources } = parse(text, 'schema.prisma');
  const pslSources = new PslSources([[document.syntax, sources.sourceFileFor(document.syntax)]]);
  const { symbolTable } = buildSymbolTable({ documents: [document], sources: pslSources });
  const { binder, diagnostics } = createBinder({
    symbolTable,
    sources: pslSources,
    context: context(),
  });
  const resolve = (fieldName: string) => {
    const field = symbolTable.topLevel.models['Post']?.fields[fieldName];
    const node = field === undefined ? undefined : typeReferenceNode(field);
    return node === undefined ? undefined : binder.symbolForNode(node);
  };
  return { resolve, diagnostics, binder, symbolTable, sources: pslSources };
}

function argumentNode(
  holder: FieldSymbol | NamedTypeSymbol | undefined,
  index = 0,
): SyntaxNode | undefined {
  return holder?.typeConstructor?.args[index]?.expression?.syntax;
}

const entities =
  'tag TopTag {}\nmodel TopModel {\n  id String\n}\nnamespace auth {\n  tag AuthTag {}\n}\n';

describe('createBinder — contributed types', () => {
  it('binds a field-preset name to the preset descriptor', () => {
    const { resolve, diagnostics } = bindProject(
      'model Post {\n  created temporal.createdAt()\n  bare temporal.createdAt\n}',
    );

    expect(diagnostics).toEqual([]);
    for (const field of ['created', 'bare']) {
      expect(resolve(field)).toEqual({
        kind: 'contributedType',
        symbol: {
          kind: 'contributedType',
          name: 'createdAt',
          path: ['temporal', 'createdAt'],
          descriptor: createdAt,
        },
      });
    }
  });

  it('binds a type-constructor name to the type-constructor descriptor', () => {
    const { resolve } = bindProject('model Post {\n  title String\n  slug db.VarChar(10)\n}');

    expect(resolve('title')).toEqual({
      kind: 'contributedType',
      symbol: { kind: 'contributedType', name: 'String', path: ['String'], descriptor: text },
    });
    expect(resolve('slug')).toEqual({
      kind: 'contributedType',
      symbol: {
        kind: 'contributedType',
        name: 'VarChar',
        path: ['db', 'VarChar'],
        descriptor: varchar,
      },
    });
  });

  it('binds presets and type constructors that share a namespace', () => {
    const { resolve, diagnostics } = bindProject(
      'model Post {\n  id db.uuid(7)\n  slug db.VarChar(10)\n}',
    );

    expect(diagnostics).toEqual([]);
    expect(resolve('id')).toEqual({
      kind: 'contributedType',
      symbol: { kind: 'contributedType', name: 'uuid', path: ['db', 'uuid'], descriptor: uuid },
    });
    expect(resolve('slug')).toMatchObject({
      kind: 'contributedType',
      symbol: { path: ['db', 'VarChar'], descriptor: varchar },
    });
  });

  describe('contributedTypeOf', () => {
    it('returns the contributed type a field resolves to', () => {
      const { resolve, binder } = bindProject('model Post {\n  title String\n}');

      expect(contributedTypeOf(resolve('title'), binder)).toEqual({
        kind: 'contributedType',
        name: 'String',
        path: ['String'],
        descriptor: text,
      });
    });

    it('follows a named type to the contributed type of its base', () => {
      const { resolve, binder } = bindProject(
        'types {\n  Slug = db.VarChar(10)\n}\nmodel Post {\n  slug Slug\n}',
      );

      expect(resolve('slug')?.kind).toBe('namedType');
      expect(contributedTypeOf(resolve('slug'), binder)).toEqual({
        kind: 'contributedType',
        name: 'VarChar',
        path: ['db', 'VarChar'],
        descriptor: varchar,
      });
    });

    it('returns undefined for a resolution that is not a contributed type', () => {
      const { resolve, binder } = bindProject(
        'model Author {\n  id String\n}\nmodel Post {\n  author Author\n  missing Nope\n}',
      );

      expect(contributedTypeOf(resolve('author'), binder)).toBeUndefined();
      expect(contributedTypeOf(resolve('missing'), binder)).toBeUndefined();
      expect(contributedTypeOf(undefined, binder)).toBeUndefined();
    });
  });
});

describe('createBinder — entity argument of a type constructor', () => {
  it('binds a name in scope to the block it names', () => {
    const { symbolTable, binder, diagnostics } = bindProject(
      `${entities}model Post {\n  value db.tagged(TopTag)\n}`,
    );
    const argument = argumentNode(symbolTable.topLevel.models['Post']?.fields['value']);

    expect(diagnostics).toEqual([]);
    expect(argument && binder.symbolForNode(argument)).toEqual({
      kind: 'block',
      symbol: symbolTable.topLevel.blocks['TopTag'],
    });
  });

  it('binds a name that is a model, without checking the kind', () => {
    const { symbolTable, binder, diagnostics } = bindProject(
      `${entities}model Post {\n  value db.tagged(TopModel)\n}`,
    );
    const argument = argumentNode(symbolTable.topLevel.models['Post']?.fields['value']);

    expect(diagnostics).toEqual([]);
    expect(argument && binder.symbolForNode(argument)).toEqual({
      kind: 'model',
      symbol: symbolTable.topLevel.models['TopModel'],
    });
  });

  it('binds a qualified name to the member, and its qualifier to the namespace', () => {
    const { symbolTable, binder, diagnostics } = bindProject(
      `${entities}model Post {\n  value db.tagged(auth.AuthTag)\n}`,
    );
    const argument = argumentNode(symbolTable.topLevel.models['Post']?.fields['value']);
    const [qualifier] = (argument && PathExprAst.cast(argument)?.segments()) ?? [];

    expect(diagnostics).toEqual([]);
    expect(argument && binder.symbolForNode(argument)).toEqual({
      kind: 'block',
      symbol: symbolTable.topLevel.namespaces['auth']?.blocks['AuthTag'],
      namespace: symbolTable.topLevel.namespaces['auth'],
    });
    expect(qualifier && binder.symbolForNode(qualifier.syntax)).toEqual({
      kind: 'namespace',
      symbol: symbolTable.topLevel.namespaces['auth'],
    });
  });

  it('reports an unknown name once, on the argument, and records it as unresolved', () => {
    const { symbolTable, binder, diagnostics, sources } = bindProject(
      `${entities}model Post {\n  value db.tagged(Nope)\n}`,
    );
    const argument = argumentNode(symbolTable.topLevel.models['Post']?.fields['value']);
    const file = argument && sources.sourceFileFor(argument);

    expect(diagnostics).toEqual([
      {
        code: 'PSL_UNRESOLVED_REFERENCE',
        message: 'Cannot find entity "Nope"',
        data: { reference: 'entity' },
        filename: 'schema.prisma',
        range: argument &&
          file && {
            start: file.positionAt(argument.offset),
            end: file.positionAt(argument.endOffset),
          },
      },
    ]);
    expect(argument && binder.symbolForNode(argument)).toEqual({
      kind: 'unresolved',
      name: 'Nope',
    });
  });

  it('does not see a name declared inside a namespace when it is written unqualified', () => {
    const { symbolTable, binder, diagnostics } = bindProject(
      `${entities}model Post {\n  value db.tagged(AuthTag)\n}`,
    );
    const argument = argumentNode(symbolTable.topLevel.models['Post']?.fields['value']);

    expect(diagnostics.map(({ code, message }) => ({ code, message }))).toEqual([
      { code: 'PSL_UNRESOLVED_REFERENCE', message: 'Cannot find entity "AuthTag"' },
    ]);
    expect(argument && binder.symbolForNode(argument)).toEqual({
      kind: 'unresolved',
      name: 'AuthTag',
    });
  });

  it('binds the positional argument at the index the constructor declares', () => {
    const { symbolTable, binder, diagnostics } = bindProject(
      `${entities}model Post {\n  value db.secondTagged(TopModel, TopTag)\n}`,
    );
    const argument = argumentNode(symbolTable.topLevel.models['Post']?.fields['value'], 1);

    expect(diagnostics).toEqual([]);
    expect(argument && binder.symbolForNode(argument)).toEqual({
      kind: 'block',
      symbol: symbolTable.topLevel.blocks['TopTag'],
    });
  });

  it('counts positional arguments only when named arguments are mixed in', () => {
    const { symbolTable, binder, diagnostics } = bindProject(
      `${entities}model Post {\n  value db.secondTagged(TopModel, extra: TopModel, TopTag)\n}`,
    );
    const argument = argumentNode(symbolTable.topLevel.models['Post']?.fields['value'], 2);

    expect(diagnostics).toEqual([]);
    expect(argument && binder.symbolForNode(argument)).toEqual({
      kind: 'block',
      symbol: symbolTable.topLevel.blocks['TopTag'],
    });
  });

  it('records nothing for a string', () => {
    const { symbolTable, binder, diagnostics } = bindProject(
      `${entities}model Post {\n  value db.tagged("TopTag")\n}`,
    );
    const argument = argumentNode(symbolTable.topLevel.models['Post']?.fields['value']);

    expect(diagnostics).toEqual([]);
    expect(argument && binder.symbolForNode(argument)).toBeUndefined();
  });

  it('records nothing for a number', () => {
    const { symbolTable, binder, diagnostics } = bindProject(
      `${entities}model Post {\n  value db.tagged(1)\n}`,
    );
    const argument = argumentNode(symbolTable.topLevel.models['Post']?.fields['value']);

    expect(diagnostics).toEqual([]);
    expect(argument && binder.symbolForNode(argument)).toBeUndefined();
  });

  it('records nothing for a path of three segments', () => {
    const { symbolTable, binder, diagnostics } = bindProject(
      `${entities}model Post {\n  value db.tagged(auth.AuthTag.more)\n}`,
    );
    const argument = argumentNode(symbolTable.topLevel.models['Post']?.fields['value']);

    expect(diagnostics).toEqual([]);
    expect(argument && binder.symbolForNode(argument)).toBeUndefined();
  });

  it('records nothing for a named argument', () => {
    const { symbolTable, binder, diagnostics } = bindProject(
      `${entities}model Post {\n  value db.tagged(tag: TopTag)\n}`,
    );
    const argument = argumentNode(symbolTable.topLevel.models['Post']?.fields['value']);

    expect(diagnostics).toEqual([]);
    expect(argument && binder.symbolForNode(argument)).toBeUndefined();
  });

  it('records nothing for an empty argument list', () => {
    const { symbolTable, binder, diagnostics } = bindProject(
      `${entities}model Post {\n  value db.tagged()\n}`,
    );
    const argument = argumentNode(symbolTable.topLevel.models['Post']?.fields['value']);

    expect(diagnostics).toEqual([]);
    expect(argument && binder.symbolForNode(argument)).toBeUndefined();
  });

  it('records nothing for the arguments of a constructor that declares no entity argument', () => {
    const { symbolTable, binder, diagnostics } = bindProject(
      `${entities}model Post {\n  value db.VarChar(TopTag)\n}`,
    );
    const argument = argumentNode(symbolTable.topLevel.models['Post']?.fields['value']);

    expect(diagnostics).toEqual([]);
    expect(argument && binder.symbolForNode(argument)).toBeUndefined();
  });

  it('binds a name of the namespace of a model declared in a namespace', () => {
    const { symbolTable, binder, diagnostics } = bindProject(
      `${entities}namespace auth {\n  model Post {\n    value db.tagged(AuthTag)\n  }\n}`,
    );
    const argument = argumentNode(
      symbolTable.topLevel.namespaces['auth']?.models['Post']?.fields['value'],
    );

    expect(diagnostics).toEqual([]);
    expect(argument && binder.symbolForNode(argument)).toEqual({
      kind: 'block',
      symbol: symbolTable.topLevel.namespaces['auth']?.blocks['AuthTag'],
      namespace: symbolTable.topLevel.namespaces['auth'],
    });
  });

  it('binds a top-level name from a model declared in a namespace', () => {
    const { symbolTable, binder, diagnostics } = bindProject(
      `${entities}namespace auth {\n  model Post {\n    value db.tagged(TopTag)\n  }\n}`,
    );
    const argument = argumentNode(
      symbolTable.topLevel.namespaces['auth']?.models['Post']?.fields['value'],
    );

    expect(diagnostics).toEqual([]);
    expect(argument && binder.symbolForNode(argument)).toEqual({
      kind: 'block',
      symbol: symbolTable.topLevel.blocks['TopTag'],
    });
  });

  it('binds a qualified name and its qualifier from a model declared in a namespace', () => {
    const { symbolTable, binder, diagnostics } = bindProject(
      `${entities}namespace auth {\n  model Post {\n    value db.tagged(auth.AuthTag)\n  }\n}`,
    );
    const argument = argumentNode(
      symbolTable.topLevel.namespaces['auth']?.models['Post']?.fields['value'],
    );
    const [qualifier] = (argument && PathExprAst.cast(argument)?.segments()) ?? [];

    expect(diagnostics).toEqual([]);
    expect(argument && binder.symbolForNode(argument)).toEqual({
      kind: 'block',
      symbol: symbolTable.topLevel.namespaces['auth']?.blocks['AuthTag'],
      namespace: symbolTable.topLevel.namespaces['auth'],
    });
    expect(qualifier && binder.symbolForNode(qualifier.syntax)).toEqual({
      kind: 'namespace',
      symbol: symbolTable.topLevel.namespaces['auth'],
    });
  });

  it('reports an unknown name from a model declared in a namespace', () => {
    const { symbolTable, binder, diagnostics } = bindProject(
      `${entities}namespace auth {\n  model Post {\n    value db.tagged(Nope)\n  }\n}`,
    );
    const argument = argumentNode(
      symbolTable.topLevel.namespaces['auth']?.models['Post']?.fields['value'],
    );

    expect(diagnostics.map(({ code, message }) => ({ code, message }))).toEqual([
      { code: 'PSL_UNRESOLVED_REFERENCE', message: 'Cannot find entity "Nope"' },
    ]);
    expect(argument && binder.symbolForNode(argument)).toEqual({
      kind: 'unresolved',
      name: 'Nope',
    });
  });

  it('binds a name in scope from a field of a composite type', () => {
    const { symbolTable, binder, diagnostics } = bindProject(
      `${entities}type Address {\n  value db.tagged(TopTag)\n}`,
    );
    const argument = argumentNode(symbolTable.topLevel.compositeTypes['Address']?.fields['value']);

    expect(diagnostics).toEqual([]);
    expect(argument && binder.symbolForNode(argument)).toEqual({
      kind: 'block',
      symbol: symbolTable.topLevel.blocks['TopTag'],
    });
  });

  it('binds a qualified name and its qualifier from a field of a composite type', () => {
    const { symbolTable, binder, diagnostics } = bindProject(
      `${entities}type Address {\n  value db.tagged(auth.AuthTag)\n}`,
    );
    const argument = argumentNode(symbolTable.topLevel.compositeTypes['Address']?.fields['value']);
    const [qualifier] = (argument && PathExprAst.cast(argument)?.segments()) ?? [];

    expect(diagnostics).toEqual([]);
    expect(argument && binder.symbolForNode(argument)).toEqual({
      kind: 'block',
      symbol: symbolTable.topLevel.namespaces['auth']?.blocks['AuthTag'],
      namespace: symbolTable.topLevel.namespaces['auth'],
    });
    expect(qualifier && binder.symbolForNode(qualifier.syntax)).toEqual({
      kind: 'namespace',
      symbol: symbolTable.topLevel.namespaces['auth'],
    });
  });

  it('reports an unknown name from a field of a composite type', () => {
    const { symbolTable, binder, diagnostics } = bindProject(
      `${entities}type Address {\n  value db.tagged(Nope)\n}`,
    );
    const argument = argumentNode(symbolTable.topLevel.compositeTypes['Address']?.fields['value']);

    expect(diagnostics.map(({ code, message }) => ({ code, message }))).toEqual([
      { code: 'PSL_UNRESOLVED_REFERENCE', message: 'Cannot find entity "Nope"' },
    ]);
    expect(argument && binder.symbolForNode(argument)).toEqual({
      kind: 'unresolved',
      name: 'Nope',
    });
  });

  it('binds a top-level name from a named type', () => {
    const { symbolTable, binder, diagnostics } = bindProject(
      `${entities}types {\n  Alias = db.tagged(TopTag)\n}`,
    );
    const argument = argumentNode(symbolTable.topLevel.namedTypes['Alias']);

    expect(diagnostics).toEqual([]);
    expect(argument && binder.symbolForNode(argument)).toEqual({
      kind: 'block',
      symbol: symbolTable.topLevel.blocks['TopTag'],
    });
  });

  it('binds a name of a namespace when it is qualified, from a named type', () => {
    const { symbolTable, binder, diagnostics } = bindProject(
      `${entities}types {\n  Alias = db.tagged(auth.AuthTag)\n}`,
    );
    const argument = argumentNode(symbolTable.topLevel.namedTypes['Alias']);
    const [qualifier] = (argument && PathExprAst.cast(argument)?.segments()) ?? [];

    expect(diagnostics).toEqual([]);
    expect(argument && binder.symbolForNode(argument)).toEqual({
      kind: 'block',
      symbol: symbolTable.topLevel.namespaces['auth']?.blocks['AuthTag'],
      namespace: symbolTable.topLevel.namespaces['auth'],
    });
    expect(qualifier && binder.symbolForNode(qualifier.syntax)).toEqual({
      kind: 'namespace',
      symbol: symbolTable.topLevel.namespaces['auth'],
    });
  });

  it('reports an unknown name from a named type', () => {
    const { symbolTable, binder, diagnostics } = bindProject(
      `${entities}types {\n  Alias = db.tagged(Nope)\n}`,
    );
    const argument = argumentNode(symbolTable.topLevel.namedTypes['Alias']);

    expect(diagnostics.map(({ code, message }) => ({ code, message }))).toEqual([
      { code: 'PSL_UNRESOLVED_REFERENCE', message: 'Cannot find entity "Nope"' },
    ]);
    expect(argument && binder.symbolForNode(argument)).toEqual({
      kind: 'unresolved',
      name: 'Nope',
    });
  });

  it('does not resolve the own name of a named type to itself', () => {
    const { symbolTable, binder, diagnostics } = bindProject(
      `${entities}types {\n  Alias = db.tagged(Alias)\n}`,
    );
    const argument = argumentNode(symbolTable.topLevel.namedTypes['Alias']);

    expect(diagnostics.map(({ code, message }) => ({ code, message }))).toEqual([
      { code: 'PSL_UNRESOLVED_REFERENCE', message: 'Cannot find entity "Alias"' },
    ]);
    expect(argument && binder.symbolForNode(argument)).toEqual({
      kind: 'unresolved',
      name: 'Alias',
    });
  });
});
