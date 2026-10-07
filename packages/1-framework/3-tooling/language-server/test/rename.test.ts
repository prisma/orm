import { assembleAuthoringContributions } from '@internal/framework-components/control';
import { fieldAttribute, fieldRef, list, referencedFieldRef } from '@internal/psl-parser';
import { format } from '@internal/psl-parser/format';
import { describe, expect, it } from 'vitest';
import {
  LSPErrorCodes,
  type Range,
  ResponseError,
  type WorkspaceEdit,
} from 'vscode-languageserver';
import { provideReferences } from '../src/references';
import { providePrepareRename, provideRename } from '../src/rename';
import {
  cursorInput,
  type Files,
  type FixtureStack,
  glance,
  kinds,
  sameName,
} from './helpers/reference-fixtures';

function lineWith(files: Files, uri: string, range: Range, replacement: string): string {
  const text = files[uri];
  if (text === undefined) throw new Error(`no file ${uri}`);
  if (range.start.line !== range.end.line) throw new Error('range spans lines');
  const line = text.split('\n')[range.start.line] ?? '';
  const before = line.slice(0, range.start.character);
  const after = line.slice(range.end.character);
  if (replacement.includes('\n')) {
    return `${uri}: ${JSON.stringify(replacement)} before ${JSON.stringify(`${before}${after}`.trim())}`;
  }
  return `${uri}: ${`${before}${replacement}${after}`.trim()}`;
}

function renameAt(
  files: Files,
  name: string,
  marked: string,
  newName: string,
  stack?: FixtureStack,
): string[] | null {
  const edit = provideRename({ ...cursorInput(files, name, marked, stack), newName });
  if (edit === null) return null;
  return Object.entries(edit.changes ?? {}).flatMap(([uri, edits]) =>
    edits.map(({ range, newText }) => lineWith(files, uri, range, newText)),
  );
}

type Cursor = readonly [file: string, marked: string];

function renameFromBoth(
  files: Files,
  declaration: Cursor,
  reference: Cursor,
  newName: string,
  stack?: FixtureStack,
): readonly [string[] | null, string[] | null] {
  return [
    renameAt(files, declaration[0], declaration[1], newName, stack),
    renameAt(files, reference[0], reference[1], newName, stack),
  ];
}

function pair(declaration: readonly string[], reference: readonly string[]): Files {
  return {
    'decl.prisma': [...declaration, ''].join('\n'),
    'ref.prisma': [...reference, ''].join('\n'),
  };
}

function offsetOf(text: string, position: Range['start']): number {
  const lines = text.split('\n');
  let offset = position.character;
  for (let line = 0; line < position.line; line++) offset += (lines[line] ?? '').length + 1;
  return offset;
}

function textAfterRename(files: Files, name: string, marked: string, newName: string): string {
  const edit = provideRename({ ...cursorInput(files, name, marked), newName });
  let text = files[name] ?? '';
  const edits = [...(edit?.changes?.[name] ?? [])].sort(
    (a, b) => offsetOf(text, b.range.start) - offsetOf(text, a.range.start),
  );
  for (const { range, newText } of edits) {
    text = `${text.slice(0, offsetOf(text, range.start))}${newText}${text.slice(offsetOf(text, range.end))}`;
  }
  return text;
}

function prepareAt(files: Files, name: string, marked: string): string | null {
  const prepared = providePrepareRename(cursorInput(files, name, marked));
  if (prepared === null) return null;
  return lineWith(files, name, prepared.range, `<${prepared.placeholder}>`);
}

function rejectionOf(newName: string): unknown {
  try {
    renameAt(glance, 'auth.prisma', 'model Us|er', newName);
  } catch (error) {
    return error;
  }
  throw new Error(`"${newName}" was accepted`);
}

const userToAccount = [
  'auth.prisma: model Account {',
  'auth.prisma: "\\n    @@map(\\"User\\")\\n" before "}"',
  'session.prisma: user   Account @relation(fields: [userId], references: [id])',
  'post.prisma: author   auth.Account @relation(fields: [authorId], references: [id])',
];

