import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import ts from 'typescript';
import { exportOfLine } from './api-lines.mjs';
import { apiFingerprint, fingerprintLines } from './fingerprint.mjs';

describe('apiFingerprint', () => {
  const api = [
    '# header',
    '.: interface Store',
    '.: interface Store, required method get(key: string): string',
    '.: interface Other',
    './sub: const a: string',
  ].join('\n');

  it('changes when a line of the export changes, members included, and not otherwise', () => {
    const fingerprint = apiFingerprint(api, '.', 'Store');
    strictEqual(/^[0-9a-f]{16}$/.test(fingerprint), true);
    strictEqual(
      apiFingerprint(api.replace('interface Other', 'interface Another'), '.', 'Store'),
      fingerprint,
    );
    strictEqual(
      apiFingerprint(api.replace('get(key: string)', 'get(key: "a")'), '.', 'Store') ===
        fingerprint,
      false,
    );
  });

  it('takes in the lines of every declaration the export names, exported or not, followed further', () => {
    const lines = [
      '.: function configure(options: Options, mode: string): void',
      '.: type Options = Settings',
      '(not exported) interface Settings',
      '(not exported) interface Settings, readonly required property level: Level',
      './other: type Level = 1 | 2',
      '.: interface Unrelated',
    ];
    const base = apiFingerprint(lines.join('\n'), '.', 'configure');
    const changed = (from, to) =>
      apiFingerprint(lines.join('\n').replace(from, to), '.', 'configure') === base;
    deepStrictEqual(
      [
        changed('level: Level', 'level?: Level'),
        changed('Level = 1 | 2', 'Level = 1 | 2 | 3'),
        changed('interface Unrelated', 'interface Unrelated2'),
      ],
      [false, false, true],
    );
  });

  // Each case is a line of the export and a declaration it may reach; the declaration's lines change.
  const reaches = (exportLine, declaration, from, to) => {
    const lines = [exportLine, ...declaration].join('\n');
    return (
      apiFingerprint(lines, '.', 'use') !== apiFingerprint(lines.replace(from, to), '.', 'use')
    );
  };
  const declared = (name) => [
    `(not exported) interface ${name}`,
    `(not exported) interface ${name}, required property x: string`,
  ];

  it('does not follow a name that is not a type: a member or parameter name, a word in a string, a package, or a word api.txt writes', () => {
    deepStrictEqual(
      [
        reaches(
          '.: interface use, readonly required property table: string',
          declared('table'),
          'x: string',
          'x: number',
        ),
        reaches(
          '.: function use(table: string): void',
          declared('table'),
          'x: string',
          'x: number',
        ),
        reaches(
          '.: function use(options?: { table?: string }): void',
          declared('table'),
          'x: string',
          'x: number',
        ),
        reaches(
          ".: const use: { readonly family: 'sql' }",
          declared('sql'),
          'x: string',
          'x: number',
        ),
        reaches('.: const use: `prefix-sql`', declared('sql'), 'x: string', 'x: number'),
        reaches(
          '.: export use from @prisma/orm-framework/runtime',
          declared('orm'),
          'x: string',
          'x: number',
        ),
        reaches(
          '.: interface use, readonly optional property a?: string',
          declared('optional'),
          'x: string',
          'x: number',
        ),
        reaches(
          '.: interface use, required method get(key: string): void',
          declared('get'),
          'x: string',
          'x: number',
        ),
      ],
      [false, false, false, false, false, false, false, false],
    );
  });

  it('follows a type wherever it is named: a property’s type, a template literal part, a conditional type, a computed key', () => {
    deepStrictEqual(
      [
        reaches(
          '.: interface use, readonly required property table: Table',
          declared('Table'),
          'x: string',
          'x: number',
        ),
        reaches('.: type use = `prefix-${Prefix}`', declared('Prefix'), 'x: string', 'x: number'),
        reaches(
          '.: type use<T> = T extends string ? Yes : No',
          declared('No'),
          'x: string',
          'x: number',
        ),
        reaches(
          '.: interface use, readonly required property [BRAND]: true',
          declared('BRAND'),
          'x: string',
          'x: number',
        ),
        reaches(
          '.: function use(options: Options): void',
          declared('Options'),
          'x: string',
          'x: number',
        ),
      ],
      [true, true, true, true, true],
    );
  });

  it('follows a declaration exported only as default by its own name, and a package’s augmentation of its own interface', () => {
    deepStrictEqual(
      [
        reaches(
          '.: type use = ReturnType<typeof make>',
          ['./b: export default = function make(value: string): string'],
          'value: string',
          'value: number',
        ),
        reaches(
          '.: function use(registry: Registry): void',
          [
            '.: interface Registry',
            '.: augments @prisma/orm-x interface Registry, readonly required property extra: string',
          ],
          'extra: string',
          'extra: number',
        ),
      ],
      [true, true],
    );
  });

  it('takes in the export’s lines and those of the types they name, and no others', () => {
    deepStrictEqual(
      fingerprintLines(
        [
          '.: function use(table: Table): void',
          '.: interface Table',
          '.: interface Table, readonly required property sql: string',
          '.: function table(): void',
          '.: function sql(): void',
        ].join('\n'),
        '.',
        'use',
      ),
      [
        '.: function use(table: Table): void',
        '.: interface Table',
        '.: interface Table, readonly required property sql: string',
      ],
    );
  });

  it('covers every line of a path for *', () => {
    strictEqual(apiFingerprint(api, './sub', '*') === apiFingerprint('', './sub', '*'), false);
  });
});

