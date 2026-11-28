import { deepStrictEqual, match, strictEqual } from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import {
  checkValueSets,
  DECLARATIONS_FILE,
  findValueSets,
  readDeclarations,
  readPublishedLists,
} from './value-sets.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const api = (...lines) => `# header\n${lines.join('\n')}\n`;

const PACKAGE = '@prisma/orm-example';

describe('findValueSets', () => {
  it('finds a union of string literals once, with every path that exports it', () => {
    const sets = findValueSets(
      api(
        "./a: type Code = 'A' | 'B'",
        "./b: type Code = 'A' | 'B'",
        "./b: type Single = 'only'",
        "./b: type Wide = '*' | string",
      ),
    );
    deepStrictEqual(sets, [
      { name: 'Code', shape: 'literals', open: false, paths: ['./a', './b'] },
    ]);
  });

  it('reads a member that names another union, exported or not, as its values', () => {
    const sets = findValueSets(
      api(
        "(not exported) type Inner = 'a' | 'b'",
        "./a: type Outer = 'c' | Inner",
        "./a: type Count = 'count'",
        "./a: type Fn = Count | 'sum'",
        './a: type Numbers = -1 | 1',
      ),
    );
    deepStrictEqual(
      sets.map(({ name }) => name),
      ['Fn', 'Numbers', 'Outer'],
    );
  });

  it('reads the values of a constant a type is derived from', () => {
    const sets = findValueSets(
      api(
        '(not exported) const TRAITS: readonly ["equality", "order"]',
        './a: const Levels: { readonly Low: "low"; readonly High: "high"; }',
        './a: type Trait = (typeof TRAITS)[number]',
        './a: type Level = (typeof Levels)[keyof typeof Levels]',
        '(not exported) const SHAPES: readonly [Shape, Shape]',
        './a: type NotLiterals = (typeof SHAPES)[number]',
      ),
    );
    deepStrictEqual(
      sets.map(({ name }) => name),
      ['Level', 'Trait'],
    );
  });

  it('reads a union with a catch-all member as open', () => {
    const sets = findValueSets(
      api(
        "./a: type Code = 'A' | 'B' | (string & {})",
        "./a: type Prefixed = 'M.A' | 'M.B' | (`M.${string}` & {})",
        './a: type Version = (number & {}) | 15 | 16',
      ),
    );
    deepStrictEqual(
      sets.map(({ name, open }) => [name, open]),
      [
        ['Code', true],
        ['Prefixed', true],
        ['Version', true],
      ],
    );
  });

  it('finds a union of literals written on a property, once per type', () => {
    const sets = findValueSets(
      api(
        "./a: interface Failure, readonly required property code: 'A' | 'B'",
        "./b: interface Failure, readonly required property code: 'A' | 'B'",
        "./a: interface Failure, readonly optional property hint?: 'x' | 'y' | undefined",
        "./a: class Call, readonly required property kind: 'drop' | (string & {})",
        "./a: interface Failure, readonly required property name: 'only'",
        './a: interface Failure, readonly required property mixed: Node | Other',
        "(not exported) interface Hidden, readonly required property code: 'A' | 'B'",
      ),
    );
    deepStrictEqual(sets, [
      { name: 'Call.kind', shape: 'literals', open: true, paths: ['./a'] },
      { name: 'Failure.code', shape: 'literals', open: false, paths: ['./a', './b'] },
      { name: 'Failure.hint', shape: 'literals', open: false, paths: ['./a'] },
    ]);
  });

  it('finds a union of declarations told apart by kind, and its open form', () => {
    const lines = [
      './a: interface Sel, readonly required property kind: "select"',
      './a: interface Ins, readonly required property kind: "insert"',
      './a: interface Plain, readonly required property name: string',
      './a: type Node = Ins | Sel',
      "./a: type OpenNode = Ins | Sel | { readonly kind: '%future added value'; }",
      './a: type NotCases = Plain | Sel',
    ];
    deepStrictEqual(findValueSets(api(...lines)), [
      { name: 'Node', shape: 'objects', open: false, paths: ['./a'] },
      { name: 'OpenNode', shape: 'objects', open: true, paths: ['./a'] },
    ]);
  });

  it('finds a union of object types written inline, and its open form with shared members', () => {
    const sets = findValueSets(
      api(
        "./a: type Refusal = { readonly kind: 'a'; readonly reason: string; } | { readonly kind: 'b'; }",
        "./a: type OpenRefusal = { readonly kind: 'a'; } | { readonly kind: '%future added value'; readonly reason: string; }",
        './a: type Shapes = { readonly size: number; } | { readonly kind: "b"; }',
      ),
    );
    deepStrictEqual(
      sets.map(({ name, shape, open }) => [name, shape, open]),
      [
        ['OpenRefusal', 'objects', true],
        ['Refusal', 'objects', false],
      ],
    );
  });

  it('reads a generic alias, a generic member and the keys of a constant', () => {
    const sets = findValueSets(
      api(
        "./a: type Refusal<Key extends string = 'x'> = { readonly kind: 'a'; readonly key: Key; } | { readonly kind: 'b'; }",
        './a: type Wrapped = Refusal<string> | { readonly kind: "c"; }',
        './a: const aliases: { readonly uuid: Alias; readonly cuid: Alias; }',
        './a: type AliasName = keyof typeof aliases',
      ),
    );
    deepStrictEqual(
      sets.map(({ name }) => name),
      ['AliasName', 'Refusal', 'Wrapped'],
    );
  });

  it('drops null and undefined from a property union', () => {
    const [set] = findValueSets(
      api("./a: interface Row, readonly required property status: 'applied' | 'pending' | null"),
    );
    strictEqual(set.name, 'Row.status');
  });
});