const userIdToUid = [
  'auth.prisma: uid    Int    @id',
  'auth.prisma: id    Int    @id @map("id")',
  'session.prisma: user   User @relation(fields: [userId], references: [uid])',
  'post.prisma: author   auth.User @relation(fields: [authorId], references: [uid])',
];

const authorIdToWriterId = [
  'post.prisma: writerId Int',
  'post.prisma: author   auth.User @relation(fields: [writerId], references: [id])',
  'post.prisma: @@index([writerId])',
  'post.prisma: authorId Int @map("authorId")',
];

const authToIdentity = [
  'auth.prisma: namespace identity {',
  'session.prisma: namespace identity {',
  'post.prisma: author   identity.User @relation(fields: [authorId], references: [id])',
];

describe('provideRename — a model', () => {
  it('edits the declaration name and every reference, from the declaration name', () => {
    expect(renameAt(glance, 'auth.prisma', 'model Us|er', 'Account')).toEqual(userToAccount);
  });

  it('returns the same edit from an unqualified reference', () => {
    expect(renameAt(glance, 'session.prisma', 'user   Us|er', 'Account')).toEqual(userToAccount);
  });
});

describe('provideRename — a field', () => {
  it('edits the declaration name and the references entries, from the declaration name', () => {
    expect(renameAt(glance, 'auth.prisma', 'i|d    Int    @id', 'uid')).toEqual(userIdToUid);
  });

  it('returns the same edit from a references entry', () => {
    expect(renameAt(glance, 'post.prisma', 'references: [i|d]', 'uid')).toEqual(userIdToUid);
  });

  it('edits the declaration name, the fields entry and the @@index entry, from the declaration name', () => {
    expect(renameAt(glance, 'post.prisma', 'author|Id Int', 'writerId')).toEqual(
      authorIdToWriterId,
    );
  });

  it('returns the same edit from a fields entry', () => {
    expect(renameAt(glance, 'post.prisma', 'fields: [author|Id]', 'writerId')).toEqual(
      authorIdToWriterId,
    );
  });
});

describe('provideRename — a namespace', () => {
  it('edits the name of both blocks in both files and the qualifier, from a block name', () => {
    expect(renameAt(glance, 'auth.prisma', 'namespace au|th', 'identity')).toEqual(authToIdentity);
  });

  it('returns the same edit from a qualifier', () => {
    expect(renameAt(glance, 'post.prisma', 'au|th.User', 'identity')).toEqual(authToIdentity);
  });

  it('edits only the namespace tokens when a model has the same name', () => {
    expect(renameAt(sameName, 'post.prisma', 'owner au|th.auth', 'identity')).toEqual([
      'auth.prisma: namespace identity {',
      'post.prisma: owner identity.auth',
    ]);
  });

  it('edits only the model tokens when a namespace has the same name', () => {
    expect(renameAt(sameName, 'post.prisma', 'owner auth.au|th', 'Account')).toEqual([
      'auth.prisma: model Account {',
      'auth.prisma: "\\n    @@map(\\"auth\\")\\n" before "}"',
      'post.prisma: owner auth.Account',
    ]);
  });
});

describe('provideRename — other symbol kinds', () => {
  it('renames a composite type by name only', () => {
    const edits = ['tag.prisma: type Location {', 'group.prisma: address   Location'];

    expect(
      renameFromBoth(
        kinds,
        ['tag.prisma', 'type Addr|ess'],
        ['group.prisma', 'address   Addr|ess'],
        'Location',
      ),
    ).toEqual([edits, edits]);
  });

  it('renames a named type by name only', () => {
    const edits = ['tag.prisma: Mail = String', 'group.prisma: email     Mail'];

    expect(
      renameFromBoth(
        kinds,
        ['tag.prisma', 'Em|ail = String'],
        ['group.prisma', 'email     Em|ail'],
        'Mail',
      ),
    ).toEqual([edits, edits]);
  });

  it('renames an enum block by name only', () => {
    const edits = ['tag.prisma: enum Rank {', 'group.prisma: role      Rank'];

    expect(
      renameFromBoth(
        kinds,
        ['tag.prisma', 'enum Ro|le'],
        ['group.prisma', 'role      Ro|le'],
        'Rank',
      ),
    ).toEqual([edits, edits]);
  });

  it('renames a block whose name is not a storage name by name only', () => {
    const edits = ['tag.prisma: policy ReadMine {', 'group.prisma: @@guardedBy(ReadMine)'];

    expect(
      renameFromBoth(
        kinds,
        ['tag.prisma', 'policy Read|Own'],
        ['group.prisma', '@@guardedBy(Read|Own)'],
        'ReadMine',
      ),
    ).toEqual([edits, edits]);
  });

  it('renames a composite type member by name only', () => {
    expect(renameAt(kinds, 'tag.prisma', 'str|eet String', 'road')).toEqual([
      'tag.prisma: road String',
    ]);
  });
});

