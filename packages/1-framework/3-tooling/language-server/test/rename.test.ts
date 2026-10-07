import type { AuthoringPslBlockDescriptorNamespace } from '@internal/framework-components/authoring';
import { assembleAuthoringContributions } from '@internal/framework-components/control';
import {
  buildSymbolTable,
  entityRef,
  fieldAttribute,
  fieldRef,
  list,
  modelAttribute,
  referencedFieldRef,
  str,
  structBlock,
} from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import { describe, expect, it } from 'vitest';
import {
  LSPErrorCodes,
  type Range,
  ResponseError,
  type WorkspaceEdit,
} from 'vscode-languageserver';
import { provideReferences, type ReferencesDocument } from '../src/references';
import { providePrepareRename, provideRename } from '../src/rename';
import { testBinder } from './helpers/binder';

type Files = Readonly<Record<string, string>>;

const glance: Files = {
  'auth.prisma': [
    'namespace auth {',
    '  model User {',
    '    id    Int    @id',
    '    posts Post[]',
    '  }',
    '}',
    '',
  ].join('\n'),
  'session.prisma': [
    'namespace auth {',
    '  model Session {',
    '    id     Int  @id',
    '    userId Int',
    '    user   User @relation(fields: [userId], references: [id])',
    '  }',
    '}',
    '',
  ].join('\n'),
  'post.prisma': [
    'model Post {',
    '  id       Int       @id',
    '  authorId Int',
    '  author   auth.User @relation(fields: [authorId], references: [id])',
    '',
    '  @@index([authorId])',
    '}',
    '',
  ].join('\n'),
};

const kinds: Files = {
  'tag.prisma': [
    '// Tag is mentioned in a comment',
    'model Tag {',
    '  id    Int    @id',
    '  label String @map("Tag")',
    '}',
    '',
    'type Address {',
    '  street String',
    '}',
    '',
    'enum Role {',
    '  USER',
    '}',
    '',
    'types {',
    '  Email = String',
    '}',
    '',
    'policy ReadOwn {',
    '  on = Tag',
    '}',
    '',
  ].join('\n'),
  'group.prisma': [
    'model TagGroup {',
    '  id        Int     @id',
    '  tagId     Int',
    '  tag       Tag     @relation(fields: [tagId], references: [id])',
    '  address   Address',
    '  email     Email',
    '  role      Role',
    '  embedding pgvector.Vector',
    '  remote    supabase:store.Tag',
    '  missing   Missing',
    '',
    '  @@guardedBy(ReadOwn)',
    '}',
    '',
  ].join('\n'),
};

const sameName: Files = {
  'auth.prisma': ['namespace auth {', '  model auth {', '    id Int @id', '  }', '}', ''].join(
    '\n',
  ),
  'post.prisma': ['model Post {', '  id    Int @id', '  owner auth.auth', '}', ''].join('\n'),
};

const authoringContributions = assembleAuthoringContributions([
  {
    id: 'rename-fixture',
    authoring: {
      type: {
        pgvector: {
          Vector: {
            kind: 'typeConstructor',
            output: { codecId: 'fixture/vector' },
          },
        },
      },
      attributeSpecs: {
        field: {
          id: () => fieldAttribute('id', { documentation: 'fixture' }),
          map: () =>
            fieldAttribute('map', {
              documentation: 'fixture',
              positional: [{ key: 'name', type: str(), documentation: 'fixture' }],
            }),
          relation: () =>
            fieldAttribute('relation', {
              documentation: 'fixture',
              named: {
                fields: { type: list(fieldRef()), documentation: 'fixture' },
                references: { type: list(referencedFieldRef()), documentation: 'fixture' },
              },
            }),
        },
        model: {
          index: () =>
            modelAttribute('index', {
              documentation: 'fixture',
              positional: [{ key: 'fields', type: list(fieldRef()), documentation: 'fixture' }],
            }),
          guardedBy: () =>
            modelAttribute('guardedBy', {
              documentation: 'fixture',
              positional: [
                {
                  key: 'policy',
                  type: entityRef({ kind: 'block', keyword: 'policy' }),
                  documentation: 'fixture',
                },
              ],
            }),
        },
      },
    },
  },
]);

const pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace = {
  policy: {
    kind: 'pslBlock',
    keyword: 'policy',
    discriminator: 'rename-policy',
    name: { required: true },
    spec: () =>
      structBlock({
        parameters: { on: { type: entityRef({ kind: 'model' }), documentation: 'fixture' } },
      }),
  },
};

function cursorInput(files: Files, name: string, marked: string) {
  const parsed = Object.entries(files).map(([file, text]) => parse(text, file));
  const [first, ...rest] = parsed;
  if (first === undefined) throw new Error('no files');
  const sources = first.sources.merge(...rest.map((file) => file.sources));
  const { symbolTable } = buildSymbolTable({
    documents: parsed.map((file) => file.document),
    sources,
  });
  const binder = testBinder({
    sources,
    symbolTable,
    scalarTypes: ['Int', 'String'],
    authoringContributions,
    pslBlockDescriptors,
  });
  const documents = parsed.map(
    (file): ReferencesDocument => ({
      document: file.document,
      sourceFile: file.sources.sourceFileFor(file.document.syntax),
    }),
  );
  const current = documents.find((document) => document.sourceFile.filename === name);
  if (current === undefined) throw new Error(`no file ${name}`);
  const needle = marked.replace('|', '');
  const text = current.sourceFile.text;
  const start = text.indexOf(needle);
  if (start < 0 || text.indexOf(needle, start + 1) >= 0) {
    throw new Error(`"${needle}" does not occur exactly once in ${name}`);
  }
  return {
    document: current.document,
    sourceFile: current.sourceFile,
    position: current.sourceFile.positionAt(start + marked.indexOf('|')),
    documents,
    binder,
  };
}

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
  const inside = lineWith(files, name, prepared.range, `<${prepared.placeholder}>`);
  return inside;
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

  it('returns the same edit from the last segment of a qualified reference', () => {
    expect(renameAt(glance, 'post.prisma', 'auth.Us|er', 'Account')).toEqual(userToAccount);
  });
});

