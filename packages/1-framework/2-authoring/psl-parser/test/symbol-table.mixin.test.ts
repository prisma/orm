import { describe, expect, it } from 'vitest';
import { parse } from '../src/parse';
import { PslSources, type Range } from '../src/source-file';
import { buildSymbolTable } from '../src/symbol-table';

function build(...texts: string[]) {
  const parsed = texts.map((text, index) => parse(text, `${index}.psl`));
  const sources = new PslSources(
    parsed.map(
      ({ document, sources }) => [document.syntax, sources.sourceFileFor(document.syntax)] as const,
    ),
  );
  const result = buildSymbolTable({
    documents: parsed.map(({ document }) => document),
    sources,
    defaultNamespaceId: 'public',
  });
  return {
    ...result,
    symbolTable: result.symbolTable,
    parseDiagnostics: parsed.flatMap(({ diagnostics }) => diagnostics),
  };
}

function rangeOf(source: string, snippet: string, occurrence = 0): Range {
  let offset = -1;
  for (let found = 0; found <= occurrence; found++) offset = source.indexOf(snippet, offset + 1);
  if (offset < 0) throw new Error(`"${snippet}" is not in the source`);
  const before = source.slice(0, offset).split('\n');
  const line = before.length - 1;
  const character = before[line]?.length ?? 0;
  return {
    start: { line, character },
    end: { line, character: character + snippet.length },
  };
}

function lines(...parts: string[]): string {
  return parts.join('\n');
}

