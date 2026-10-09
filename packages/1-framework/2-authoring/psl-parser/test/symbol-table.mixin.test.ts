import { describe, expect, it } from 'vitest';
import { parse } from '../src/parse';
import { buildSymbolTable } from '../src/symbol-table';

function build(source: string) {
  const { document, sources } = parse(source, 'test.psl');
  const result = buildSymbolTable({ documents: [document], sources });
  const lines = source.split('\n');
  const reported = result.diagnostics.map(({ code, message, range }) => ({
    code,
    message,
    text: (lines[range.start.line] ?? '').slice(range.start.character, range.end.character),
    line: range.start.line,
  }));
  return { ...result, reported };
}

const NOT_SUPPORTED = { code: 'PSL_INVALID_DECLARATION', message: 'Mixins are not supported yet' };

describe('buildSymbolTable() given mixin declarations', () => {
  const source = [
    'model mixin Timestamps {',
    '  createdAt DateTime',
    '}',
    'type mixin Geo {',
    '  lat Float',
    '}',
    'enum mixin BaseRoles {',
    '  ADMIN',
    '}',
    'policy mixin OwnerRead {',
    '  k = 1',
    '}',
    'model User {',
    '  id Int',
    '}',
  ].join('\n');

  it('keeps top-level mixins out of every record', () => {
    const { topLevel } = build(source).symbolTable;

    expect(Object.keys(topLevel.models)).toEqual(['User']);
    expect(Object.keys(topLevel.compositeTypes)).toEqual([]);
    expect(Object.keys(topLevel.blocks)).toEqual([]);
    expect(Object.keys(topLevel.namedTypes)).toEqual([]);
    expect(Object.keys(topLevel.namespaces)).toEqual([]);
  });

  it('keeps mixins in a namespace out of every record', () => {
    const indented = source
      .split('\n')
      .map((line) => `  ${line}`)
      .join('\n');
    const namespace = build(`namespace auth {\n${indented}\n}`).symbolTable.topLevel.namespaces[
      'auth'
    ];

    expect(Object.keys(namespace?.models ?? {})).toEqual(['User']);
    expect(Object.keys(namespace?.compositeTypes ?? {})).toEqual([]);
    expect(Object.keys(namespace?.blocks ?? {})).toEqual([]);
  });

  it('reports each mixin declaration once, at its name', () => {
    expect(build(source).reported).toEqual([
      { ...NOT_SUPPORTED, text: 'Timestamps', line: 0 },
      { ...NOT_SUPPORTED, text: 'Geo', line: 3 },
      { ...NOT_SUPPORTED, text: 'BaseRoles', line: 6 },
      { ...NOT_SUPPORTED, text: 'OwnerRead', line: 9 },
    ]);
  });

  it('reports a mixin declaration in a namespace once, at its name', () => {
    expect(build('namespace auth {\n  model mixin Timestamps {\n  }\n}').reported).toEqual([
      { ...NOT_SUPPORTED, text: 'Timestamps', line: 1 },
    ]);
  });

  it('reports a mixin declaration with no name at the mixin word', () => {
    expect(build('model mixin {\n  id Int\n}').reported).toEqual([
      { ...NOT_SUPPORTED, text: 'mixin', line: 0 },
    ]);
  });

  it('raises no duplicate diagnostic for a mixin that shares a name with a model', () => {
    const before = build('model mixin User {\n}\nmodel User {\n  id Int\n}');
    const after = build('model User {\n  id Int\n}\nmodel mixin User {\n}');

    expect(before.reported).toEqual([{ ...NOT_SUPPORTED, text: 'User', line: 0 }]);
    expect(after.reported).toEqual([{ ...NOT_SUPPORTED, text: 'User', line: 3 }]);
    expect(Object.keys(before.symbolTable.topLevel.models)).toEqual(['User']);
    expect(Object.keys(after.symbolTable.topLevel.models)).toEqual(['User']);
  });

  it('raises no duplicate diagnostic for a namespaced mixin that shares a name with a model', () => {
    const before = build('namespace a {\n  model mixin User {\n  }\n  model User {\n  }\n}');
    const after = build('namespace a {\n  model User {\n  }\n  model mixin User {\n  }\n}');

    expect(before.reported).toEqual([{ ...NOT_SUPPORTED, text: 'User', line: 1 }]);
    expect(after.reported).toEqual([{ ...NOT_SUPPORTED, text: 'User', line: 3 }]);
    expect(Object.keys(before.symbolTable.topLevel.namespaces['a']?.models ?? {})).toEqual([
      'User',
    ]);
  });

  it('raises no duplicate diagnostic for two mixins that share a name', () => {
    expect(build('model mixin T {\n}\nenum mixin T {\n}').reported).toEqual([
      { ...NOT_SUPPORTED, text: 'T', line: 0 },
      { ...NOT_SUPPORTED, text: 'T', line: 2 },
    ]);
  });
});

describe('buildSymbolTable() given mixin inclusions', () => {
  it('reports each named inclusion once, in a model, a composite type, a block and a namespace', () => {
    const { reported, symbolTable } = build(
      [
        'model User {',
        '  id Int',
        '  +Timestamps',
        '  +auth.Audited',
        '}',
        'type Address {',
        '  +Geo',
        '}',
        'enum Role {',
        '  +BaseRoles',
        '  GUEST',
        '}',
        'namespace app {',
        '  policy P {',
        '    +Shared',
        '  }',
        '}',
      ].join('\n'),
    );

    expect(reported).toEqual([
      { ...NOT_SUPPORTED, text: '+Timestamps', line: 2 },
      { ...NOT_SUPPORTED, text: '+auth.Audited', line: 3 },
      { ...NOT_SUPPORTED, text: '+Geo', line: 6 },
      { ...NOT_SUPPORTED, text: '+BaseRoles', line: 9 },
      { ...NOT_SUPPORTED, text: '+Shared', line: 14 },
    ]);
    expect(Object.keys(symbolTable.topLevel.models['User']?.fields ?? {})).toEqual(['id']);
    expect(symbolTable.topLevel.blocks['Role']?.entries.map((e) => e.key()?.name())).toEqual([
      'GUEST',
    ]);
  });

  it('reports an inclusion inside a mixin body once, after the mixin itself', () => {
    expect(build('model mixin Audited {\n  +Timestamps\n}').reported).toEqual([
      { ...NOT_SUPPORTED, text: 'Audited', line: 0 },
      { ...NOT_SUPPORTED, text: '+Timestamps', line: 1 },
    ]);
  });

  it('reports nothing for an inclusion with no name', () => {
    expect(build('model User {\n  +\n  id Int\n}').reported).toEqual([]);
  });
});
