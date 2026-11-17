import { describe, expect, it } from 'vitest';
import { parse } from '../src/parse';
import { PslSources } from '../src/source-file';
import { buildSymbolTable } from '../src/symbol-table';

function build(...texts: string[]) {
  const parsed = texts.map((text, index) => parse(text, `${index}.psl`));
  const documents = parsed.map(({ document }) => document);
  const sources = new PslSources(
    parsed.map(
      ({ document, sources }) => [document.syntax, sources.sourceFileFor(document.syntax)] as const,
    ),
  );
  return {
    ...buildSymbolTable({ documents, sources, defaultNamespaceId: 'public' }),
    documents,
    sources,
  };
}

describe('multiple-document symbol tables', () => {
  it('unites declarations in caller order without rewriting their roots', () => {
    const { symbolTable, diagnostics, documents, sources } = build(
      'model User { address Address }\ntypes { Email = String }',
      'type Address { street String }\nmodel Post { author User }\nnamespace app { model Item { id Int } }\nenum Role { ADMIN }',
    );
    expect(diagnostics).toEqual([]);
    expect(Object.keys(symbolTable.defaultNamespace.models)).toEqual(['User', 'Post']);
    expect(Object.keys(symbolTable.defaultNamespace.compositeTypes)).toEqual(['Address']);
    expect(Object.keys(symbolTable.namedTypes)).toEqual(['Email']);
    expect(Object.keys(symbolTable.namespaces)).toEqual(['public', 'app']);
    expect(Object.keys(symbolTable.defaultNamespace.blocks)).toEqual(['Role']);
    expect(symbolTable.defaultNamespace.models['Post']?.node.syntax.root()).toBe(
      documents[1]?.syntax,
    );
    expect(symbolTable.defaultNamespace.models['User']?.fields['address']?.typeName).toBe(
      'Address',
    );
    expect(
      sources.sourceFileFor(symbolTable.defaultNamespace.compositeTypes['Address']!.node.syntax)
        .filename,
    ).toBe('1.psl');
  });

  it('keeps the first declaration and attributes equal-offset duplicates to the offending file', () => {
    const { symbolTable, diagnostics, documents, sources } = build(
      'model User { id Int }',
      'model User { id Int }',
      'model User { id Int }',
    );
    expect(symbolTable.defaultNamespace.models['User']?.node.syntax.root()).toBe(
      documents[0]?.syntax,
    );
    expect(diagnostics).toEqual([
      {
        filename: '1.psl',
        code: 'PSL_DUPLICATE_DECLARATION',
        message: 'Duplicate declaration of "User"',
        range: { start: { line: 0, character: 6 }, end: { line: 0, character: 10 } },
      },
      {
        filename: '2.psl',
        code: 'PSL_DUPLICATE_DECLARATION',
        message: 'Duplicate declaration of "User"',
        range: { start: { line: 0, character: 6 }, end: { line: 0, character: 10 } },
      },
    ]);
    const reversed = buildSymbolTable({
      documents: [...documents].reverse(),
      sources,
      defaultNamespaceId: 'public',
    });
    expect(reversed.symbolTable.defaultNamespace.models['User']?.node.syntax.root()).toBe(
      documents[2]?.syntax,
    );
    expect(reversed.diagnostics.map(({ filename }) => filename)).toEqual(['1.psl', '0.psl']);
  });

  it('retains local field errors while reopening namespaces across documents', () => {
    const { symbolTable, diagnostics, sources } = build(
      'model User {\n id Int\n id String\n}\nnamespace app { model First { id Int } }',
      'model Post {\n value a.b.c\n}\nnamespace app { model Second { id Int } }',
    );
    expect(
      diagnostics.map(({ code, range, filename }) => ({
        code,
        line: range.start.line,
        filename,
      })),
    ).toEqual([
      { code: 'PSL_DUPLICATE_DECLARATION', line: 2, filename: '0.psl' },
      { code: 'PSL_INVALID_QUALIFIED_TYPE', line: 1, filename: '1.psl' },
    ]);
    const namespace = symbolTable.namespaces['app']!;
    expect(Object.keys(namespace.models)).toEqual(['First', 'Second']);
    expect(
      namespace.declarations.map(({ node }) => sources.sourceFileFor(node.syntax).filename),
    ).toEqual(['0.psl', '1.psl']);
  });

  it('accepts no documents as an empty scope', () => {
    const emptyDefaultNamespace = {
      kind: 'namespace',
      id: 'public',
      name: 'public',
      declarations: [],
      models: {},
      compositeTypes: {},
      blocks: {},
      mixins: {},
    };
    expect(
      buildSymbolTable({
        documents: [],
        sources: new PslSources([]),
        defaultNamespaceId: 'public',
      }),
    ).toEqual({
      symbolTable: {
        defaultNamespace: emptyDefaultNamespace,
        namespaces: { public: emptyDefaultNamespace },
        namedTypes: {},
      },
      diagnostics: [],
    });
  });

  it.each(['', 'model User { id Int }'])(
    'rejects unregistered roots even with identical text: %j',
    (text) => {
      const registered = parse(text, 'same.psl');
      const foreign = parse(text, 'same.psl');
      expect(() =>
        buildSymbolTable({
          documents: [foreign.document],
          sources: registered.sources,
          defaultNamespaceId: 'public',
        }),
      ).toThrow(/No SourceFile registered/);
    },
  );
});
