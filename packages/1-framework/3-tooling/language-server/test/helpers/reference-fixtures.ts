import type { AuthoringPslBlockDescriptorNamespace } from '@internal/framework-components/authoring';
import {
  type AssembledAuthoringContributions,
  assembleAuthoringContributions,
  type ControlMutationDefaults,
} from '@internal/framework-components/control';
import {
  type Binder,
  buildSymbolTable,
  entityRef,
  fieldAttribute,
  fieldRef,
  list,
  modelAttribute,
  referencedFieldRef,
  type SymbolTable,
  str,
  structBlock,
} from '@internal/psl-parser';
import { type ResolvedFormatOptions, resolveFormatOptions } from '@internal/psl-parser/format';
import { type DocumentAst, parse, type SourceFile } from '@internal/psl-parser/syntax';
import type { Position } from 'vscode-languageserver';
import type { ReferencesDocument } from '../../src/references';
import { testBinder } from './binder';

export type Files = Readonly<Record<string, string>>;

export const glance: Files = {
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

export const kinds: Files = {
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

export const sameName: Files = {
  'auth.prisma': ['namespace auth {', '  model auth {', '    id Int @id', '  }', '}', ''].join(
    '\n',
  ),
  'post.prisma': ['model Post {', '  id    Int @id', '  owner auth.auth', '}', ''].join('\n'),
};

export interface FixtureStack {
  readonly authoringContributions: AssembledAuthoringContributions;
  readonly pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace;
}

const authoringContributions = assembleAuthoringContributions([
  {
    id: 'reference-fixtures',
    authoring: {
      type: {
        pgvector: {
          Vector: {
            kind: 'typeConstructor',
            output: { codecId: 'fixture/vector' },
          },
        },
        ref: {
          label: {
            kind: 'typeConstructor',
            entityRefArg: { index: 0, entityKind: 'references-label' },
            output: { codecId: 'fixture/label' },
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
          map: () =>
            modelAttribute('map', {
              documentation: 'fixture',
              positional: [{ key: 'name', type: str(), documentation: 'fixture' }],
            }),
          base: () =>
            modelAttribute('base', {
              documentation: 'fixture',
              positional: [
                { key: 'model', type: entityRef({ kind: 'model' }), documentation: 'fixture' },
              ],
            }),
          labelled: () =>
            modelAttribute('labelled', {
              documentation: 'fixture',
              positional: [
                {
                  key: 'label',
                  type: entityRef({ kind: 'block', keyword: 'label' }),
                  documentation: 'fixture',
                },
              ],
            }),
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
  label: {
    kind: 'pslBlock',
    keyword: 'label',
    discriminator: 'references-label',
    name: { required: true },
    spec: () => structBlock({ parameters: {} }),
    nameIsStorageName: true,
  },
};

const fixtureStack: FixtureStack = { authoringContributions, pslBlockDescriptors };

function project(files: Files, stack: FixtureStack) {
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
    ...stack,
  });
  const documents = parsed.map(
    (file): ReferencesDocument => ({
      document: file.document,
      sourceFile: file.sources.sourceFileFor(file.document.syntax),
    }),
  );
  return { documents, binder, symbolTable };
}

export interface FixtureCursorInput extends FixtureStack {
  readonly document: DocumentAst;
  readonly sourceFile: SourceFile;
  readonly position: Position;
  readonly documents: readonly ReferencesDocument[];
  readonly binder: Binder;
  readonly symbolTable: SymbolTable;
  readonly controlMutationDefaults: ControlMutationDefaults;
  readonly formatOptions: ResolvedFormatOptions;
}

export function cursorInput(
  files: Files,
  name: string,
  marked: string,
  stack: FixtureStack = fixtureStack,
): FixtureCursorInput {
  const { documents, binder, symbolTable } = project(files, stack);
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
    symbolTable,
    ...stack,
    controlMutationDefaults: { defaultFunctionRegistry: new Map(), generatorDescriptors: [] },
    formatOptions: resolveFormatOptions(undefined),
  };
}
