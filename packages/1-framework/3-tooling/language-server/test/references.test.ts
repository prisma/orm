import { describe, expect, it } from 'vitest';
import type { Location } from 'vscode-languageserver';
import { provideReferences, type ReferencesDocument } from '../src/references';
import { cursorInput, type Files, glance, kinds, sameName } from './helpers/reference-fixtures';

const labelled: Files = {
  'label.prisma': ['label Sticker {', '}', ''].join('\n'),
  'item.prisma': ['model Item {', '  id   Int @id', '  kind ref.label(Sticker)', '}', ''].join(
    '\n',
  ),
};

function locationsAt(
  files: Files,
  name: string,
  marked: string,
  includeDeclaration: boolean,
): { readonly documents: readonly ReferencesDocument[]; readonly locations: Location[] } {
  const input = cursorInput(files, name, marked);
  const locations = provideReferences({ ...input, includeDeclaration });
  return { documents: input.documents, locations };
}

function referencesAt(
  files: Files,
  name: string,
  marked: string,
  includeDeclaration = false,
): string[] {
  const { documents, locations } = locationsAt(files, name, marked, includeDeclaration);
  return locations.map(({ uri, range }) => {
    const target = documents.find((document) => document.sourceFile.filename === uri);
    if (target === undefined) throw new Error(`no file ${uri}`);
    if (range.start.line !== range.end.line) throw new Error('range spans lines');
    const line = target.sourceFile.text.split('\n')[range.start.line] ?? '';
    const before = line.slice(0, range.start.character);
    const inside = line.slice(range.start.character, range.end.character);
    const after = line.slice(range.end.character);
    return `${uri}: ${`${before}<${inside}>${after}`.trim()}`;
  });
}

const userUsages = [
  'session.prisma: user   <User> @relation(fields: [userId], references: [id])',
  'post.prisma: author   auth.<User> @relation(fields: [authorId], references: [id])',
];
const userDeclaration = 'auth.prisma: model <User> {';

const userIdUsages = [
  'session.prisma: user   User @relation(fields: [userId], references: [<id>])',
  'post.prisma: author   auth.User @relation(fields: [authorId], references: [<id>])',
];
const userIdDeclaration = 'auth.prisma: <id>    Int    @id';

const authorIdDeclaration = 'post.prisma: <authorId> Int';
const authorIdUsages = [
  'post.prisma: author   auth.User @relation(fields: [<authorId>], references: [id])',
  'post.prisma: @@index([<authorId>])',
];

const postUsages = ['auth.prisma: posts <Post>[]'];
const postDeclaration = 'post.prisma: model <Post> {';

const authUsages = [
  'auth.prisma: namespace <auth> {',
  'session.prisma: namespace <auth> {',
  'post.prisma: author   <auth>.User @relation(fields: [authorId], references: [id])',
];

describe('provideReferences — a model', () => {
  it('lists the usages from the declaration name', () => {
    expect(referencesAt(glance, 'auth.prisma', 'model Us|er')).toEqual(userUsages);
  });

  it('lists the same usages from an unqualified reference', () => {
    expect(referencesAt(glance, 'session.prisma', 'user   Us|er')).toEqual(userUsages);
  });

  it('lists the same usages from the last segment of a qualified reference', () => {
    expect(referencesAt(glance, 'post.prisma', 'auth.Us|er')).toEqual(userUsages);
  });

  it('adds the declaration name when the declaration is included', () => {
    expect(referencesAt(glance, 'post.prisma', 'auth.Us|er', true)).toEqual([
      userDeclaration,
      ...userUsages,
    ]);
    expect(referencesAt(glance, 'auth.prisma', 'model Us|er', true)).toEqual([
      userDeclaration,
      ...userUsages,
    ]);
  });

  it('lists a usage in another file from the declaration name', () => {
    expect(referencesAt(glance, 'post.prisma', 'model Po|st')).toEqual(postUsages);
  });

  it('lists the same usage from the reference', () => {
    expect(referencesAt(glance, 'auth.prisma', 'posts Po|st[]')).toEqual(postUsages);
    expect(referencesAt(glance, 'auth.prisma', 'posts Po|st[]', true)).toEqual([
      ...postUsages,
      postDeclaration,
    ]);
  });
});