describe('provideRename — the new name', () => {
  it('returns the name edits and no map attribute when the new name equals the current name', () => {
    expect(renameAt(glance, 'auth.prisma', 'model Us|er', 'User')).toEqual([
      'auth.prisma: model User {',
      'session.prisma: user   User @relation(fields: [userId], references: [id])',
      'post.prisma: author   auth.User @relation(fields: [authorId], references: [id])',
    ]);
  });

  it('applies a name that is already declared in the same scope', () => {
    expect(renameAt(kinds, 'tag.prisma', 'type Addr|ess', 'Tag')).toEqual([
      'tag.prisma: type Tag {',
      'group.prisma: address   Tag',
    ]);
  });

  it('accepts a name with a hyphen', () => {
    expect(renameAt(glance, 'post.prisma', 'author|Id Int', 'writer-id')).toEqual([
      'post.prisma: writer-id Int',
      'post.prisma: author   auth.User @relation(fields: [writer-id], references: [id])',
      'post.prisma: @@index([writer-id])',
      'post.prisma: authorId Int @map("authorId")',
    ]);
  });

  it('rejects NaN with a request-failed error that quotes it', () => {
    const rejection = rejectionOf('NaN');

    expect(rejection).toBeInstanceOf(ResponseError);
    expect(rejection).toMatchObject({
      code: LSPErrorCodes.RequestFailed,
      message: '"NaN" is not a valid PSL identifier',
    });
  });

  it('rejects Infinity', () => {
    expect(rejectionOf('Infinity')).toMatchObject({
      code: LSPErrorCodes.RequestFailed,
      message: '"Infinity" is not a valid PSL identifier',
    });
  });

  it('rejects a name that starts with a digit', () => {
    expect(rejectionOf('1st')).toMatchObject({
      code: LSPErrorCodes.RequestFailed,
      message: '"1st" is not a valid PSL identifier',
    });
  });

  it('rejects an empty name', () => {
    expect(rejectionOf('')).toMatchObject({
      code: LSPErrorCodes.RequestFailed,
      message: '"" is not a valid PSL identifier',
    });
  });

  it('rejects a name with a dot', () => {
    expect(rejectionOf('auth.Account')).toMatchObject({
      code: LSPErrorCodes.RequestFailed,
      message: '"auth.Account" is not a valid PSL identifier',
    });
  });

  it('rejects an invalid name at a position with nothing to rename', () => {
    expect(() => renameAt(kinds, 'group.prisma', 'Miss|ing', '1st')).toThrow(
      '"1st" is not a valid PSL identifier',
    );
  });
});

describe('provideRename — nothing to rename', () => {
  it('returns null when find references returns nothing', () => {
    expect(renameAt(kinds, 'group.prisma', '@rel|ation', 'link')).toBeNull();
  });
});

