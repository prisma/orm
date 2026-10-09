import type {
  AuthoringTypeConstructorDescriptor,
  AuthoringTypeNamespace,
} from '@internal/framework-components/authoring';
import { describe, expect, it } from 'vitest';
import { createBinder, typeReferenceNode } from '../src/binder';
import { parse } from '../src/parse';
import { PslSources, type Range } from '../src/source-file';
import { buildSymbolTable } from '../src/symbol-table';
import type { MixinInclusionAst } from '../src/syntax/ast/declarations';
import { binderContext } from './support';

const scalar: AuthoringTypeConstructorDescriptor = {
  kind: 'typeConstructor',
  output: { codecId: 'fixture/scalar@1' },
};

const TYPE_CONSTRUCTORS: AuthoringTypeNamespace = { String: scalar, Int: scalar };

function bind(...texts: string[]) {
  const parsed = texts.map((text, index) => parse(text, `${index}.psl`));
  const sources = new PslSources(
    parsed.map(
      ({ document, sources }) => [document.syntax, sources.sourceFileFor(document.syntax)] as const,
    ),
  );
  const table = buildSymbolTable({ documents: parsed.map(({ document }) => document), sources });
  return {
    topLevel: table.symbolTable.topLevel,
    tableDiagnostics: table.diagnostics,
    ...createBinder({
      sources,
      symbolTable: table.symbolTable,
      context: binderContext({ contributedTypes: TYPE_CONSTRUCTORS }),
    }),
  };
}

function rangeOf(source: string, snippet: string, occurrence = 0): Range {
  let offset = -1;
  for (let found = 0; found <= occurrence; found++) offset = source.indexOf(snippet, offset + 1);
  if (offset < 0) throw new Error(`"${snippet}" is not in the source`);
  const before = source.slice(0, offset).split('\n');
  const line = before.length - 1;
  const character = before[line]?.length ?? 0;
  return { start: { line, character }, end: { line, character: character + snippet.length } };
}

function inclusionsOf(holder: {
  readonly node: { inclusions(): Iterable<MixinInclusionAst> };
}): MixinInclusionAst[] {
  return Array.from(holder.node.inclusions());
}

describe('createBinder — a mixin declaration', () => {
  it('is the declared symbol of its node, at the top level and in a namespace', () => {
    const { binder, topLevel } = bind(
      'model mixin Timestamps {\n  createdAt Int\n}\nnamespace auth {\n  enum mixin BaseRoles {\n    ADMIN\n  }\n}',
    );
    const timestamps = topLevel.mixins['Timestamps']!;
    const auth = topLevel.namespaces['auth']!;
    const baseRoles = auth.mixins['BaseRoles']!;

    expect(binder.declaredSymbol(timestamps.node.syntax)).toBe(timestamps);
    expect(binder.declaredSymbol(baseRoles.node.syntax)).toBe(baseRoles);
    expect(binder.symbolForNode(timestamps.node.name()!.syntax)).toEqual({
      kind: 'mixin',
      symbol: timestamps,
    });
    expect(binder.symbolForNode(baseRoles.node.name()!.syntax)).toEqual({
      kind: 'mixin',
      symbol: baseRoles,
      namespace: auth,
    });
  });
});

