import { describe, expect, it } from 'vitest';
import {
  LSPErrorCodes,
  type Range,
  ResponseError,
  type WorkspaceEdit,
} from 'vscode-languageserver';
import { provideReferences } from '../src/references';
import { providePrepareRename, provideRename } from '../src/rename';
import { cursorInput, type Files, glance, kinds, sameName } from './helpers/reference-fixtures';

function lineWith(files: Files, uri: string, range: Range, replacement: string): string {
  const text = files[uri];
  if (text === undefined) throw new Error(`no file ${uri}`);
  if (range.start.line !== range.end.line) throw new Error('range spans lines');
  const line = text.split('\n')[range.start.line] ?? '';
  const before = line.slice(0, range.start.character);
  const after = line.slice(range.end.character);
  return `${uri}: ${`${before}${replacement}${after}`.trim()}`;
}

function renameAt(files: Files, name: string, marked: string, newName: string): string[] | null {
  const edit = provideRename({ ...cursorInput(files, name, marked), newName });
  if (edit === null) return null;
  return Object.entries(edit.changes ?? {}).flatMap(([uri, edits]) =>
    edits.map(({ range, newText }) => lineWith(files, uri, range, newText)),
  );
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
  'session.prisma: user   Account @relation(fields: [userId], references: [id])',
  'post.prisma: author   auth.Account @relation(fields: [authorId], references: [id])',
];

const userIdToUid = [
  'auth.prisma: uid    Int    @id',
  'session.prisma: user   User @relation(fields: [userId], references: [uid])',
  'post.prisma: author   auth.User @relation(fields: [authorId], references: [uid])',
];

const authorIdToWriterId = [
  'post.prisma: writerId Int',
  'post.prisma: author   auth.User @relation(fields: [writerId], references: [id])',
  'post.prisma: @@index([writerId])',
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
      'post.prisma: owner auth.Account',
    ]);
  });
});

describe('provideRename — other symbol kinds', () => {
  it('renames a composite type', () => {
    expect(renameAt(kinds, 'group.prisma', 'address   Addr|ess', 'Location')).toEqual([
      'tag.prisma: type Location {',
      'group.prisma: address   Location',
    ]);
  });

  it('renames a named type', () => {
    expect(renameAt(kinds, 'tag.prisma', 'Em|ail = String', 'Mail')).toEqual([
      'tag.prisma: Mail = String',
      'group.prisma: email     Mail',
    ]);
  });

  it('renames an enum block', () => {
    expect(renameAt(kinds, 'group.prisma', 'role      Ro|le', 'Rank')).toEqual([
      'tag.prisma: enum Rank {',
      'group.prisma: role      Rank',
    ]);
  });

  it('renames a generic block', () => {
    expect(renameAt(kinds, 'tag.prisma', 'policy Read|Own', 'ReadMine')).toEqual([
      'tag.prisma: policy ReadMine {',
      'group.prisma: @@guardedBy(ReadMine)',
    ]);
  });
});

describe('provideRename — the new name', () => {
  it('returns an ordinary edit when the new name equals the current name', () => {
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
  it('returns one text edit per find-references location, grouped by file', () => {
    const input = cursorInput(glance, 'post.prisma', 'auth.Us|er');

    const edit = provideRename({ ...input, newName: 'Account' });

    expect(edit).toEqual<WorkspaceEdit>({
      changes: {
        'auth.prisma': [
          {
            range: { start: { line: 1, character: 8 }, end: { line: 1, character: 12 } },
            newText: 'Account',
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
        edits.map(({ range }) => ({ uri, range })),
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