describe('provideRename — a field', () => {
  it('edits the declaration name and the references entries, from the declaration name', () => {
    expect(renameAt(glance, 'auth.prisma', 'i|d    Int    @id', 'uid')).toEqual(userIdToUid);
  });

  it('returns the same edit from a references entry', () => {
    expect(renameAt(glance, 'post.prisma', 'references: [i|d]', 'uid')).toEqual(userIdToUid);
  });

  it('leaves a same-named field of another model untouched', () => {
    expect(renameAt(glance, 'session.prisma', 'i|d     Int  @id', 'sid')).toEqual([
      'session.prisma: sid     Int  @id',
    ]);
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

  it('returns the same edit from an @@index entry', () => {
    expect(renameAt(glance, 'post.prisma', '@@index([author|Id])', 'writerId')).toEqual(
      authorIdToWriterId,
    );
  });
});

describe('provideRename — a namespace', () => {
  it('edits the name of both blocks in both files and the qualifier, from a block name', () => {
    expect(renameAt(glance, 'auth.prisma', 'namespace au|th', 'identity')).toEqual(authToIdentity);
  });

  it('returns the same edit from the name of the other block', () => {
    expect(renameAt(glance, 'session.prisma', 'namespace au|th', 'identity')).toEqual(
      authToIdentity,
    );
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

  it('leaves a comment, a string and a cross-space reference that contain the name untouched', () => {
    expect(renameAt(kinds, 'tag.prisma', 'model Ta|g {', 'Label')).toEqual([
      'tag.prisma: model Label {',
      'tag.prisma: on = Label',
      'group.prisma: tag       Label     @relation(fields: [tagId], references: [id])',
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

  it('rejects a name with a space', () => {
    expect(rejectionOf('My Model')).toMatchObject({
      code: LSPErrorCodes.RequestFailed,
      message: '"My Model" is not a valid PSL identifier',
    });
  });

  it('rejects an invalid name at a position with nothing to rename', () => {
    expect(() => renameAt(kinds, 'group.prisma', 'Miss|ing', '1st')).toThrow(
      '"1st" is not a valid PSL identifier',
    );
  });
});

describe('provideRename — nothing to rename', () => {
  it('returns null on an attribute name', () => {
    expect(renameAt(kinds, 'group.prisma', '@rel|ation', 'link')).toBeNull();
  });

  it('returns null on a contributed type', () => {
    expect(renameAt(kinds, 'group.prisma', 'pgvector.Vec|tor', 'Embedding')).toBeNull();
  });

  it('returns null on a cross-space reference', () => {
    expect(renameAt(kinds, 'group.prisma', 'supabase:store.Ta|g', 'Label')).toBeNull();
  });

  it('returns null on an unresolved name', () => {
    expect(renameAt(kinds, 'group.prisma', 'Miss|ing', 'Found')).toBeNull();
  });

  it('returns null at a position with no identifier', () => {
    expect(renameAt(kinds, 'group.prisma', 'missing  | Missing', 'Found')).toBeNull();
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

  it('puts every edit of one file under that file', () => {
    const edit = provideRename({
      ...cursorInput(glance, 'post.prisma', 'author|Id Int'),
      newName: 'writerId',
    });

    expect(Object.keys(edit?.changes ?? {})).toEqual(['post.prisma']);
    expect(edit?.changes?.['post.prisma']).toHaveLength(3);
  });
});

describe('providePrepareRename — renameable symbols', () => {
  it('returns the name token of a model declaration', () => {
    expect(prepareAt(glance, 'auth.prisma', 'model Us|er')).toBe('auth.prisma: model <User> {');
  });

  it('returns the last segment of a qualified model reference', () => {
    expect(prepareAt(glance, 'post.prisma', 'auth.Us|er')).toBe(
      'post.prisma: author   auth.<User> @relation(fields: [authorId], references: [id])',
    );
  });

  it('returns the name token of a field declaration', () => {
    expect(prepareAt(glance, 'post.prisma', 'author|Id Int')).toBe('post.prisma: <authorId> Int');
  });

  it('returns the token of a field reference in an attribute argument', () => {
    expect(prepareAt(glance, 'session.prisma', 'references: [i|d]')).toBe(
      'session.prisma: user   User @relation(fields: [userId], references: [<id>])',
    );
  });

  it('returns the name token of a namespace block', () => {
    expect(prepareAt(glance, 'session.prisma', 'namespace au|th')).toBe(
      'session.prisma: namespace <auth> {',
    );
  });

  it('returns the qualifier of a qualified reference for the namespace', () => {
    expect(prepareAt(glance, 'post.prisma', 'au|th.User')).toBe(
      'post.prisma: author   <auth>.User @relation(fields: [authorId], references: [id])',
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

  it('returns the token with the cursor right after its last character', () => {
    expect(prepareAt(glance, 'post.prisma', 'auth.User| @relation')).toBe(
      'post.prisma: author   auth.<User> @relation(fields: [authorId], references: [id])',
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