describe('createBinder — the name of an inclusion', () => {
  it('resolves an unqualified name to the mixin', () => {
    const { binder, topLevel, diagnostics } = bind(
      'model mixin Timestamps {\n  createdAt Int\n}\nmodel User {\n  id Int\n  +Timestamps\n}',
    );
    const [inclusion] = inclusionsOf(topLevel.models['User']!);

    expect(diagnostics).toEqual([]);
    expect(binder.symbolForNode(inclusion!.name()!.syntax)).toEqual({
      kind: 'mixin',
      symbol: topLevel.mixins['Timestamps'],
    });
  });

  it('resolves a qualified name to the mixin and its qualifier to the namespace', () => {
    const { binder, topLevel, diagnostics } = bind(
      'namespace auth {\n  model mixin Timestamps {\n    createdAt Int\n  }\n}\nmodel User {\n  +auth.Timestamps\n}',
    );
    const auth = topLevel.namespaces['auth']!;
    const name = inclusionsOf(topLevel.models['User']!)[0]!.name()!;

    expect(diagnostics).toEqual([]);
    expect(binder.symbolForNode(name.syntax)).toEqual({
      kind: 'mixin',
      symbol: auth.mixins['Timestamps'],
      namespace: auth,
    });
    expect(binder.symbolForNode(name.namespace()!.syntax)).toEqual({
      kind: 'namespace',
      symbol: auth,
    });
  });

  it('resolves a name through the namespace of the including block before the top level', () => {
    const { binder, topLevel } = bind(
      'enum mixin R {\n  TOP\n}\nnamespace auth {\n  enum mixin R {\n    ADMIN\n  }\n  enum Role {\n    +R\n  }\n}\nenum Role {\n  +R\n}',
    );
    const auth = topLevel.namespaces['auth']!;

    expect(binder.symbolForNode(inclusionsOf(auth.blocks['Role']!)[0]!.name()!.syntax)).toEqual({
      kind: 'mixin',
      symbol: auth.mixins['R'],
      namespace: auth,
    });
    expect(binder.symbolForNode(inclusionsOf(topLevel.blocks['Role']!)[0]!.name()!.syntax)).toEqual(
      { kind: 'mixin', symbol: topLevel.mixins['R'] },
    );
  });

  it('resolves the name of an inclusion in a composite type and in another document', () => {
    const { binder, topLevel, diagnostics } = bind(
      'type Address {\n  +Geo\n}',
      'type mixin Geo {\n  lat Int\n}',
    );

    expect(diagnostics).toEqual([]);
    expect(
      binder.symbolForNode(inclusionsOf(topLevel.compositeTypes['Address']!)[0]!.name()!.syntax),
    ).toEqual({ kind: 'mixin', symbol: topLevel.mixins['Geo'] });
  });

  it('still resolves a name the symbol table refused for its keyword or for a repeat', () => {
    const { binder, topLevel, diagnostics, tableDiagnostics } = bind(
      'enum mixin R {\n  A\n}\nmodel mixin T {\n  a Int\n}\nmodel User {\n  +R\n  +T\n  +T\n}',
    );
    const resolved = inclusionsOf(topLevel.models['User']!).map((inclusion) =>
      binder.symbolForNode(inclusion.name()!.syntax),
    );

    expect(tableDiagnostics).toHaveLength(2);
    expect(diagnostics).toEqual([]);
    expect(resolved).toEqual([
      { kind: 'mixin', symbol: topLevel.mixins['R'] },
      { kind: 'mixin', symbol: topLevel.mixins['T'] },
      { kind: 'mixin', symbol: topLevel.mixins['T'] },
    ]);
  });

  it('records a name the symbol table could not place as unresolved, with no second diagnostic', () => {
    const { binder, topLevel, diagnostics, tableDiagnostics } = bind(
      'model Target {\n  id Int\n}\nnamespace ns {\n}\nmodel User {\n  +Missing\n  +Target\n  +other:T\n  +ns.Missing\n  +nowhere.T\n}',
    );
    const names = inclusionsOf(topLevel.models['User']!).map((inclusion) => inclusion.name()!);

    expect(tableDiagnostics).toHaveLength(5);
    expect(diagnostics).toEqual([]);
    expect(names.map((name) => binder.symbolForNode(name.syntax))).toEqual([
      { kind: 'unresolved', name: 'Missing' },
      { kind: 'unresolved', name: 'Target' },
      { kind: 'unresolved', name: 'other:T' },
      { kind: 'unresolved', name: 'ns.Missing' },
      { kind: 'unresolved', name: 'nowhere.T' },
    ]);
    expect(binder.symbolForNode(names[3]!.namespace()!.syntax)).toEqual({
      kind: 'namespace',
      symbol: topLevel.namespaces['ns'],
    });
    expect(binder.symbolForNode(names[4]!.namespace()!.syntax)).toBeUndefined();
  });
});

describe('createBinder — a mixin name in type position', () => {
  it('rejects a field typed with a mixin, at the type name', () => {
    const source =
      'model mixin Timestamps {\n  createdAt Int\n}\nmodel User {\n  id Int\n  stamps Timestamps\n}';
    const { binder, topLevel, diagnostics } = bind(source);

    expect(diagnostics).toEqual([
      {
        code: 'PSL_UNRESOLVED_REFERENCE',
        message:
          '"Timestamps" is a mixin; a type reference must name a model, composite type, enum, or named type',
        data: { reference: 'type', name: 'Timestamps', constructorCall: false },
        filename: '0.psl',
        range: rangeOf(source, 'Timestamps', 1),
      },
    ]);
    expect(
      binder.symbolForNode(typeReferenceNode(topLevel.models['User']!.fields['stamps']!)!),
    ).toEqual({ kind: 'mixin', symbol: topLevel.mixins['Timestamps'] });
  });

  it('rejects a field typed with a qualified mixin name', () => {
    const source =
      'namespace auth {\n  model mixin Timestamps {\n  }\n}\nmodel User {\n  stamps auth.Timestamps\n}';
    const { diagnostics } = bind(source);

    expect(diagnostics.map(({ code, message, range }) => ({ code, message, range }))).toEqual([
      {
        code: 'PSL_UNRESOLVED_REFERENCE',
        message:
          '"auth.Timestamps" is a mixin; a type reference must name a model, composite type, enum, or named type',
        range: rangeOf(source, 'auth.Timestamps'),
      },
    ]);
  });

  it('rejects a named type whose base is a mixin, at the base name', () => {
    const source = 'model mixin Timestamps {\n}\ntypes {\n  Stamps = Timestamps\n}';
    const { diagnostics } = bind(source);

    expect(
      diagnostics.map(({ code, message, filename, range }) => ({ code, message, filename, range })),
    ).toEqual([
      {
        code: 'PSL_UNRESOLVED_REFERENCE',
        message:
          '"Timestamps" is a mixin; a type reference must name a model, composite type, enum, or named type',
        filename: '0.psl',
        range: rangeOf(source, 'Timestamps', 1),
      },
    ]);
  });
});