describe('apiFingerprint, on string and template literals', () => {
  const reaches = (exportLine, declaration, from, to) => {
    const lines = [exportLine, ...declaration].join('\n');
    return (
      apiFingerprint(lines, '.', 'use') !== apiFingerprint(lines.replace(from, to), '.', 'use')
    );
  };
  const opts = [
    '(not exported) interface Opts',
    '(not exported) interface Opts, required property x: string',
  ];
  const changes = (line) => reaches(line, opts, 'x: string', 'x: number');

  it('follows a name in a template literal’s ${…} part, however quotes and backticks sit around it', () => {
    deepStrictEqual(
      [
        changes('.: type use = `"${Opts}"`'),
        changes('.: type use = `"${string}"."${Opts}"`'),
        changes('.: type use = `${string}-a` | Opts | `${string}-b`'),
        changes(".: function use(a: `it's ${Opts}`, b: 'y'): void"),
        changes(
          '.: const use: { readonly doc: "a `storage` b"; readonly t: Opts; readonly d2: "c `x` d" }',
        ),
      ],
      [true, true, true, true, true],
    );
  });

  it('does not follow the name of another package, or its type, into a declaration of this one', () => {
    deepStrictEqual(
      [
        changes('.: function use(codec: @prisma/orm-framework.Opts): void'),
        reaches(
          '.: function use(codec: @prisma/orm-framework.Codec): void',
          ['.: function orm(x: string): void'],
          'x: string',
          'x: number',
        ),
      ],
      [false, false],
    );
  });

  it('does not follow a word inside a string or a template literal’s text', () => {
    deepStrictEqual(
      [changes('.: const use: "Opts"'), changes('.: type use = `Opts-${string}`')],
      [false, false],
    );
  });
});

describe('apiFingerprint, on words TypeScript and api.txt also use', () => {
  const reaches = (exportLine, declaration) => {
    const lines = [exportLine, ...declaration].join('\n');
    return (
      apiFingerprint(lines, '.', 'use') !==
      apiFingerprint(lines.replace('a: string', 'a: number'), '.', 'use')
    );
  };

  it('follows a declaration of the package named with a word TypeScript also uses', () => {
    deepStrictEqual(
      [
        reaches('.: interface use, readonly required property index: typeof index', [
          '.: function index(a: string): void',
        ]),
        reaches('.: type use = optional', ['(not exported) type optional = { a: string }']),
        reaches('.: type use = unique', ['(not exported) type unique = { a: string }']),
      ],
      [true, true, true],
    );
  });

  it('does not follow a word api.txt writes in a member’s descriptor', () => {
    strictEqual(
      reaches('.: interface use, readonly optional property b?: string', [
        '(not exported) type optional = { a: string }',
      ]),
      false,
    );
  });
});

