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
import { parse, type SourceFile } from '@internal/psl-parser/syntax';
import { describe, expect, it } from 'vitest';
import type { Location, LocationLink, Range } from 'vscode-languageserver';
import { provideDefinition } from '../src/definition';
import { testBinder } from './helpers/binder';

const authUri = 'file:///schema/auth.prisma';
const postUri = 'file:///schema/post.prisma';

const authSource = [
  'namespace auth {',
  '  model User {',
  '    id    Int    @id',
  '    posts Post[]',
  '  }',
  '}',
  '',
].join('\n');

const postSource = [
  'namespace auth {',
  '  model Session {',
  '    id Int @id',
  '  }',
  '}',
  '',
  'model Post {',
  '  id        Int       @id',
  '  authorId  Int',
  '  author    auth.User @relation(fields: [authorId], references: [id])',
  '  role      Role',
  '  email     Email',
  '  embedding pgvector.Vector',
  '  remote    supabase:auth.User',
  '  missing   Missing',
  '',
  '  @@index([authorId])',
  '  @@extends(Tag)',
  '}',
  '',
  'model Tag {',
  '  id Int @id',
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
  'policy PostPolicy {',
  '  on = Post',
  '}',
  '',
].join('\n');

const fieldList = (key: string) => ({
  key,
  type: list(fieldRef()),
  documentation: 'fixture',
});