describe('checkValueSets', () => {
  const lists = [
    {
      package: PACKAGE,
      text: api(
        "./a: type Code = 'A' | 'B' | (string & {})",
        "./a: type Direction = 'asc' | 'desc'",
        "./a: type Unmarked = 'x' | 'y'",
      ),
    },
  ];
  const closedDirection = {
    package: PACKAGE,
    type: 'Direction',
    status: 'closed',
    reason: 'A sort runs one of two ways.',
  };

  it('fails on a set that neither carries the catch-all member nor is declared', () => {
    const problems = checkValueSets(lists, [closedDirection]);
    deepStrictEqual(problems.length, 1);
    match(problems[0], /@prisma\/orm-example: Unmarked \(\.\/a\) is neither open nor declared/);
  });

  it('fails on a declaration that names no exported set', () => {
    const stale = { package: PACKAGE, type: 'Gone', status: 'closed', reason: 'It was.' };
    const unmarked = { ...closedDirection, type: 'Unmarked' };
    const problems = checkValueSets(lists, [closedDirection, unmarked, stale]);
    deepStrictEqual(problems.length, 1);
    match(problems[0], /Gone is declared .* but @prisma\/orm-example exports no such set/);
  });

  it('fails on a declaration of a set that is open', () => {
    const problems = checkValueSets(lists, [
      closedDirection,
      { ...closedDirection, type: 'Unmarked' },
      { ...closedDirection, type: 'Code' },
    ]);
    deepStrictEqual(problems.length, 1);
    match(problems[0], /Code carries the catch-all member, so it is open/);
  });

  it('fails on a declaration with no reason or an unknown status', () => {
    const problems = checkValueSets(lists, [
      { ...closedDirection, reason: '' },
      { ...closedDirection, type: 'Unmarked', status: 'shut' },
    ]);
    deepStrictEqual(problems.length, 2);
    match(problems[0], /Direction: the declaration needs a reason/);
    match(problems[1], /Unmarked: status "shut" is not one of/);
  });

  it('fails on two entries for one set', () => {
    const problems = checkValueSets(lists, [
      closedDirection,
      { ...closedDirection, type: 'Unmarked' },
      { ...closedDirection, status: 'input' },
    ]);
    deepStrictEqual(problems.length, 1);
    match(problems[0], /Direction is declared twice/);
  });

  it('allows pending only in the framework domain, with a recommendation', () => {
    const framework = {
      package: '@prisma/orm-framework',
      text: api(
        "./components: type Phase = 'a' | 'b'",
        "./type-implementations: type Tag = 'a' | 'b'",
      ),
    };
    const pending = {
      package: '@prisma/orm-framework',
      type: 'Phase',
      status: 'pending',
      reason: 'Waits.',
    };
    const problems = checkValueSets(
      [...lists, framework],
      [
        closedDirection,
        { ...pending, type: 'Unmarked', package: PACKAGE, recommended: 'open' },
        pending,
        { ...pending, type: 'Tag', recommended: 'open' },
      ],
    );
    deepStrictEqual(problems.length, 3);
    match(problems[0], /Unmarked is pending, but it is not in the framework domain/);
    match(problems[1], /Phase: a pending declaration needs "recommended"/);
    match(problems[2], /Tag is pending, but it is not in the framework domain/);
  });

  it('passes when every set is open or declared', () => {
    deepStrictEqual(
      checkValueSets(lists, [closedDirection, { ...closedDirection, type: 'Unmarked' }]),
      [],
    );
  });
});

