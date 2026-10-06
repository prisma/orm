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
import type { Location } from 'vscode-languageserver';
import { provideReferences, type ReferencesDocument } from '../src/references';
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
    '/// Tag is mentioned in a documentation comment',
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
    'policy Unused {',
    '  on = TagGroup',
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
    '  @@extends(Tag)',
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
    id: 'references-fixture',
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
          extends: () =>
            modelAttribute('extends', {
              documentation: 'fixture',
              positional: [
                { key: 'model', type: entityRef({ kind: 'model' }), documentation: 'fixture' },
              ],
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
    discriminator: 'references-policy',
    name: { required: true },
    spec: () =>
      structBlock({
        parameters: { on: { type: entityRef({ kind: 'model' }), documentation: 'fixture' } },
      }),
  },
};

function project(files: Files) {
  const parsed = Object.entries(files).map(([name, text]) => parse(text, name));
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
      text: file.sources.sourceFileFor(file.document.syntax).text,
      document: file.document,
      sourceFile: file.sources.sourceFileFor(file.document.syntax),
    }),
  );
  return { documents, binder };
}

function locationsAt(
  files: Files,
  name: string,
  marked: string,
  includeDeclaration: boolean,
): { readonly documents: readonly ReferencesDocument[]; readonly locations: Location[] } {
  const { documents, binder } = project(files);
  const current = documents.find((document) => document.sourceFile.filename === name);
  if (current === undefined) throw new Error(`no file ${name}`);
  const needle = marked.replace('|', '');
  const start = current.text.indexOf(needle);
  if (start < 0 || current.text.indexOf(needle, start + 1) >= 0) {
    throw new Error(`"${needle}" does not occur exactly once in ${name}`);
  }
  const locations = provideReferences(
    { document: current.document, sourceFile: current.sourceFile, documents, binder },
    current.sourceFile.positionAt(start + marked.indexOf('|')),
    includeDeclaration,
  );
  return { documents, locations };
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
    const line = target.text.split('\n')[range.start.line] ?? '';
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
  it('leaves out longer identifiers, comments, strings and a cross-space reference', () => {
    expect(referencesAt(kinds, 'tag.prisma', 'model Ta|g', true)).toEqual([
      'tag.prisma: model <Tag> {',
      'tag.prisma: on = <Tag>',
      'group.prisma: tag       <Tag>     @relation(fields: [tagId], references: [id])',
      'group.prisma: @@extends(<Tag>)',
    ]);
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