describe('provideRename — response shape', () => {
  it('returns one name edit per find-references location, grouped by file, and the insertion last in the declaration file', () => {
    const input = cursorInput(glance, 'post.prisma', 'auth.Us|er');

    const edit = provideRename({ ...input, newName: 'Account' });

    expect(edit).toEqual<WorkspaceEdit>({
      changes: {
        'auth.prisma': [
          {
            range: { start: { line: 1, character: 8 }, end: { line: 1, character: 12 } },
            newText: 'Account',
          },
          {
            range: { start: { line: 4, character: 0 }, end: { line: 4, character: 0 } },
            newText: '\n    @@map("User")\n',
          },
        ],
        'session.prisma': [
          {
            range: { start: { line: 4, character: 11 }, end: { line: 4, character: 15 } },
            newText: 'Account',
          },
        ],
        'post.prisma': [
          {
            range: { start: { line: 3, character: 16 }, end: { line: 3, character: 20 } },
            newText: 'Account',
          },
        ],
      },
    });
    expect(
      Object.entries(edit?.changes ?? {}).flatMap(([uri, edits]) =>
        edits.filter(({ newText }) => newText === 'Account').map(({ range }) => ({ uri, range })),
      ),
    ).toEqual(provideReferences({ ...input, includeDeclaration: true }));
  });
});

describe('providePrepareRename — renameable symbols', () => {
  it('returns the name token of a model declaration', () => {
    expect(prepareAt(glance, 'auth.prisma', 'model Us|er')).toBe('auth.prisma: model <User> {');
  });

  it('returns the name token of a field declaration', () => {
    expect(prepareAt(glance, 'post.prisma', 'author|Id Int')).toBe('post.prisma: <authorId> Int');
  });

  it('returns the name token of a namespace block', () => {
    expect(prepareAt(glance, 'session.prisma', 'namespace au|th')).toBe(
      'session.prisma: namespace <auth> {',
    );
  });

  it('returns the token of a composite type', () => {
    expect(prepareAt(kinds, 'tag.prisma', 'type Addr|ess')).toBe('tag.prisma: type <Address> {');
  });

  it('returns the token of a named type', () => {
    expect(prepareAt(kinds, 'group.prisma', 'email     Em|ail')).toBe(
      'group.prisma: email     <Email>',
    );
  });

  it('returns the token of an enum block', () => {
    expect(prepareAt(kinds, 'tag.prisma', 'enum Ro|le')).toBe('tag.prisma: enum <Role> {');
  });

  it('returns the token of a generic block', () => {
    expect(prepareAt(kinds, 'group.prisma', '@@guardedBy(Read|Own)')).toBe(
      'group.prisma: @@guardedBy(<ReadOwn>)',
    );
  });

  it('returns the range and the current text as the placeholder', () => {
    expect(providePrepareRename(cursorInput(glance, 'post.prisma', 'auth.Us|er'))).toEqual({
      range: { start: { line: 3, character: 16 }, end: { line: 3, character: 20 } },
      placeholder: 'User',
    });
  });

  it('returns a range that is one of the ranges rename edits from the same position', () => {
    const input = cursorInput(glance, 'post.prisma', 'au|th.User');

    const prepared = providePrepareRename(input);
    const edit = provideRename({ ...input, newName: 'identity' });

    expect(edit?.changes?.['post.prisma']?.map(({ range }) => range)).toEqual([prepared?.range]);
  });
});

describe('providePrepareRename — nothing to rename', () => {
  it('returns null on an attribute name', () => {
    expect(prepareAt(kinds, 'group.prisma', '@rel|ation')).toBeNull();
  });

  it('returns null on a contributed type', () => {
    expect(prepareAt(kinds, 'group.prisma', 'pgvector.Vec|tor')).toBeNull();
  });

  it('returns null on a contributed namespace', () => {
    expect(prepareAt(kinds, 'group.prisma', 'pgve|ctor.Vector')).toBeNull();
  });

  it('returns null on a cross-space reference', () => {
    expect(prepareAt(kinds, 'group.prisma', 'supabase:store.Ta|g')).toBeNull();
  });

  it('returns null on an unresolved name', () => {
    expect(prepareAt(kinds, 'group.prisma', 'Miss|ing')).toBeNull();
  });

  it('returns null on an enum member', () => {
    expect(prepareAt(kinds, 'tag.prisma', 'US|ER')).toBeNull();
  });

  it('returns null at a position with no identifier', () => {
    expect(prepareAt(kinds, 'group.prisma', 'missing  | Missing')).toBeNull();
  });
});

