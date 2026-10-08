import type { AuthoringTypeConstructorDescriptor } from '@internal/framework-components/authoring';
import { describe, expect, it } from 'vitest';
import { EMPTY_DATA_TYPES } from '../src/attribute-spec/spec-context';
import { type BinderContext, createBinder } from '../src/binder';
import { parse } from '../src/parse';
import { buildSymbolTable, type FieldSymbol, type NamedTypeSymbol } from '../src/symbol-table';
import { PathExprAst } from '../src/syntax/ast/expressions';
import type { SyntaxNode } from '../src/syntax/red';

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
      field: {},
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

const declarations = [
  'tag TopTag {}',
  'model TopModel {',
  '  id String',
  '}',
  'namespace auth {',
  '  tag AuthTag {}',
  '}',
].join('\n');

type Place = 'model' | 'namespacedModel' | 'compositeType' | 'namedType';

const placed: Record<Place, (type: string) => string> = {
  model: (type) => `model Holder {\n  value ${type}\n}`,
  namespacedModel: (type) => `namespace auth {\n  model Holder {\n    value ${type}\n  }\n}`,
  compositeType: (type) => `type Holder {\n  value ${type}\n}`,
  namedType: (type) => `types {\n  Holder = ${type}\n}`,
};

function bindIn(place: Place, type: string) {
  const { document, sources } = parse(`${declarations}\n${placed[place](type)}\n`, 'schema.prisma');
  const { symbolTable } = buildSymbolTable({ documents: [document], sources });
  const { binder, diagnostics } = createBinder({ symbolTable, sources, context: context() });
  const { topLevel } = symbolTable;
  const auth = topLevel.namespaces['auth'];
  const holders: Record<Place, FieldSymbol | NamedTypeSymbol | undefined> = {
    model: topLevel.models['Holder']?.fields['value'],
    namespacedModel: auth?.models['Holder']?.fields['value'],
    compositeType: topLevel.compositeTypes['Holder']?.fields['value'],
    namedType: topLevel.namedTypes['Holder'],
  };
  const holder = holders[place];
  if (holder === undefined || auth === undefined) throw new Error(`no holder for ${place}`);
  const argumentNodes = (holder.typeConstructor?.args ?? []).map((arg) => arg.expression?.syntax);
  const resolutionAt = (index: number) => {
    const node = argumentNodes[index];
    return node === undefined ? undefined : binder.symbolForNode(node);
  };
  const rangeOf = (node: SyntaxNode) => {
    const file = sources.sourceFileFor(node);
    return { start: file.positionAt(node.offset), end: file.positionAt(node.endOffset) };
  };
  return { binder, diagnostics, topLevel, auth, argumentNodes, resolutionAt, rangeOf };
}

function qualifierOf(node: SyntaxNode | undefined): SyntaxNode {
  const [qualifier] = (node === undefined ? undefined : PathExprAst.cast(node))?.segments() ?? [];
  if (qualifier === undefined) throw new Error('no qualifier');
  return qualifier.syntax;
}

function unknownEntity(result: ReturnType<typeof bindIn>, name: string) {
  const node = result.argumentNodes[0];
  if (node === undefined) throw new Error('no argument');
  return [
    {
      code: 'PSL_UNRESOLVED_REFERENCE',
      message: `Cannot find entity "${name}"`,
      data: { reference: 'entity' },
      filename: 'schema.prisma',
      range: result.rangeOf(node),
    },
  ];
}