describe('provideReferences — a field', () => {
  it('lists the references entries that name the field, from its declaration', () => {
    expect(referencesAt(glance, 'auth.prisma', 'i|d    Int    @id')).toEqual(userIdUsages);
  });

  it('lists the same entries from a references entry', () => {
    expect(referencesAt(glance, 'session.prisma', 'references: [i|d]')).toEqual(userIdUsages);
    expect(referencesAt(glance, 'post.prisma', 'references: [i|d]')).toEqual(userIdUsages);
  });

  it('adds the field declaration name when the declaration is included', () => {
    expect(referencesAt(glance, 'post.prisma', 'references: [i|d]', true)).toEqual([
      userIdDeclaration,
      ...userIdUsages,
    ]);
  });

  it('lists the fields entry and the @@index entry from the declaration name', () => {
    expect(referencesAt(glance, 'post.prisma', 'author|Id Int')).toEqual(authorIdUsages);
  });

  it('lists the same entries from a fields entry and from an @@index entry', () => {
    expect(referencesAt(glance, 'post.prisma', 'fields: [author|Id]')).toEqual(authorIdUsages);
    expect(referencesAt(glance, 'post.prisma', '@@index([author|Id])')).toEqual(authorIdUsages);
    expect(referencesAt(glance, 'post.prisma', '@@index([author|Id])', true)).toEqual([
      authorIdDeclaration,
      ...authorIdUsages,
    ]);
  });

  it('leaves out a same-named field of another model', () => {
    expect(referencesAt(glance, 'session.prisma', 'i|d     Int  @id')).toEqual([]);
    expect(referencesAt(glance, 'post.prisma', 'i|d       Int       @id', true)).toEqual([
      'post.prisma: <id>       Int       @id',
    ]);
  });
});

describe('provideReferences — a namespace', () => {
  it('lists the qualifier and the name of every block, from a qualifier', () => {
    expect(referencesAt(glance, 'post.prisma', 'au|th.User')).toEqual(authUsages);
  });

  it('lists the same from a block name', () => {
    expect(referencesAt(glance, 'auth.prisma', 'namespace au|th')).toEqual(authUsages);
    expect(referencesAt(glance, 'session.prisma', 'namespace au|th')).toEqual(authUsages);
  });

  it('returns nothing more when the declaration is included', () => {
    expect(referencesAt(glance, 'post.prisma', 'au|th.User', true)).toEqual(authUsages);
    expect(referencesAt(glance, 'session.prisma', 'namespace au|th', true)).toEqual(authUsages);
  });

  it('keeps a namespace and a model of the same name apart', () => {
    expect(referencesAt(sameName, 'post.prisma', 'owner au|th.auth', true)).toEqual([
      'auth.prisma: namespace <auth> {',
      'post.prisma: owner <auth>.auth',
    ]);
    expect(referencesAt(sameName, 'post.prisma', 'owner auth.au|th', true)).toEqual([
      'auth.prisma: model <auth> {',
      'post.prisma: owner auth.<auth>',
    ]);
    expect(referencesAt(sameName, 'auth.prisma', 'model au|th')).toEqual([
      'post.prisma: owner auth.<auth>',
    ]);
  });
});

describe('provideReferences — discarded text matches', () => {
  const tagModel = ['model Tag {', '  id Int @id', '}', ''];
  const tagDeclaration = ['tag.prisma: model <Tag> {'];

  function tagReferences(...distractor: string[]): string[] {
    const files = { 'tag.prisma': [...tagModel, ...distractor, ''].join('\n') };
    return referencesAt(files, 'tag.prisma', 'model Ta|g {', true);
  }

  it('leaves out a longer identifier that contains the name', () => {
    expect(tagReferences('model TagGroup {', '  id Int @id', '}')).toEqual(tagDeclaration);
  });

  it('leaves out the name in a comment and in a documentation comment', () => {
    expect(tagReferences('// Tag in a comment', '/// Tag in a documentation comment')).toEqual(
      tagDeclaration,
    );
  });

  it('leaves out the name in a string', () => {
    expect(tagReferences('model Label {', '  id Int @id @map("Tag")', '}')).toEqual(tagDeclaration);
  });

  it('leaves out a cross-space reference to a same-named model', () => {
    expect(
      tagReferences('model Remote {', '  id  Int @id', '  tag supabase:store.Tag', '}'),
    ).toEqual(tagDeclaration);
  });
});

