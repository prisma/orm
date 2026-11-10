import { describe, expect, it } from 'vitest';
import type { FieldSymbol, NamedTypeSymbol } from '../src/symbol-table';
import { PathExprAst } from '../src/syntax/ast/expressions';
import type { SyntaxNode } from '../src/syntax/red';
import { bindProject } from './binder-contributed-types.helpers';

function argumentNode(
  holder: FieldSymbol | NamedTypeSymbol | undefined,
  index = 0,
): SyntaxNode | undefined {
  return holder?.typeConstructor?.args[index]?.expression?.syntax;
}

const entities =
  'tag TopTag {}\nmodel TopModel {\n  id String\n}\nnamespace auth {\n  tag AuthTag {}\n}\n';

describe('createBinder — entity argument of a type constructor', () => {
  it('binds a name in scope to the block it names', () => {
    const { symbolTable, binder, diagnostics } = bindProject(
      `${entities}model Post {\n  value db.tagged(TopTag)\n}`,
    );
    const argument = argumentNode(symbolTable.defaultNamespace.models['Post']?.fields['value']);

    expect(diagnostics).toEqual([]);
    expect(argument && binder.symbolForNode(argument)).toEqual({
      kind: 'block',
      symbol: symbolTable.defaultNamespace.blocks['TopTag'],
      namespace: symbolTable.defaultNamespace,
    });
  });

  it('binds a name that is a model, without checking the kind', () => {
    const { symbolTable, binder, diagnostics } = bindProject(
      `${entities}model Post {\n  value db.tagged(TopModel)\n}`,
    );
    const argument = argumentNode(symbolTable.defaultNamespace.models['Post']?.fields['value']);

    expect(diagnostics).toEqual([]);
    expect(argument && binder.symbolForNode(argument)).toEqual({
      kind: 'model',
      symbol: symbolTable.defaultNamespace.models['TopModel'],
      namespace: symbolTable.defaultNamespace,
    });
  });

  it('binds a qualified name to the member, and its qualifier to the namespace', () => {
    const { symbolTable, binder, diagnostics } = bindProject(
      `${entities}model Post {\n  value db.tagged(auth.AuthTag)\n}`,
    );
    const argument = argumentNode(symbolTable.defaultNamespace.models['Post']?.fields['value']);
    const [qualifier] = (argument && PathExprAst.cast(argument)?.segments()) ?? [];

    expect(diagnostics).toEqual([]);
    expect(argument && binder.symbolForNode(argument)).toEqual({
      kind: 'block',
      symbol: symbolTable.namespaces['auth']?.blocks['AuthTag'],
      namespace: symbolTable.namespaces['auth'],
    });
    expect(qualifier && binder.symbolForNode(qualifier.syntax)).toEqual({
      kind: 'namespace',
      symbol: symbolTable.namespaces['auth'],
    });
  });

  it('reports an unknown name once, on the argument, and records it as unresolved', () => {
    const { symbolTable, binder, diagnostics, sources } = bindProject(
      `${entities}model Post {\n  value db.tagged(Nope)\n}`,
    );
    const argument = argumentNode(symbolTable.defaultNamespace.models['Post']?.fields['value']);
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
    const argument = argumentNode(symbolTable.defaultNamespace.models['Post']?.fields['value']);

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
    const argument = argumentNode(symbolTable.defaultNamespace.models['Post']?.fields['value'], 1);

    expect(diagnostics).toEqual([]);
    expect(argument && binder.symbolForNode(argument)).toEqual({
      kind: 'block',
      symbol: symbolTable.defaultNamespace.blocks['TopTag'],
      namespace: symbolTable.defaultNamespace,
    });
  });

  it('counts positional arguments only when named arguments are mixed in', () => {
    const { symbolTable, binder, diagnostics } = bindProject(
      `${entities}model Post {\n  value db.secondTagged(TopModel, extra: TopModel, TopTag)\n}`,
    );
    const argument = argumentNode(symbolTable.defaultNamespace.models['Post']?.fields['value'], 2);

    expect(diagnostics).toEqual([]);
    expect(argument && binder.symbolForNode(argument)).toEqual({
      kind: 'block',
      symbol: symbolTable.defaultNamespace.blocks['TopTag'],
      namespace: symbolTable.defaultNamespace,
    });
  });

  it('records nothing for a string', () => {
    const { symbolTable, binder, diagnostics } = bindProject(
      `${entities}model Post {\n  value db.tagged("TopTag")\n}`,
    );
    const argument = argumentNode(symbolTable.defaultNamespace.models['Post']?.fields['value']);

    expect(diagnostics).toEqual([]);
    expect(argument && binder.symbolForNode(argument)).toBeUndefined();
  });

  it('records nothing for a number', () => {
    const { symbolTable, binder, diagnostics } = bindProject(
      `${entities}model Post {\n  value db.tagged(1)\n}`,
    );
    const argument = argumentNode(symbolTable.defaultNamespace.models['Post']?.fields['value']);

    expect(diagnostics).toEqual([]);
    expect(argument && binder.symbolForNode(argument)).toBeUndefined();
  });

  it('records nothing for a path of three segments', () => {
    const { symbolTable, binder, diagnostics } = bindProject(
      `${entities}model Post {\n  value db.tagged(auth.AuthTag.more)\n}`,
    );
    const argument = argumentNode(symbolTable.defaultNamespace.models['Post']?.fields['value']);

    expect(diagnostics).toEqual([]);
    expect(argument && binder.symbolForNode(argument)).toBeUndefined();
  });

  it('records nothing for a named argument', () => {
    const { symbolTable, binder, diagnostics } = bindProject(
      `${entities}model Post {\n  value db.tagged(tag: TopTag)\n}`,
    );
    const argument = argumentNode(symbolTable.defaultNamespace.models['Post']?.fields['value']);

    expect(diagnostics).toEqual([]);
    expect(argument && binder.symbolForNode(argument)).toBeUndefined();
  });

  it('records nothing for an empty argument list', () => {
    const { symbolTable, binder, diagnostics } = bindProject(
      `${entities}model Post {\n  value db.tagged()\n}`,
    );
    const argument = argumentNode(symbolTable.defaultNamespace.models['Post']?.fields['value']);

    expect(diagnostics).toEqual([]);
    expect(argument && binder.symbolForNode(argument)).toBeUndefined();
  });

  it('records nothing for the arguments of a constructor that declares no entity argument', () => {
    const { symbolTable, binder, diagnostics } = bindProject(
      `${entities}model Post {\n  value db.VarChar(TopTag)\n}`,
    );
    const argument = argumentNode(symbolTable.defaultNamespace.models['Post']?.fields['value']);

    expect(diagnostics).toEqual([]);
    expect(argument && binder.symbolForNode(argument)).toBeUndefined();
  });

  it('binds a name of the namespace of a model declared in a namespace', () => {
    const { symbolTable, binder, diagnostics } = bindProject(
      `${entities}namespace auth {\n  model Post {\n    value db.tagged(AuthTag)\n  }\n}`,
    );
    const argument = argumentNode(symbolTable.namespaces['auth']?.models['Post']?.fields['value']);

    expect(diagnostics).toEqual([]);
    expect(argument && binder.symbolForNode(argument)).toEqual({
      kind: 'block',
      symbol: symbolTable.namespaces['auth']?.blocks['AuthTag'],
      namespace: symbolTable.namespaces['auth'],
    });
  });

  it('binds a top-level name from a model declared in a namespace', () => {
    const { symbolTable, binder, diagnostics } = bindProject(
      `${entities}namespace auth {\n  model Post {\n    value db.tagged(TopTag)\n  }\n}`,
    );
    const argument = argumentNode(symbolTable.namespaces['auth']?.models['Post']?.fields['value']);

    expect(diagnostics).toEqual([]);
    expect(argument && binder.symbolForNode(argument)).toEqual({
      kind: 'block',
      symbol: symbolTable.defaultNamespace.blocks['TopTag'],
      namespace: symbolTable.defaultNamespace,
    });
  });

  it('binds a qualified name and its qualifier from a model declared in a namespace', () => {
    const { symbolTable, binder, diagnostics } = bindProject(
      `${entities}namespace auth {\n  model Post {\n    value db.tagged(auth.AuthTag)\n  }\n}`,
    );
    const argument = argumentNode(symbolTable.namespaces['auth']?.models['Post']?.fields['value']);
    const [qualifier] = (argument && PathExprAst.cast(argument)?.segments()) ?? [];

    expect(diagnostics).toEqual([]);
    expect(argument && binder.symbolForNode(argument)).toEqual({
      kind: 'block',
      symbol: symbolTable.namespaces['auth']?.blocks['AuthTag'],
      namespace: symbolTable.namespaces['auth'],
    });
    expect(qualifier && binder.symbolForNode(qualifier.syntax)).toEqual({
      kind: 'namespace',
      symbol: symbolTable.namespaces['auth'],
    });
  });

  it('reports an unknown name from a model declared in a namespace', () => {
    const { symbolTable, binder, diagnostics } = bindProject(
      `${entities}namespace auth {\n  model Post {\n    value db.tagged(Nope)\n  }\n}`,
    );
    const argument = argumentNode(symbolTable.namespaces['auth']?.models['Post']?.fields['value']);

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
    const argument = argumentNode(
      symbolTable.defaultNamespace.compositeTypes['Address']?.fields['value'],
    );

    expect(diagnostics).toEqual([]);
    expect(argument && binder.symbolForNode(argument)).toEqual({
      kind: 'block',
      symbol: symbolTable.defaultNamespace.blocks['TopTag'],
      namespace: symbolTable.defaultNamespace,
    });
  });

  it('binds a qualified name and its qualifier from a field of a composite type', () => {
    const { symbolTable, binder, diagnostics } = bindProject(
      `${entities}type Address {\n  value db.tagged(auth.AuthTag)\n}`,
    );
    const argument = argumentNode(
      symbolTable.defaultNamespace.compositeTypes['Address']?.fields['value'],
    );
    const [qualifier] = (argument && PathExprAst.cast(argument)?.segments()) ?? [];

    expect(diagnostics).toEqual([]);
    expect(argument && binder.symbolForNode(argument)).toEqual({
      kind: 'block',
      symbol: symbolTable.namespaces['auth']?.blocks['AuthTag'],
      namespace: symbolTable.namespaces['auth'],
    });
    expect(qualifier && binder.symbolForNode(qualifier.syntax)).toEqual({
      kind: 'namespace',
      symbol: symbolTable.namespaces['auth'],
    });
  });

  it('reports an unknown name from a field of a composite type', () => {
    const { symbolTable, binder, diagnostics } = bindProject(
      `${entities}type Address {\n  value db.tagged(Nope)\n}`,
    );
    const argument = argumentNode(
      symbolTable.defaultNamespace.compositeTypes['Address']?.fields['value'],
    );

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
    const argument = argumentNode(symbolTable.namedTypes['Alias']);

    expect(diagnostics).toEqual([]);
    expect(argument && binder.symbolForNode(argument)).toEqual({
      kind: 'block',
      symbol: symbolTable.defaultNamespace.blocks['TopTag'],
      namespace: symbolTable.defaultNamespace,
    });
  });

  it('binds a name of a namespace when it is qualified, from a named type', () => {
    const { symbolTable, binder, diagnostics } = bindProject(
      `${entities}types {\n  Alias = db.tagged(auth.AuthTag)\n}`,
    );
    const argument = argumentNode(symbolTable.namedTypes['Alias']);
    const [qualifier] = (argument && PathExprAst.cast(argument)?.segments()) ?? [];

    expect(diagnostics).toEqual([]);
    expect(argument && binder.symbolForNode(argument)).toEqual({
      kind: 'block',
      symbol: symbolTable.namespaces['auth']?.blocks['AuthTag'],
      namespace: symbolTable.namespaces['auth'],
    });
    expect(qualifier && binder.symbolForNode(qualifier.syntax)).toEqual({
      kind: 'namespace',
      symbol: symbolTable.namespaces['auth'],
    });
  });

  it('reports an unknown name from a named type', () => {
    const { symbolTable, binder, diagnostics } = bindProject(
      `${entities}types {\n  Alias = db.tagged(Nope)\n}`,
    );
    const argument = argumentNode(symbolTable.namedTypes['Alias']);

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
    const argument = argumentNode(symbolTable.namedTypes['Alias']);

    expect(diagnostics.map(({ code, message }) => ({ code, message }))).toEqual([
      { code: 'PSL_UNRESOLVED_REFERENCE', message: 'Cannot find entity "Alias"' },
    ]);
    expect(argument && binder.symbolForNode(argument)).toEqual({
      kind: 'unresolved',
      name: 'Alias',
    });
  });
});