const authoringContributions = assembleAuthoringContributions([
  {
    id: 'definition-fixture',
    authoring: {
      type: {
        pgvector: {
          Vector: {
            kind: 'typeConstructor',
            output: { codecId: 'fixture/vector', nativeType: 'vector' },
          },
        },
      },
      attributeSpecs: {
        field: {
          id: () => fieldAttribute('id', { documentation: 'fixture' }),
          relation: () =>
            fieldAttribute('relation', {
              documentation: 'fixture',
              named: {
                fields: { type: list(fieldRef()), documentation: 'fixture' },
                references: { type: list(referencedFieldRef()), documentation: 'fixture' },
                name: { type: str(), documentation: 'fixture' },
              },
            }),
        },
        model: {
          index: () =>
            modelAttribute('index', {
              documentation: 'fixture',
              positional: [fieldList('fields')],
            }),
          extends: () =>
            modelAttribute('extends', {
              documentation: 'fixture',
              positional: [
                { key: 'model', type: entityRef({ kind: 'model' }), documentation: 'fixture' },
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
    discriminator: 'definition-policy',
    name: { required: true },
    spec: () =>
      structBlock({
        parameters: { on: { type: entityRef({ kind: 'model' }), documentation: 'fixture' } },
      }),
  },
};

function project(files: Readonly<Record<string, string>>) {
  const parsed = Object.entries(files).map(([uri, text]) => parse(text, uri));
  const [first, ...rest] = parsed;
  if (first === undefined) throw new Error('no files');
  const sources = first.sources.merge(...rest.map((file) => file.sources));
  const documents = parsed.map((file) => file.document);
  const { symbolTable } = buildSymbolTable({ documents, sources });
  const binder = testBinder({
    sources,
    symbolTable,
    scalarTypes: ['Int', 'String'],
    authoringContributions,
    pslBlockDescriptors,
  });
  return { parsed, sources, binder };
}

function sourceFileOf(files: ReturnType<typeof project>, uri: string): SourceFile {
  for (const file of files.parsed) {
    const sourceFile = file.sources.sourceFileFor(file.document.syntax);
    if (sourceFile.filename === uri) return sourceFile;
  }
  throw new Error(`no source file ${uri}`);
}

function textOf(sourceFile: SourceFile, range: Range): string {
  return sourceFile.text.slice(sourceFile.offsetAt(range.start), sourceFile.offsetAt(range.end));
}

function definitionAt(uri: string, marked: string, linkSupport = true) {
  const files = project({ [authUri]: authSource, [postUri]: postSource });
  const sourceFile = sourceFileOf(files, uri);
  const needle = marked.replace('|', '');
  const start = sourceFile.text.indexOf(needle);
  if (start < 0 || sourceFile.text.indexOf(needle, start + 1) >= 0) {
    throw new Error(`"${needle}" does not occur exactly once in ${uri}`);
  }
  const offset = start + marked.indexOf('|');
  const document = files.parsed.find(
    (file) => file.sources.sourceFileFor(file.document.syntax) === sourceFile,
  )?.document;
  if (document === undefined) throw new Error(`no document ${uri}`);
  const result = provideDefinition(
    { document, sourceFile, sources: files.sources, binder: files.binder },
    sourceFile.positionAt(offset),
    linkSupport,
  );
  return { files, sourceFile, result };
}

function linksAt(uri: string, marked: string) {
  const { files, sourceFile, result } = definitionAt(uri, marked);
  if (result === null) return null;
  return result.map((entry) => {
    const link = entry as LocationLink;
    const target = sourceFileOf(files, link.targetUri);
    return {
      uri: link.targetUri,
      target: textOf(target, link.targetRange),
      name: textOf(target, link.targetSelectionRange),
      origin: link.originSelectionRange && textOf(sourceFile, link.originSelectionRange),
    };
  });
}

const userModel = 'model User {\n    id    Int    @id\n    posts Post[]\n  }';
const postModel = postSource.slice(
  postSource.indexOf('model Post {'),
  postSource.indexOf('}\n\nmodel Tag') + 1,
);

describe('provideDefinition — references', () => {
  it('goes from a qualified type reference to the model', () => {
    expect(linksAt(postUri, 'auth.Us|er @relation')).toEqual([
      { uri: authUri, target: userModel, name: 'User', origin: 'auth.User' },
    ]);
  });

  it('goes from a qualifier to every block of the namespace, across files', () => {
    expect(linksAt(postUri, 'au|th.User @relation')).toEqual([
      { uri: authUri, target: authSource.trimEnd(), name: 'auth', origin: 'auth' },
      {
        uri: postUri,
        target: postSource.slice(0, postSource.indexOf('\n\nmodel Post')),
        name: 'auth',
        origin: 'auth',
      },
    ]);
  });

  it('goes from a type reference in another file to the model', () => {
    expect(linksAt(authUri, 'posts Po|st[]')).toEqual([
      { uri: postUri, target: postModel, name: 'Post', origin: 'Post' },
    ]);
  });

  it('goes from a relation fields entry to the field', () => {
    expect(linksAt(postUri, 'fields: [author|Id]')).toEqual([
      { uri: postUri, target: 'authorId  Int', name: 'authorId', origin: 'authorId' },
    ]);
  });

  it('goes from a relation references entry to the field on the referenced model', () => {
    expect(linksAt(postUri, 'references: [i|d]')).toEqual([
      { uri: authUri, target: 'id    Int    @id', name: 'id', origin: 'id' },
    ]);
  });

  it('goes from an @@index entry to the field', () => {
    expect(linksAt(postUri, '@@index([authorId|])')).toEqual([
      { uri: postUri, target: 'authorId  Int', name: 'authorId', origin: 'authorId' },
    ]);
  });

  it('goes from an entity reference in an attribute to the model', () => {
    expect(linksAt(postUri, '@@extends(|Tag)')).toEqual([
      { uri: postUri, target: 'model Tag {\n  id Int @id\n}', name: 'Tag', origin: 'Tag' },
    ]);
  });

  it('goes from an entity reference in a block value to the model', () => {
    expect(linksAt(postUri, 'on = Po|st')).toEqual([
      { uri: postUri, target: postModel, name: 'Post', origin: 'Post' },
    ]);
  });

  it('goes from a type reference to a named type', () => {
    expect(linksAt(postUri, 'email     Em|ail')).toEqual([
      { uri: postUri, target: 'Email = String', name: 'Email', origin: 'Email' },
    ]);
  });

  it('goes from a type reference to an enum block', () => {
    expect(linksAt(postUri, 'role      Ro|le')).toEqual([
      { uri: postUri, target: 'enum Role {\n  USER\n}', name: 'Role', origin: 'Role' },
    ]);
  });
});

describe('provideDefinition — no target', () => {
  it.each([
    ['a declaration name', 'model Ta|g'],
    ['a field declaration name', 'auth|orId  Int'],
    ['a contributed type', 'embedding pgvector.Vec|tor'],
    ['a contributed namespace', 'embedding pgve|ctor.Vector'],
    ['a cross-space reference', 'supabase:auth.Us|er'],
    ['an attribute name', '@rel|ation'],
    ['an unresolved name', 'Miss|ing'],
    ['whitespace inside a model', '  missing   Missing\n|\n'],
  ])('returns null for %s', (_, marked) => {
    expect(linksAt(postUri, marked)).toBeNull();
  });
});

describe('provideDefinition — response shape', () => {
  it('returns links with exact ranges when the client supports links', () => {
    const { result } = definitionAt(postUri, '@@extends(Ta|g)');

    expect(result).toEqual([
      {
        targetUri: postUri,
        targetRange: { start: { line: 20, character: 0 }, end: { line: 22, character: 1 } },
        targetSelectionRange: {
          start: { line: 20, character: 6 },
          end: { line: 20, character: 9 },
        },
        originSelectionRange: {
          start: { line: 17, character: 12 },
          end: { line: 17, character: 15 },
        },
      },
    ]);
  });

  it('returns locations of declaration names when the client does not support links', () => {
    const { result } = definitionAt(postUri, 'au|th.User @relation', false);

    expect(result).toEqual<Location[]>([
      {
        uri: authUri,
        range: { start: { line: 0, character: 10 }, end: { line: 0, character: 14 } },
      },
      {
        uri: postUri,
        range: { start: { line: 0, character: 10 }, end: { line: 0, character: 14 } },
      },
    ]);
  });
});