describe('createBinder — entity argument of a type constructor, field of a top-level model', () => {
  it('binds a name in scope to the block it names', () => {
    const result = bindIn('model', 'db.tagged(TopTag)');

    expect(result.diagnostics).toEqual([]);
    expect(result.resolutionAt(0)).toEqual({
      kind: 'block',
      symbol: result.topLevel.blocks['TopTag'],
    });
  });

  it('binds a name that is a model, without checking the kind', () => {
    const result = bindIn('model', 'db.tagged(TopModel)');

    expect(result.diagnostics).toEqual([]);
    expect(result.resolutionAt(0)).toEqual({
      kind: 'model',
      symbol: result.topLevel.models['TopModel'],
    });
  });

  it('binds a qualified name to the member, and its qualifier to the namespace', () => {
    const result = bindIn('model', 'db.tagged(auth.AuthTag)');

    expect(result.diagnostics).toEqual([]);
    expect(result.resolutionAt(0)).toEqual({
      kind: 'block',
      symbol: result.auth.blocks['AuthTag'],
      namespace: result.auth,
    });
    expect(result.binder.symbolForNode(qualifierOf(result.argumentNodes[0]))).toEqual({
      kind: 'namespace',
      symbol: result.auth,
    });
  });

  it('reports an unknown name once, on the argument, and records it as unresolved', () => {
    const result = bindIn('model', 'db.tagged(Nope)');

    expect(result.diagnostics).toEqual(unknownEntity(result, 'Nope'));
    expect(result.resolutionAt(0)).toEqual({ kind: 'unresolved', name: 'Nope' });
  });

  it('does not see a name declared inside a namespace when it is written unqualified', () => {
    const result = bindIn('model', 'db.tagged(AuthTag)');

    expect(result.diagnostics).toEqual(unknownEntity(result, 'AuthTag'));
    expect(result.resolutionAt(0)).toEqual({ kind: 'unresolved', name: 'AuthTag' });
  });

  it('binds the positional argument at the index the constructor declares', () => {
    const result = bindIn('model', 'db.secondTagged(TopModel, TopTag)');

    expect(result.diagnostics).toEqual([]);
    expect(result.resolutionAt(0)).toBeUndefined();
    expect(result.resolutionAt(1)).toEqual({
      kind: 'block',
      symbol: result.topLevel.blocks['TopTag'],
    });
  });

  it('counts positional arguments only when named arguments are mixed in', () => {
    const result = bindIn('model', 'db.secondTagged(TopModel, extra: TopModel, TopTag)');

    expect(result.diagnostics).toEqual([]);
    expect(result.resolutionAt(1)).toBeUndefined();
    expect(result.resolutionAt(2)).toEqual({
      kind: 'block',
      symbol: result.topLevel.blocks['TopTag'],
    });
  });
});

describe('createBinder — entity argument of a type constructor, argument that is not a name', () => {
  it('records nothing for a string', () => {
    const result = bindIn('model', 'db.tagged("TopTag")');

    expect(result.diagnostics).toEqual([]);
    expect(result.resolutionAt(0)).toBeUndefined();
  });

  it('records nothing for a number', () => {
    const result = bindIn('model', 'db.tagged(1)');

    expect(result.diagnostics).toEqual([]);
    expect(result.resolutionAt(0)).toBeUndefined();
  });

  it('records nothing for a path of three segments', () => {
    const result = bindIn('model', 'db.tagged(auth.AuthTag.more)');

    expect(result.diagnostics).toEqual([]);
    expect(result.resolutionAt(0)).toBeUndefined();
  });

  it('records nothing for a named argument', () => {
    const result = bindIn('model', 'db.tagged(tag: TopTag)');

    expect(result.diagnostics).toEqual([]);
    expect(result.resolutionAt(0)).toBeUndefined();
  });

  it('records nothing for an empty argument list', () => {
    const result = bindIn('model', 'db.tagged()');

    expect(result.diagnostics).toEqual([]);
    expect(result.argumentNodes).toEqual([]);
  });

  it('records nothing for the arguments of a constructor that declares no entity argument', () => {
    const result = bindIn('model', 'db.VarChar(TopTag)');

    expect(result.diagnostics).toEqual([]);
    expect(result.resolutionAt(0)).toBeUndefined();
  });
});

describe('createBinder — entity argument of a type constructor, field of a model in a namespace', () => {
  it('binds a name of the namespace of the model', () => {
    const result = bindIn('namespacedModel', 'db.tagged(AuthTag)');

    expect(result.diagnostics).toEqual([]);
    expect(result.resolutionAt(0)).toEqual({
      kind: 'block',
      symbol: result.auth.blocks['AuthTag'],
      namespace: result.auth,
    });
  });

  it('binds a top-level name', () => {
    const result = bindIn('namespacedModel', 'db.tagged(TopTag)');

    expect(result.diagnostics).toEqual([]);
    expect(result.resolutionAt(0)).toEqual({
      kind: 'block',
      symbol: result.topLevel.blocks['TopTag'],
    });
  });

  it('binds a qualified name and its qualifier', () => {
    const result = bindIn('namespacedModel', 'db.tagged(auth.AuthTag)');

    expect(result.diagnostics).toEqual([]);
    expect(result.resolutionAt(0)).toEqual({
      kind: 'block',
      symbol: result.auth.blocks['AuthTag'],
      namespace: result.auth,
    });
    expect(result.binder.symbolForNode(qualifierOf(result.argumentNodes[0]))).toEqual({
      kind: 'namespace',
      symbol: result.auth,
    });
  });

  it('reports an unknown name once, on the argument', () => {
    const result = bindIn('namespacedModel', 'db.tagged(Nope)');

    expect(result.diagnostics).toEqual(unknownEntity(result, 'Nope'));
    expect(result.resolutionAt(0)).toEqual({ kind: 'unresolved', name: 'Nope' });
  });
});