// A second reading of each committed api.txt line with TypeScript's scanner, written apart from
// fingerprint.mjs: every name that is not a member or parameter name, a string's text, a word
// api.txt writes, or a reserved word, which cannot name a declaration. The fingerprint must take in
// every line this reaches.
function referenceNames(line) {
  const K = ts.SyntaxKind;
  const rest = line
    .replace(/^(\.[^:]*: |\(not exported\) )/, '')
    .replace(/^deprecated: /, '')
    .replace(/^(?:export (?:type )?(\S+)(?: = \S+)?|everything) from \S+$/, (_, name) => name ?? '')
    .replace(/^augments \S+ /, '')
    .replace(/@[\w.-]+\/[\w./-]+\.[A-Za-z_$][\w$]*/g, ' ')
    .replace(
      /^((?:abstract )?class|interface|enum|namespace|interface) [\w$]+, (?:(?:abstract|static|protected|private|public|readonly) )*(?:(?:required|optional) (?:property|method) [\w$]+|index signature|call signature|construct signature)/,
      '',
    );
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, rest);
  const tokens = [];
  const spans = [];
  for (let kind = scanner.scan(); kind !== K.EndOfFileToken; kind = scanner.scan()) {
    if (kind === K.TemplateHead) spans.push(0);
    else if (kind === K.OpenBraceToken && spans.length > 0) spans[spans.length - 1]++;
    else if (kind === K.CloseBraceToken && spans.length > 0) {
      if (spans.at(-1) === 0) {
        kind = scanner.reScanTemplateToken(false);
        if (kind === K.TemplateTail) spans.pop();
      } else spans[spans.length - 1]--;
    }
    tokens.push({ kind, text: scanner.getTokenText() });
  }
  const before = new Set([
    K.OpenParenToken,
    K.CommaToken,
    K.OpenBraceToken,
    K.SemicolonToken,
    K.OpenBracketToken,
    K.DotDotDotToken,
    K.ReadonlyKeyword,
    K.StaticKeyword,
    K.ProtectedKeyword,
    K.PrivateKeyword,
    K.PublicKeyword,
    K.AbstractKeyword,
  ]);
  return tokens
    .filter(({ kind, text }, index) => {
      const reserved = kind >= K.FirstReservedWord && kind <= K.LastReservedWord;
      const word =
        kind === K.Identifier || (kind >= K.FirstKeyword && kind <= K.LastKeyword && !reserved);
      if (!word || !/^[A-Za-z_$][\w$]*$/.test(text)) return false;
      const next = tokens[index + 1];
      const named =
        next &&
        (next.kind === K.ColonToken ||
          (next.kind === K.QuestionToken && tokens[index + 2]?.kind === K.ColonToken));
      return !(named && (index === 0 || before.has(tokens[index - 1].kind)));
    })
    .map(({ text }) => text);
}

describe('apiFingerprint, on the committed api.txt files', () => {
  it('takes in, for every export, every line a second reading with TypeScript’s scanner reaches', () => {
    const root = new URL('../../packages/9-public/@prisma/', import.meta.url);
    const missed = [];
    for (const dir of readdirSync(root)) {
      const text = readFileSync(new URL(`${dir}/api.txt`, root), 'utf8');
      const all = text
        .split('\n')
        .filter((line) => line && !line.startsWith('#'))
        .map((line) => ({ line, ...exportOfLine(line) }));
      const owners = new Map();
      const add = (name, owner) => owners.set(name, [...(owners.get(name) ?? []), owner]);
      for (const owner of all) add(owner.name, owner);
      const names = new Map(all.map((owner) => [owner.line, referenceNames(owner.line)]));
      const exports = new Map(
        all
          .filter((owner) => owner.subpath)
          .map((owner) => [`${owner.subpath}\0${owner.name}`, owner]),
      );
      for (const { subpath, name } of exports.values()) {
        const taken = new Set();
        const followed = new Set();
        const queue = all.filter((owner) => owner.subpath === subpath && owner.name === name);
        while (queue.length > 0) {
          const { line } = queue.pop();
          if (taken.has(line)) continue;
          taken.add(line);
          for (const word of names.get(line)) {
            if (followed.has(word)) continue;
            followed.add(word);
            queue.push(...(owners.get(word) ?? []));
          }
        }
        const fingerprinted = new Set(fingerprintLines(text, subpath, name));
        const lost = [...taken].filter((line) => !fingerprinted.has(line));
        if (lost.length > 0)
          missed.push(
            `@prisma/${dir} ${subpath} ${name}: ${lost.length}, such as ${lost[0].slice(0, 100)}`,
          );
      }
    }
    deepStrictEqual(missed, []);
  });
});