const refModel = (...members: string[]): string[] => [
  'model Ref {',
  '  id Int @id',
  ...members,
  '}',
];

const noMapStack: FixtureStack = {
  authoringContributions: assembleAuthoringContributions([
    {
      id: 'rename-no-map',
      authoring: {
        attributeSpecs: {
          field: {
            id: () => fieldAttribute('id', { documentation: 'fixture' }),
            relation: () =>
              fieldAttribute('relation', {
                documentation: 'fixture',
                named: {
                  fields: { type: list(fieldRef()), documentation: 'fixture' },
                  references: { type: list(referencedFieldRef()), documentation: 'fixture' },
                },
              }),
          },
          model: {},
        },
      },
    },
  ]),
  pslBlockDescriptors: {},
};

describe('provideRename — map attribute added', () => {
  it('adds @map to a list of scalars', () => {
    const files = pair(
      ['model Item {', '  id Int @id', '  tags String[]', '}'],
      refModel('  item Item @relation(fields: [id], references: [tags])'),
    );
    const edits = [
      'decl.prisma: labels String[]',
      'decl.prisma: tags String[] @map("tags")',
      'ref.prisma: item Item @relation(fields: [id], references: [labels])',
    ];

    expect(
      renameFromBoth(
        files,
        ['decl.prisma', 'ta|gs String[]'],
        ['ref.prisma', 'references: [ta|gs]'],
        'labels',
      ),
    ).toEqual([edits, edits]);
  });

  it('adds @map to a field typed by an enum', () => {
    const files = pair(
      ['enum Kind {', '  BASIC', '}', 'model Item {', '  id Int @id', '  kind Kind', '}'],
      refModel('  item Item @relation(fields: [id], references: [kind])'),
    );
    const edits = [
      'decl.prisma: sort Kind',
      'decl.prisma: kind Kind @map("kind")',
      'ref.prisma: item Item @relation(fields: [id], references: [sort])',
    ];

    expect(
      renameFromBoth(
        files,
        ['decl.prisma', 'ki|nd Kind'],
        ['ref.prisma', 'references: [ki|nd]'],
        'sort',
      ),
    ).toEqual([edits, edits]);
  });

  it('adds @map to a field typed by a composite type', () => {
    const files = pair(
      [
        'type Place {',
        '  street String',
        '}',
        'model Item {',
        '  id Int @id',
        '  place Place',
        '}',
      ],
      refModel('  item Item @relation(fields: [id], references: [place])'),
    );
    const edits = [
      'decl.prisma: spot Place',
      'decl.prisma: place Place @map("place")',
      'ref.prisma: item Item @relation(fields: [id], references: [spot])',
    ];

    expect(
      renameFromBoth(
        files,
        ['decl.prisma', 'pla|ce Place'],
        ['ref.prisma', 'references: [pla|ce]'],
        'spot',
      ),
    ).toEqual([edits, edits]);
  });

  it('adds @map to a field whose type does not resolve', () => {
    const files = pair(
      ['model Item {', '  id Int @id', '  missing Nope', '}'],
      refModel('  item Item @relation(fields: [id], references: [missing])'),
    );
    const edits = [
      'decl.prisma: found Nope',
      'decl.prisma: missing Nope @map("missing")',
      'ref.prisma: item Item @relation(fields: [id], references: [found])',
    ];

    expect(
      renameFromBoth(
        files,
        ['decl.prisma', 'miss|ing Nope'],
        ['ref.prisma', 'references: [miss|ing]'],
        'found',
      ),
    ).toEqual([edits, edits]);
  });

  it('adds @@map to a block whose descriptor says its name is the storage name', () => {
    const files = pair(['label Sticker {', '}'], refModel('', '  @@labelled(Sticker)'));
    const edits = [
      'decl.prisma: label Badge {',
      'decl.prisma: "  @@map(\\"Sticker\\")\\n" before "}"',
      'ref.prisma: @@labelled(Badge)',
    ];

    expect(
      renameFromBoth(
        files,
        ['decl.prisma', 'label Stic|ker'],
        ['ref.prisma', '@@labelled(Stic|ker)'],
        'Badge',
      ),
    ).toEqual([edits, edits]);
  });

  it('adds @@map to a model that another model names as its base', () => {
    const files = pair(
      ['model Item {', '  id Int @id', '}'],
      ['model Special {', '  extra Int', '', '  @@base(Item)', '}'],
    );
    const edits = [
      'decl.prisma: model Product {',
      'decl.prisma: "\\n  @@map(\\"Item\\")\\n" before "}"',
      'ref.prisma: @@base(Product)',
    ];

    expect(
      renameFromBoth(
        files,
        ['decl.prisma', 'model It|em'],
        ['ref.prisma', '@@base(It|em)'],
        'Product',
      ),
    ).toEqual([edits, edits]);
  });

  it('adds @@map together with the name edits when the new name is already declared', () => {
    const files = pair(['model Item {', '  id Int @id', '}'], refModel('  item Item'));

    expect(renameAt(files, 'decl.prisma', 'model It|em', 'Ref')).toEqual([
      'decl.prisma: model Ref {',
      'decl.prisma: "\\n  @@map(\\"Item\\")\\n" before "}"',
      'ref.prisma: item Ref',
    ]);
  });
});