describe('the committed lists', () => {
  it('declare every exported set', () => {
    const problems = checkValueSets(
      readPublishedLists(root),
      readDeclarations(join(root, DECLARATIONS_FILE)),
    );
    deepStrictEqual(problems, []);
  });
});

describe('what each catch-all member allows', () => {
  const source = [
    "interface Sel { readonly kind: 'select'; readonly table: string }",
    "interface Ins { readonly kind: 'insert'; readonly rows: number }",
    "type Strings = 'a' | 'b' | (string & {});",
    "type Codes = 'M.A' | 'M.B' | (`M.${string}` & {});",
    'type Versions = 15 | 16 | (number & {});',
    "type Sentinel = Sel | Ins | { readonly kind: '%future added value' };",
    'type WideKind = Sel | Ins | { readonly kind: string & {} };',
    'declare const sentinel: Sentinel;',
    'declare const wide: WideKind;',
    "export const narrowsSentinel = sentinel.kind === 'select' ? sentinel.table : '';",
    "export const narrowsWide = wide.kind === 'select' ? wide.table : '';",
    "export const namedString: Strings = 'a';",
    "export const namedCode: Codes = 'M.A';",
    'export const namedVersion: Versions = 15;',
    "export const keepsPrefix: Codes = 'X.A';",
    'export function strings(x: Strings) {',
    "  if (x === 'a' || x === 'b') return x;",
    '  const neverString: never = x;',
    '  return neverString;',
    '}',
    'export function codes(x: Codes) {',
    "  if (x === 'M.A' || x === 'M.B') return x;",
    '  const neverCode: never = x;',
    '  return neverCode;',
    '}',
    'export function versions(x: Versions) {',
    '  if (x === 15 || x === 16) return x;',
    '  const neverVersion: never = x;',
    '  return neverVersion;',
    '}',
    'export function objects(x: Sentinel) {',
    "  if (x.kind === 'select') return x.table;",
    "  if (x.kind === 'insert') return x.rows;",
    '  const neverObject: never = x;',
    '  return neverObject;',
    '}',
    "export const complete: Strings = '';",
  ].join('\n');
  const options = { strict: true, noEmit: true, types: [], target: ts.ScriptTarget.ES2022 };
  const host = {
    getScriptFileNames: () => ['sets.ts'],
    getScriptVersion: () => '1',
    getScriptSnapshot: (name) => {
      if (name === 'sets.ts') return ts.ScriptSnapshot.fromString(source);
      const text = ts.sys.readFile(name);
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
    },
    getCurrentDirectory: () => root,
    getCompilationSettings: () => options,
    getDefaultLibFileName: (settings) => ts.getDefaultLibFilePath(settings),
    fileExists: (name) => name === 'sets.ts' || ts.sys.fileExists(name),
    readFile: (name) => (name === 'sets.ts' ? source : ts.sys.readFile(name)),
  };
  const service = ts.createLanguageService(host);
  const lines = source.split('\n');
  const errorLines = ts
    .getPreEmitDiagnostics(service.getProgram())
    .map((d) => lines[d.file.getLineAndCharacterOfPosition(d.start).line].trim())
    .sort();

  it('stops a never check over every open form, keeps narrowing with the sentinel, and keeps a prefix', () => {
    deepStrictEqual(errorLines, [
      'const neverCode: never = x;',
      'const neverObject: never = x;',
      'const neverString: never = x;',
      'const neverVersion: never = x;',
      "export const keepsPrefix: Codes = 'X.A';",
      "export const narrowsWide = wide.kind === 'select' ? wide.table : '';",
    ]);
  });

  it('still offers the named values in completion', () => {
    const position = source.lastIndexOf("''") + 1;
    const names = service
      .getCompletionsAtPosition('sets.ts', position, {})
      ?.entries.map(({ name }) => name);
    deepStrictEqual(
      ['a', 'b'].filter((name) => names?.includes(name)),
      ['a', 'b'],
    );
  });
});