describe('provideReferences — other symbol kinds', () => {
  it('lists the usages of a composite type', () => {
    expect(referencesAt(kinds, 'group.prisma', 'address   Addr|ess', true)).toEqual([
      'tag.prisma: type <Address> {',
      'group.prisma: address   <Address>',
    ]);
  });

  it('lists the usages of a named type', () => {
    expect(referencesAt(kinds, 'tag.prisma', 'Em|ail = String', true)).toEqual([
      'tag.prisma: <Email> = String',
      'group.prisma: email     <Email>',
    ]);
  });

  it('lists the usages of an enum block', () => {
    expect(referencesAt(kinds, 'group.prisma', 'role      Ro|le', true)).toEqual([
      'tag.prisma: enum <Role> {',
      'group.prisma: role      <Role>',
    ]);
  });

  it('lists the usages of a generic block', () => {
    expect(referencesAt(kinds, 'tag.prisma', 'policy Read|Own', true)).toEqual([
      'tag.prisma: policy <ReadOwn> {',
      'group.prisma: @@guardedBy(<ReadOwn>)',
    ]);
    expect(referencesAt(kinds, 'group.prisma', '@@guardedBy(Read|Own)')).toEqual([
      'group.prisma: @@guardedBy(<ReadOwn>)',
    ]);
  });

  it('lists a type constructor argument as a usage of the block it names', () => {
    expect(referencesAt(labelled, 'label.prisma', 'label Stic|ker')).toEqual([
      'item.prisma: kind ref.label(<Sticker>)',
    ]);
  });

  it('lists the declaration and the usage from a type constructor argument', () => {
    expect(referencesAt(labelled, 'item.prisma', 'ref.label(Stic|ker)', true)).toEqual([
      'label.prisma: label <Sticker> {',
      'item.prisma: kind ref.label(<Sticker>)',
    ]);
  });

  it('lists the same usages from an entity reference in an attribute', () => {
    expect(referencesAt(kinds, 'group.prisma', '@@extends(Ta|g)')).toEqual([
      'tag.prisma: on = <Tag>',
      'group.prisma: tag       <Tag>     @relation(fields: [tagId], references: [id])',
      'group.prisma: @@extends(<Tag>)',
    ]);
  });

  it('lists the same usages from an entity reference in a block value', () => {
    expect(referencesAt(kinds, 'tag.prisma', 'on = Ta|g\n')).toEqual([
      'tag.prisma: on = <Tag>',
      'group.prisma: tag       <Tag>     @relation(fields: [tagId], references: [id])',
      'group.prisma: @@extends(<Tag>)',
    ]);
  });
});

describe('provideReferences — a symbol with no references', () => {
  it('returns nothing without the declaration', () => {
    expect(referencesAt(kinds, 'tag.prisma', 'policy Unu|sed')).toEqual([]);
  });

  it('returns the declaration alone when it is included', () => {
    expect(referencesAt(kinds, 'tag.prisma', 'policy Unu|sed', true)).toEqual([
      'tag.prisma: policy <Unused> {',
    ]);
  });
});

describe('provideReferences — no target', () => {
  it.each([
    ['an attribute name', '@rel|ation'],
    ['a contributed type', 'pgvector.Vec|tor'],
    ['a contributed namespace', 'pgve|ctor.Vector'],
    ['a cross-space reference', 'supabase:store.Ta|g'],
    ['an unresolved name', 'Miss|ing'],
    ['an attribute argument key', '@relation(fie|lds:'],
    ['whitespace between a field name and its type', 'missing  | Missing'],
  ])('returns nothing for %s', (_, marked) => {
    expect(referencesAt(kinds, 'group.prisma', marked, true)).toEqual([]);
  });
});

describe('provideReferences — cursor boundaries', () => {
  it('returns the same usages with the cursor right after the last character of a name', () => {
    expect(referencesAt(glance, 'auth.prisma', 'model User| {')).toEqual(userUsages);
    expect(referencesAt(glance, 'post.prisma', 'auth.User| @relation')).toEqual(userUsages);
  });

  it('returns the same usages with the cursor right before the first character of a name', () => {
    expect(referencesAt(glance, 'post.prisma', 'auth.|User @relation')).toEqual(userUsages);
  });

  it('returns the namespace usages with the cursor right after the qualifier', () => {
    expect(referencesAt(glance, 'post.prisma', 'auth|.User')).toEqual(authUsages);
  });
});

describe('provideReferences — response shape', () => {
  it('returns one location per identifier token, in document order then by offset', () => {
    const { locations } = locationsAt(glance, 'post.prisma', 'auth.Us|er', true);

    expect(locations).toEqual<Location[]>([
      {
        uri: 'auth.prisma',
        range: { start: { line: 1, character: 8 }, end: { line: 1, character: 12 } },
      },
      {
        uri: 'session.prisma',
        range: { start: { line: 4, character: 11 }, end: { line: 4, character: 15 } },
      },
      {
        uri: 'post.prisma',
        range: { start: { line: 3, character: 16 }, end: { line: 3, character: 20 } },
      },
    ]);
  });
});