describe('provideRename — map attribute not added', () => {
  it('adds none to a model that has @@map, whatever it is renamed to', () => {
    const files = pair(
      ['model Account {', '  id Int @id', '', '  @@ map ( "User" )', '}'],
      refModel('  account Account'),
    );
    const edits = ['decl.prisma: model Member {', 'ref.prisma: account Member'];

    expect(
      renameFromBoth(
        files,
        ['decl.prisma', 'model Acc|ount'],
        ['ref.prisma', 'account Acc|ount'],
        'Member',
      ),
    ).toEqual([edits, edits]);
  });

  it('keeps the existing @@map when a model is renamed back to the mapped name', () => {
    const files = pair(
      ['model Account {', '  id Int @id', '', '  @@map("User")', '}'],
      refModel('  account Account'),
    );

    expect(renameAt(files, 'decl.prisma', 'model Acc|ount', 'User')).toEqual([
      'decl.prisma: model User {',
      'ref.prisma: account User',
    ]);
  });

  it('adds none to a field that has @map', () => {
    const files = pair(
      ['model Item {', '  id Int @id', '  code Int @map("old_code")', '}'],
      refModel('  item Item @relation(fields: [id], references: [code])'),
    );
    const edits = [
      'decl.prisma: sku Int @map("old_code")',
      'ref.prisma: item Item @relation(fields: [id], references: [sku])',
    ];

    expect(
      renameFromBoth(
        files,
        ['decl.prisma', 'co|de Int'],
        ['ref.prisma', 'references: [co|de]'],
        'sku',
      ),
    ).toEqual([edits, edits]);
  });

  it('adds none to such a block that has @@map', () => {
    const files = pair(
      ['label Sticker {', '  @@map("stickers")', '}'],
      refModel('', '  @@labelled(Sticker)'),
    );
    const edits = ['decl.prisma: label Badge {', 'ref.prisma: @@labelled(Badge)'];

    expect(
      renameFromBoth(
        files,
        ['decl.prisma', 'label Stic|ker'],
        ['ref.prisma', '@@labelled(Stic|ker)'],
        'Badge',
      ),
    ).toEqual([edits, edits]);
  });

  it('adds none to a model with @@base', () => {
    const files = pair(
      [
        'model Item {',
        '  id Int @id',
        '}',
        'model Special {',
        '  extra Int',
        '',
        '  @@base(Item)',
        '}',
      ],
      refModel('  special Special'),
    );
    const edits = ['decl.prisma: model Rare {', 'ref.prisma: special Rare'];

    expect(
      renameFromBoth(
        files,
        ['decl.prisma', 'model Spec|ial'],
        ['ref.prisma', 'special Spec|ial'],
        'Rare',
      ),
    ).toEqual([edits, edits]);
  });

  it('adds none to a relation field that holds the foreign key', () => {
    const files = pair(
      [
        'model Owner {',
        '  id Int @id',
        '  items Item[]',
        '}',
        'model Item {',
        '  id Int @id',
        '  owner Owner @relation(fields: [id], references: [id])',
        '}',
      ],
      refModel('  item Item @relation(fields: [id], references: [owner])'),
    );
    const edits = [
      'decl.prisma: holder Owner @relation(fields: [id], references: [id])',
      'ref.prisma: item Item @relation(fields: [id], references: [holder])',
    ];

    expect(
      renameFromBoth(
        files,
        ['decl.prisma', 'own|er Owner'],
        ['ref.prisma', 'references: [own|er]'],
        'holder',
      ),
    ).toEqual([edits, edits]);
  });

  it('adds none to a back-relation field', () => {
    const files = pair(
      [
        'model Owner {',
        '  id Int @id',
        '  items Item[]',
        '}',
        'model Item {',
        '  id Int @id',
        '  owner Owner @relation(fields: [id], references: [id])',
        '}',
      ],
      refModel('  owner Owner @relation(fields: [id], references: [items])'),
    );
    const edits = [
      'decl.prisma: things Item[]',
      'ref.prisma: owner Owner @relation(fields: [id], references: [things])',
    ];

    expect(
      renameFromBoth(
        files,
        ['decl.prisma', 'ite|ms Item[]'],
        ['ref.prisma', 'references: [ite|ms]'],
        'things',
      ),
    ).toEqual([edits, edits]);
  });

  it('adds none to a field typed by a model of another contract space', () => {
    const files = pair(
      ['model Item {', '  id Int @id', '  remote supabase:store.Tag', '}'],
      refModel('  item Item @relation(fields: [id], references: [remote])'),
    );
    const edits = [
      'decl.prisma: far supabase:store.Tag',
      'ref.prisma: item Item @relation(fields: [id], references: [far])',
    ];

    expect(
      renameFromBoth(
        files,
        ['decl.prisma', 'rem|ote supabase'],
        ['ref.prisma', 'references: [rem|ote]'],
        'far',
      ),
    ).toEqual([edits, edits]);
  });

  it('adds none to a model with no closing brace', () => {
    const files = pair(refModel('  item Item'), ['model Item {', '  id Int @id']);

    expect(renameAt(files, 'decl.prisma', 'item It|em', 'Product')).toEqual([
      'decl.prisma: item Product',
      'ref.prisma: model Product {',
    ]);
  });

  it('adds none to a model when the attribute specs define no map for models', () => {
    const files = pair(['model Item {', '  id Int @id', '}'], refModel('  item Item'));
    const edits = ['decl.prisma: model Product {', 'ref.prisma: item Product'];

    expect(
      renameFromBoth(
        files,
        ['decl.prisma', 'model It|em'],
        ['ref.prisma', 'item It|em'],
        'Product',
        noMapStack,
      ),
    ).toEqual([edits, edits]);
  });

  it('adds none to a field when the attribute specs define no map for fields', () => {
    const files = pair(
      ['model Item {', '  id Int @id', '  code Int', '}'],
      refModel('  item Item @relation(fields: [id], references: [code])'),
    );
    const edits = [
      'decl.prisma: sku Int',
      'ref.prisma: item Item @relation(fields: [id], references: [sku])',
    ];

    expect(
      renameFromBoth(
        files,
        ['decl.prisma', 'co|de Int'],
        ['ref.prisma', 'references: [co|de]'],
        'sku',
        noMapStack,
      ),
    ).toEqual([edits, edits]);
  });
});