describe('buildSymbolTable() given mixin declarations', () => {
  it('collects a mixin of each keyword into the mixins record, with fields or entries', () => {
    const { symbolTable, diagnostics } = build(
      lines(
        'model mixin Timestamps {',
        '  createdAt DateTime @default(now())',
        '  @@index([createdAt])',
        '}',
        'type mixin Geo {',
        '  lat Float',
        '}',
        'enum mixin BaseRoles {',
        '  ADMIN @map("admin")',
        '  USER',
        '}',
        'policy mixin OwnerRead {',
        '  roles = [authenticated]',
        '  @@map("owner")',
        '}',
      ),
    );

    expect(diagnostics).toEqual([]);
    expect(Object.keys(symbolTable.defaultNamespace.mixins)).toEqual([
      'Timestamps',
      'Geo',
      'BaseRoles',
      'OwnerRead',
    ]);
    expect(
      Object.values(symbolTable.defaultNamespace.mixins).map((mixin) => ({
        kind: mixin.kind,
        name: mixin.name,
        keyword: mixin.keyword,
        fields: Object.keys(mixin.fields),
        entries: mixin.entries.map((entry) => entry.key()?.name()),
        attributes: mixin.attributes.map((attribute) => attribute.name),
      })),
    ).toEqual([
      {
        kind: 'mixin',
        name: 'Timestamps',
        keyword: 'model',
        fields: ['createdAt'],
        entries: [],
        attributes: ['index'],
      },
      { kind: 'mixin', name: 'Geo', keyword: 'type', fields: ['lat'], entries: [], attributes: [] },
      {
        kind: 'mixin',
        name: 'BaseRoles',
        keyword: 'enum',
        fields: [],
        entries: ['ADMIN', 'USER'],
        attributes: [],
      },
      {
        kind: 'mixin',
        name: 'OwnerRead',
        keyword: 'policy',
        fields: [],
        entries: ['roles'],
        attributes: ['map'],
      },
    ]);
    expect(Object.keys(symbolTable.defaultNamespace.models)).toEqual([]);
    expect(Object.keys(symbolTable.defaultNamespace.compositeTypes)).toEqual([]);
    expect(Object.keys(symbolTable.defaultNamespace.blocks)).toEqual([]);
  });

  it('keeps the node and the span of a mixin and resolves its fields like model fields', () => {
    const source = 'model mixin Timestamps {\n  createdAt DateTime? @default(now())\n}';
    const mixin = build(source).symbolTable.defaultNamespace.mixins['Timestamps'];

    expect(mixin?.node.name()?.name()).toBe('Timestamps');
    expect(mixin?.span).toEqual({
      start: { offset: 0, line: 1, column: 1 },
      end: { offset: source.length, line: 3, column: 2 },
    });
    expect(mixin?.fields['createdAt']).toMatchObject({
      kind: 'field',
      name: 'createdAt',
      typeName: 'DateTime',
      optional: true,
    });
    expect(mixin?.fields['createdAt']?.attributes.map((attribute) => attribute.name)).toEqual([
      'default',
    ]);
  });

  it('collects a mixin declared in a namespace into that namespace', () => {
    const { symbolTable, diagnostics } = build(
      'namespace auth {\n  model mixin Timestamps {\n    createdAt DateTime\n  }\n}',
    );

    expect(diagnostics).toEqual([]);
    expect(Object.keys(symbolTable.defaultNamespace.mixins)).toEqual([]);
    expect(Object.keys(symbolTable.namespaces['auth']?.mixins ?? {})).toEqual(['Timestamps']);
    expect(Object.keys(symbolTable.namespaces['auth']?.models ?? {})).toEqual([]);
  });

  it('names the mixin as the owner of a field with an invalid qualified type', () => {
    const source = 'model mixin Owned {\n  owner a.b.c.User\n}';
    const { diagnostics } = build(source);

    expect(diagnostics).toEqual([
      {
        code: 'PSL_INVALID_QUALIFIED_TYPE',
        message:
          'Field "Owned.owner" has an invalid qualified type "a.b.c.User"; use at most one namespace qualifier (e.g. "ns.TypeName")',
        filename: '0.psl',
        range: rangeOf(source, 'a.b.c.User'),
      },
    ]);
  });

  it('reports a field declared twice in a mixin at the later field', () => {
    const source = 'model mixin T {\n  a Int\n  a String\n}';
    const { diagnostics, symbolTable } = build(source);

    expect(diagnostics).toEqual([
      {
        code: 'PSL_DUPLICATE_DECLARATION',
        message: 'Duplicate declaration of "a"',
        filename: '0.psl',
        range: rangeOf(source, 'a', 1),
      },
    ]);
    expect(symbolTable.defaultNamespace.mixins['T']?.fields['a']?.typeName).toBe('Int');
  });

  it.each([
    ['a model', 'model User {\n}\nmodel mixin User {\n}', 'models'],
    ['a composite type', 'type User {\n}\nenum mixin User {\n}', 'compositeTypes'],
    ['a block', 'enum User {\n}\nmodel mixin User {\n}', 'blocks'],
    ['another mixin', 'model mixin User {\n}\nenum mixin User {\n}', 'mixins'],
  ] as const)(
    'reports a mixin that shares its name with %s declared first',
    (_kind, source, record) => {
      const { diagnostics, symbolTable } = build(source);

      expect(diagnostics).toEqual([
        {
          code: 'PSL_DUPLICATE_DECLARATION',
          message: 'Duplicate declaration of "User"',
          filename: '0.psl',
          range: rangeOf(source, 'User', 1),
        },
      ]);
      expect(Object.keys(symbolTable.defaultNamespace[record])).toEqual(['User']);
      expect(symbolTable.defaultNamespace.mixins['User']?.keyword).toBe(
        record === 'mixins' ? 'model' : undefined,
      );
    },
  );

  it('reports a declaration that shares its name with a mixin declared first', () => {
    const source = 'model mixin User {\n}\nmodel User {\n}';
    const { diagnostics, symbolTable } = build(source);

    expect(diagnostics).toEqual([
      {
        code: 'PSL_DUPLICATE_DECLARATION',
        message: 'Duplicate declaration of "User"',
        filename: '0.psl',
        range: rangeOf(source, 'User', 1),
      },
    ]);
    expect(Object.keys(symbolTable.defaultNamespace.mixins)).toEqual(['User']);
    expect(Object.keys(symbolTable.defaultNamespace.models)).toEqual([]);
  });

  it('checks a mixin name against the models, types, blocks and mixins of its namespace', () => {
    const source = lines(
      'namespace a {',
      '  model User {',
      '  }',
      '  model mixin User {',
      '  }',
      '  enum mixin Roles {',
      '  }',
      '  enum Roles {',
      '  }',
      '}',
      'namespace b {',
      '  model mixin User {',
      '  }',
      '}',
      'model mixin User {',
      '}',
    );
    const { diagnostics, symbolTable } = build(source);

    expect(diagnostics).toEqual([
      {
        code: 'PSL_DUPLICATE_DECLARATION',
        message: 'Duplicate declaration of "User"',
        filename: '0.psl',
        range: rangeOf(source, 'User', 1),
      },
      {
        code: 'PSL_DUPLICATE_DECLARATION',
        message: 'Duplicate declaration of "Roles"',
        filename: '0.psl',
        range: rangeOf(source, 'Roles', 1),
      },
    ]);
    expect(Object.keys(symbolTable.namespaces['a']?.mixins ?? {})).toEqual(['Roles']);
    expect(Object.keys(symbolTable.namespaces['a']?.blocks ?? {})).toEqual([]);
    expect(Object.keys(symbolTable.namespaces['b']?.mixins ?? {})).toEqual(['User']);
    expect(Object.keys(symbolTable.defaultNamespace.mixins)).toEqual(['User']);
  });
});

describe('buildSymbolTable() given a block that includes a mixin', () => {
  it('keeps only the members written in the block and reports nothing for the inclusion', () => {
    const { symbolTable, diagnostics } = build(
      lines(
        'model mixin Timestamps {',
        '  createdAt DateTime',
        '  @@index([createdAt])',
        '}',
        'enum mixin BaseRoles {',
        '  ADMIN',
        '}',
        'model User {',
        '  id Int',
        '  +Timestamps',
        '  +Missing',
        '  @@map("users")',
        '}',
        'type Address {',
        '  +Timestamps',
        '  street String',
        '}',
        'enum Role {',
        '  +BaseRoles',
        '  GUEST',
        '}',
      ),
    );

    expect(diagnostics).toEqual([]);
    expect(Object.keys(symbolTable.defaultNamespace.models['User']?.fields ?? {})).toEqual(['id']);
    expect(
      symbolTable.defaultNamespace.models['User']?.attributes.map((attribute) => attribute.name),
    ).toEqual(['map']);
    expect(
      Object.keys(symbolTable.defaultNamespace.compositeTypes['Address']?.fields ?? {}),
    ).toEqual(['street']);
    expect(
      symbolTable.defaultNamespace.blocks['Role']?.entries.map((entry) => entry.key()?.name()),
    ).toEqual(['GUEST']);
  });
});
