import { describe, expect, it } from 'vitest';
import { parse } from '../src/parse';
import { PslSources } from '../src/source-file';
import { buildSymbolTable } from '../src/symbol-table';

function build(defaultNamespaceId: string, ...texts: string[]) {
  const parsed = texts.map((text, index) => parse(text, `${index}.psl`));
  const sources = new PslSources(
    parsed.map(
      ({ document, sources }) => [document.syntax, sources.sourceFileFor(document.syntax)] as const,
    ),
  );
  return buildSymbolTable({
    documents: parsed.map(({ document }) => document),
    sources,
    defaultNamespaceId,
  });
}

const duplicate = (name: string) => `Duplicate declaration of "${name}"`;
const messages = (result: ReturnType<typeof build>) =>
  result.diagnostics.map(({ code, message }) => `${code}: ${message}`);

describe('buildSymbolTable() — the default namespace', () => {
  it('exists without a written block and holds the top-level declarations', () => {
    const { symbolTable, diagnostics } = build(
      'public',
      'model User { id Int }\ntype Address { street String }\npolicy Rule {}\ntypes {\n  Email = String\n}',
    );
    const { defaultNamespace } = symbolTable;

    expect(diagnostics).toEqual([]);
    expect(Object.keys(symbolTable).sort().join()).toBe('defaultNamespace,namedTypes,namespaces');
    expect(symbolTable.namespaces).toEqual({ public: defaultNamespace });
    expect(defaultNamespace).toMatchObject({ kind: 'namespace', id: 'public', name: 'public' });
    expect(defaultNamespace.declarations).toEqual([]);
    expect(Object.keys(defaultNamespace.models)).toEqual(['User']);
    expect(Object.keys(defaultNamespace.compositeTypes)).toEqual(['Address']);
    expect(Object.keys(defaultNamespace.blocks)).toEqual(['Rule']);
    expect(Object.keys(symbolTable.namedTypes)).toEqual(['Email']);
  });

  it.each([
    ['public', 'public', 'public'],
    ['__unbound__', 'unbound', 'unbound'],
  ])(
    'with default %s, merges the members of "namespace %s" with top-level ones',
    (id, written, name) => {
      const { symbolTable, diagnostics } = build(
        id,
        `model A { id Int }\nnamespace ${written} {\n  model B { id Int }\n  policy C {}\n}`,
        `namespace ${written} {\n  type D { value Int }\n}`,
      );
      const { defaultNamespace } = symbolTable;

      expect(diagnostics).toEqual([]);
      expect(Object.keys(symbolTable.namespaces)).toEqual([id]);
      expect(defaultNamespace).toMatchObject({ id, name });
      expect(defaultNamespace.declarations).toHaveLength(2);
      expect(Object.keys(defaultNamespace.models)).toEqual(['A', 'B']);
      expect(Object.keys(defaultNamespace.blocks)).toEqual(['C']);
      expect(Object.keys(defaultNamespace.compositeTypes)).toEqual(['D']);
    },
  );

  it.each([
    ['model A { id Int }\nnamespace public {\n  model A { other Int }\n}', 'id'],
    ['namespace public {\n  model A { other Int }\n}\nmodel A { id Int }', 'other'],
  ])(
    'keeps the first of a top-level model and a default-block model of one name: %j',
    (source, kept) => {
      const result = build('public', source);

      expect(messages(result)).toEqual([`PSL_DUPLICATE_DECLARATION: ${duplicate('A')}`]);
      expect(Object.keys(result.symbolTable.defaultNamespace.models['A']?.fields ?? {})).toEqual([
        kept,
      ]);
    },
  );

  it.each([
    ['public', 'model public { id Int }', duplicate('public')],
    ['public', 'type public { value Int }', duplicate('public')],
    ['public', 'policy public {}', duplicate('public')],
    ['public', 'types {\n  public = String\n}', duplicate('public')],
    ['__unbound__', 'model unbound { id Int }', duplicate('unbound')],
    ['__unbound__', 'model __unbound__ { id Int }', duplicate('__unbound__')],
  ])(
    'with default %s, rejects a top-level declaration that takes its name: %j',
    (id, source, message) => {
      const { symbolTable, diagnostics } = build(id, source);

      expect(diagnostics.map((diagnostic) => diagnostic.message)).toEqual([message]);
      expect(diagnostics[0]?.code).toBe('PSL_DUPLICATE_DECLARATION');
      expect(symbolTable.defaultNamespace.models).toEqual({});
      expect(symbolTable.namedTypes).toEqual({});
    },
  );

  it.each([
    [['namespace public {}', 'model public { id Int }'], '1.psl'],
    [['model public { id Int }', 'namespace public {}'], '0.psl'],
  ])(
    'reports the model, in its own file, when the block of that name is in another document: %j',
    (texts, filename) => {
      const { symbolTable, diagnostics } = build('public', ...texts);

      expect(diagnostics).toEqual([
        {
          code: 'PSL_DUPLICATE_DECLARATION',
          message: duplicate('public'),
          filename,
          range: { start: { line: 0, character: 6 }, end: { line: 0, character: 12 } },
        },
      ]);
      expect(symbolTable.defaultNamespace.models).toEqual({});
    },
  );

  it.each([
    ['types {\n  Email = String\n}\nnamespace public {\n  model Email {}\n}', 'Email'],
    ['namespace auth {}\nnamespace public {\n  model auth {}\n}', 'auth'],
    ['namespace public {\n  model auth {}\n}\nnamespace auth {}', 'auth'],
    ['namespace public {\n  model public {}\n}', 'public'],
  ])('gives a default-block member a document-level name: %j', (source, name) => {
    expect(messages(build('public', source))).toEqual([
      `PSL_DUPLICATE_DECLARATION: ${duplicate(name)}`,
    ]);
  });
});

describe('buildSymbolTable() — the late-bound namespace under another default', () => {
  it('reads "namespace unbound" and "namespace __unbound__" as one namespace', () => {
    const { symbolTable, diagnostics } = build(
      'public',
      'namespace unbound {\n  model A { id Int }\n}\nnamespace __unbound__ {\n  model B { id Int }\n  model A { other Int }\n}',
    );
    const unbound = symbolTable.namespaces['__unbound__'];

    expect(messages({ symbolTable, diagnostics })).toEqual([
      `PSL_DUPLICATE_DECLARATION: ${duplicate('A')}`,
    ]);
    expect(Object.keys(symbolTable.namespaces)).toEqual(['public', '__unbound__']);
    expect(unbound).toMatchObject({ id: '__unbound__', name: 'unbound' });
    expect(unbound?.declarations).toHaveLength(2);
    expect(Object.keys(unbound?.models ?? {})).toEqual(['A', 'B']);
    expect(Object.keys(unbound?.models['A']?.fields ?? {})).toEqual(['id']);
  });

  it.each([
    ['namespace unbound {}\nmodel __unbound__ {}', [duplicate('__unbound__')]],
    ['model unbound {}\nnamespace __unbound__ {}', [duplicate('__unbound__')]],
    ['model unbound {}\nmodel __unbound__ {}', []],
  ])(
    'takes both spellings at document level only once a block is written: %j',
    (source, expected) => {
      expect(build('public', source).diagnostics.map(({ message }) => message)).toEqual(expected);
    },
  );
});