describe('provideRename — where the map attribute goes', () => {
  it('puts @map after the type of a field with no attribute', () => {
    const files = { 'a.prisma': 'model Item {\n  id   Int @id\n  code Int\n}\n' };

    expect(textAfterRename(files, 'a.prisma', 'co|de Int', 'sku')).toBe(
      'model Item {\n  id   Int @id\n  sku Int @map("code")\n}\n',
    );
  });

  it('puts @map after the last attribute of a field', () => {
    const files = { 'a.prisma': 'model Item {\n  id   Int @id\n  code Int @unique @db.Wide\n}\n' };

    expect(textAfterRename(files, 'a.prisma', 'co|de Int', 'sku')).toBe(
      'model Item {\n  id   Int @id\n  sku Int @unique @db.Wide @map("code")\n}\n',
    );
  });

  it('puts @map before a trailing comment', () => {
    const files = {
      'a.prisma': 'model Item {\n  id   Int @id\n  code Int @unique   // the code\n}\n',
    };

    expect(textAfterRename(files, 'a.prisma', 'co|de Int', 'sku')).toBe(
      'model Item {\n  id   Int @id\n  sku Int @unique @map("code")   // the code\n}\n',
    );
  });

  it('puts @@map after a blank line when the last member of the model is a field', () => {
    const files = { 'a.prisma': 'model Item {\n  id   Int @id\n  code Int\n}\n' };

    const renamed = textAfterRename(files, 'a.prisma', 'model It|em', 'Product');

    expect(renamed).toBe('model Product {\n  id   Int @id\n  code Int\n\n  @@map("Item")\n}\n');
    expect(format(renamed)).toBe(renamed);
  });

  it('puts @@map right after the existing @@ attributes of the model', () => {
    const files = {
      'a.prisma': 'model Item {\n  id   Int @id\n  code Int\n\n  @@index([code])\n}\n',
    };

    const renamed = textAfterRename(files, 'a.prisma', 'model It|em', 'Product');

    expect(renamed).toBe(
      'model Product {\n  id   Int @id\n  code Int\n\n  @@index([code])\n  @@map("Item")\n}\n',
    );
    expect(format(renamed)).toBe(renamed);
  });

  it('adds no second blank line when one already precedes the closing brace', () => {
    const files = { 'a.prisma': 'model Item {\n  id Int @id\n\n}\n' };

    const renamed = textAfterRename(files, 'a.prisma', 'model It|em', 'Product');

    expect(renamed).toBe('model Product {\n  id Int @id\n\n  @@map("Item")\n}\n');
    expect(format(renamed)).toBe(renamed);
  });

  it('puts @@map after a comment that follows the last field, keeping the comment', () => {
    const files = { 'a.prisma': 'model Item {\n  id Int @id\n  // note\n}\n' };

    expect(textAfterRename(files, 'a.prisma', 'model It|em', 'Product')).toBe(
      'model Product {\n  id Int @id\n  // note\n\n  @@map("Item")\n}\n',
    );
  });

  it('ends the inserted @@map line the way the lines of a CRLF file end', () => {
    const files = { 'a.prisma': 'model Item {\r\n  id Int @id\r\n}\r\n' };

    expect(textAfterRename(files, 'a.prisma', 'model It|em', 'Product')).toBe(
      'model Product {\r\n  id Int @id\r\n\r\n  @@map("Item")\r\n}\r\n',
    );
  });

  it('moves the closing brace of a one-line model to its own line after @@map', () => {
    const files = { 'a.prisma': 'model Item { id Int }\n' };

    const renamed = textAfterRename(files, 'a.prisma', 'model It|em', 'Product');

    expect(renamed).toBe('model Product { id Int\n\n  @@map("Item")\n}\n');
    expect(format(renamed)).toBe('model Product {\n  id Int\n\n  @@map("Item")\n}\n');
  });

  it('gives an empty model a body that holds @@map alone', () => {
    const files = { 'a.prisma': 'namespace shop {\n  model Item {}\n}\n' };

    const renamed = textAfterRename(files, 'a.prisma', 'model It|em', 'Product');

    expect(renamed).toBe('namespace shop {\n  model Product {\n    @@map("Item")\n  }\n}\n');
    expect(format(renamed)).toBe(renamed);
  });

  it('puts @@map after a blank line when the last member of a block is an entry', () => {
    const files = { 'a.prisma': 'label Sticker {\n  colour = "red"\n}\n' };

    const renamed = textAfterRename(files, 'a.prisma', 'label Stic|ker', 'Badge');

    expect(renamed).toBe('label Badge {\n  colour = "red"\n\n  @@map("Sticker")\n}\n');
    expect(format(renamed)).toBe(renamed);
  });
});