describe('createBinder — entity argument of a type constructor, field of a composite type', () => {
  it('binds a name in scope', () => {
    const result = bindIn('compositeType', 'db.tagged(TopTag)');

    expect(result.diagnostics).toEqual([]);
    expect(result.resolutionAt(0)).toEqual({
      kind: 'block',
      symbol: result.topLevel.blocks['TopTag'],
    });
  });

  it('binds a model, without checking the kind', () => {
    const result = bindIn('compositeType', 'db.tagged(TopModel)');

    expect(result.diagnostics).toEqual([]);
    expect(result.resolutionAt(0)).toEqual({
      kind: 'model',
      symbol: result.topLevel.models['TopModel'],
    });
  });

  it('binds a qualified name and its qualifier', () => {
    const result = bindIn('compositeType', 'db.tagged(auth.AuthTag)');

    expect(result.diagnostics).toEqual([]);
    expect(result.resolutionAt(0)).toEqual({
      kind: 'block',
      symbol: result.auth.blocks['AuthTag'],
      namespace: result.auth,
    });
    expect(result.binder.symbolForNode(qualifierOf(result.argumentNodes[0]))).toEqual({
      kind: 'namespace',
      symbol: result.auth,
    });
  });

  it('reports an unknown name once, on the argument', () => {
    const result = bindIn('compositeType', 'db.tagged(Nope)');

    expect(result.diagnostics).toEqual(unknownEntity(result, 'Nope'));
    expect(result.resolutionAt(0)).toEqual({ kind: 'unresolved', name: 'Nope' });
  });
});

describe('createBinder — entity argument of a type constructor, named type', () => {
  it('binds a top-level name', () => {
    const result = bindIn('namedType', 'db.tagged(TopTag)');

    expect(result.diagnostics).toEqual([]);
    expect(result.resolutionAt(0)).toEqual({
      kind: 'block',
      symbol: result.topLevel.blocks['TopTag'],
    });
  });

  it('binds a model, without checking the kind', () => {
    const result = bindIn('namedType', 'db.tagged(TopModel)');

    expect(result.diagnostics).toEqual([]);
    expect(result.resolutionAt(0)).toEqual({
      kind: 'model',
      symbol: result.topLevel.models['TopModel'],
    });
  });

  it('binds a name of a namespace when it is qualified, and its qualifier', () => {
    const result = bindIn('namedType', 'db.tagged(auth.AuthTag)');

    expect(result.diagnostics).toEqual([]);
    expect(result.resolutionAt(0)).toEqual({
      kind: 'block',
      symbol: result.auth.blocks['AuthTag'],
      namespace: result.auth,
    });
    expect(result.binder.symbolForNode(qualifierOf(result.argumentNodes[0]))).toEqual({
      kind: 'namespace',
      symbol: result.auth,
    });
  });

  it('reports an unknown name once, on the argument', () => {
    const result = bindIn('namedType', 'db.tagged(Nope)');

    expect(result.diagnostics).toEqual(unknownEntity(result, 'Nope'));
    expect(result.resolutionAt(0)).toEqual({ kind: 'unresolved', name: 'Nope' });
  });

  it('does not resolve the own name of the named type to itself', () => {
    const result = bindIn('namedType', 'db.tagged(Holder)');

    expect(result.diagnostics).toEqual(unknownEntity(result, 'Holder'));
    expect(result.resolutionAt(0)).toEqual({ kind: 'unresolved', name: 'Holder' });
  });
});
