import type { AuthoringPslBlockDescriptorNamespace } from '@internal/framework-components/authoring';
import { assembleAuthoringContributions } from '@internal/framework-components/control';
import {
  buildSymbolTable,
  entityRef,
  fieldAttribute,
  fieldRef,
  list,
  modelAttribute,
  optional,
  str,
  structBlock,
} from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import { describe, expect, it } from 'vitest';
import { providePslHover } from '../src/hover';
import { testBinder } from './helpers/binder';

const relatesTo = fieldAttribute('relatesTo', {
  documentation: '',
  named: { fields: { type: fieldRef(), documentation: '' } },
});
const guardedBy = modelAttribute('guardedBy', {
  documentation: '',
  named: { policy: { type: entityRef({ kind: 'block', keyword: 'policy' }), documentation: '' } },
});
const relationSpec = fieldAttribute('relation', {
  documentation: 'Declares a relation.',
  named: { name: { type: optional(str()), documentation: 'An explicit relation name.' } },
});
const indexSpec = modelAttribute('index', {
  documentation: 'Declares an index.',
  named: { fields: { type: list(str()), documentation: 'Indexed field names.' } },
});
const authoringContributions = assembleAuthoringContributions([
  {
    id: 'hover-fixture',
    authoring: {
      attributeSpecs: {
        field: { relatesTo: () => relatesTo, relation: () => relationSpec },
        model: { guardedBy: () => guardedBy, index: () => indexSpec },
      },
      type: {
        pg: {
          Varchar: {
            kind: 'typeConstructor',
            documentation: 'A variable-length string.',
            args: [{ name: 'length', kind: 'number' }],
            output: { codecId: 'fixture/varchar', nativeType: 'varchar' },
          },
          Text: {
            kind: 'typeConstructor',
            output: { codecId: 'fixture/text', nativeType: 'text' },
          },
          Tags: {
            kind: 'typeConstructor',
            documentation: 'A list of tags.',
            args: [{ name: 'tags', kind: 'stringArray' }],
            output: { codecId: 'fixture/tags', nativeType: 'tags' },
          },
          Mode: {
            kind: 'typeConstructor',
            documentation: 'A deletion mode.',
            args: [{ name: 'mode', kind: 'option', values: ['cascade', 'restrict'] }],
            output: { codecId: 'fixture/mode', nativeType: 'mode' },
          },
          Flag: {
            kind: 'typeConstructor',
            documentation: '',
            output: { codecId: 'fixture/flag', nativeType: 'flag' },
          },
        },
      },
      field: {
        pg: {
          Serial: {
            kind: 'fieldPreset',
            args: [{ name: 'start', kind: 'number' }],
            output: { codecId: 'fixture/serial', nativeType: 'serial' },
          },
        },
      },
    },
  },
]);
const pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace = {
  policy: {
    kind: 'pslBlock',
    documentation: 'Row-level access rule.',
    keyword: 'policy',
    discriminator: 'hover-policy',
    name: { required: true },
    spec: () => structBlock({ parameters: {} }),
  },
  view: {
    kind: 'pslBlock',
    keyword: 'view',
    discriminator: 'hover-view',
    name: { required: true },
    spec: () => structBlock({ parameters: {} }),
  },
};

function hover(markedSource: string, siblings: readonly string[] = []) {
  const offset = markedSource.indexOf('|');
  expect(offset).toBeGreaterThanOrEqual(0);
  const source = markedSource.slice(0, offset) + markedSource.slice(offset + 1);
  const parsed = parse(source, 'language-server-test.psl');
  const { document } = parsed;
  const others = siblings.map((text, index) => parse(text, `sibling-${index}.psl`));
  const sources = parsed.sources.merge(...others.map((other) => other.sources));
  const sourceFile = sources.sourceFileFor(document.syntax);
  const { symbolTable } = buildSymbolTable({
    documents: [...others.map((other) => other.document), document],
    sources,
  });
  return providePslHover({
    document,
    sourceFile,
    position: sourceFile.positionAt(offset),
    binder: testBinder({ sources, symbolTable, authoringContributions, pslBlockDescriptors }),
    pslBlockDescriptors,
  });
}

describe('providePslHover', () => {
  it('shows a model declaration line and doc at a reference', () => {
    const result = hover('/// A user.\nmodel User {\n  id Int\n}\nmodel Post {\n  author Us|er\n}');
    expect(result).toEqual({
      contents: { kind: 'markdown', value: '```prisma\nmodel User\n```\n\nA user.' },
      range: { start: { line: 5, character: 9 }, end: { line: 5, character: 13 } },
    });
  });

  it('shows a model declaration line and doc at the declaration name', () => {
    const result = hover('/// A user.\nmodel Us|er {\n  id Int\n}');
    expect(result).toEqual({
      contents: { kind: 'markdown', value: '```prisma\nmodel User\n```\n\nA user.' },
      range: { start: { line: 1, character: 6 }, end: { line: 1, character: 10 } },
    });
  });

  it('shows a composite-type declaration line at a reference', () => {
    const result = hover(
      '/// An address.\ntype Address {\n  street String\n}\nmodel Person {\n  home Add|ress\n}',
    );
    expect(result).toEqual({
      contents: { kind: 'markdown', value: '```prisma\ntype Address\n```\n\nAn address.' },
      range: { start: { line: 5, character: 7 }, end: { line: 5, character: 14 } },
    });
  });

  it('shows a composite-type declaration line at the declaration name', () => {
    const result = hover('/// An address.\ntype Addr|ess {\n  street String\n}');
    expect(result).toEqual({
      contents: { kind: 'markdown', value: '```prisma\ntype Address\n```\n\nAn address.' },
      range: { start: { line: 1, character: 5 }, end: { line: 1, character: 12 } },
    });
  });

  it('shows a field declaration line and doc at a reference', () => {
    const result = hover(
      'model User {\n  /// The primary key.\n  id Int\n  name String @relatesTo(fields: i|d)\n}',
    );
    expect(result).toEqual({
      contents: { kind: 'markdown', value: '```prisma\nid Int\n```\n\nThe primary key.' },
      range: { start: { line: 3, character: 33 }, end: { line: 3, character: 35 } },
    });
  });

  it('shows a field declaration line and doc at the declaration name', () => {
    const result = hover('model User {\n  /// The primary key.\n  i|d Int\n}');
    expect(result).toEqual({
      contents: { kind: 'markdown', value: '```prisma\nid Int\n```\n\nThe primary key.' },
      range: { start: { line: 2, character: 2 }, end: { line: 2, character: 4 } },
    });
  });

  it('excludes a comment that sits inside multi-line attribute arguments', () => {
    const result = hover(
      'model User {\n  au|thor User @relation(\n    // cascade rationale\n    fields: [authorId],\n    references: [id]\n  )\n}',
    );
    expect(result).toEqual({
      contents: {
        kind: 'markdown',
        value: '```prisma\nauthor User @relation( fields: [authorId], references: [id] )\n```',
      },
      range: { start: { line: 1, character: 2 }, end: { line: 1, character: 8 } },
    });
  });

  it('collapses a multi-line field declaration with no comment to one line', () => {
    const result = hover(
      'model User {\n  au|thor User @relation(\n    fields: [authorId],\n    references: [id]\n  )\n}',
    );
    expect(result).toEqual({
      contents: {
        kind: 'markdown',
        value: '```prisma\nauthor User @relation( fields: [authorId], references: [id] )\n```',
      },
      range: { start: { line: 1, character: 2 }, end: { line: 1, character: 8 } },
    });
  });

  it('excludes a trailing same-line comment from the declaration line', () => {
    const result = hover('model User {\n  i|d Int // note\n}');
    expect(result).toEqual({
      contents: { kind: 'markdown', value: '```prisma\nid Int\n```' },
      range: { start: { line: 1, character: 2 }, end: { line: 1, character: 4 } },
    });
  });

  it('shows a named-type declaration line at a reference', () => {
    const result = hover(
      'types {\n  /// A short string.\n  Short = String\n}\nmodel Person {\n  name Sho|rt\n}',
    );
    expect(result).toEqual({
      contents: { kind: 'markdown', value: '```prisma\nShort = String\n```\n\nA short string.' },
      range: { start: { line: 5, character: 7 }, end: { line: 5, character: 12 } },
    });
  });

  it('shows a named-type declaration line at the declaration name', () => {
    const result = hover('types {\n  /// A short string.\n  Sho|rt = String\n}');
    expect(result).toEqual({
      contents: { kind: 'markdown', value: '```prisma\nShort = String\n```\n\nA short string.' },
      range: { start: { line: 2, character: 2 }, end: { line: 2, character: 7 } },
    });
  });

  it('shows a block declaration line at a reference', () => {
    const result = hover(
      '/// Owner-only access.\npolicy ReadOwn {\n}\nmodel Invoice {\n  id Int\n  @@guardedBy(policy: ReadO|wn)\n}',
    );
    expect(result).toEqual({
      contents: {
        kind: 'markdown',
        value: '```prisma\npolicy ReadOwn\n```\n\nOwner-only access.',
      },
      range: { start: { line: 5, character: 22 }, end: { line: 5, character: 29 } },
    });
  });

  it('shows a block declaration line at the declaration name', () => {
    const result = hover('/// Owner-only access.\npolicy ReadO|wn {\n}');
    expect(result).toEqual({
      contents: {
        kind: 'markdown',
        value: '```prisma\npolicy ReadOwn\n```\n\nOwner-only access.',
      },
      range: { start: { line: 1, character: 7 }, end: { line: 1, character: 14 } },
    });
  });

  it('reads the declaration and doc from another source file of the same project', () => {
    const result = hover('model Post {\n  author Use|r\n}', [
      '/// A user.\nmodel User {\n  id Int\n}',
    ]);
    expect(result).toEqual({
      contents: { kind: 'markdown', value: '```prisma\nmodel User\n```\n\nA user.' },
      range: { start: { line: 1, character: 9 }, end: { line: 1, character: 13 } },
    });
  });

  it('omits the doc section when the declaration has no ///', () => {
    const result = hover('model Us|er {\n  id Int\n}');
    expect(result).toEqual({
      contents: { kind: 'markdown', value: '```prisma\nmodel User\n```' },
      range: { start: { line: 0, character: 6 }, end: { line: 0, character: 10 } },
    });
  });

  it('omits the doc section when the /// is bare', () => {
    const result = hover('///\nmodel Us|er {\n  id Int\n}');
    expect(result).toEqual({
      contents: { kind: 'markdown', value: '```prisma\nmodel User\n```' },
      range: { start: { line: 1, character: 6 }, end: { line: 1, character: 10 } },
    });
  });

  it('returns null for an unresolved name', () => {
    const result = hover('model Post {\n  author Unkno|wn\n}');
    expect(result).toBeNull();
  });

  it('returns null for a namespace resolution', () => {
    const result = hover(
      'namespace billing {\n  model Invoice {\n    id Int\n  }\n}\nmodel Foo {\n  bad billi|ng\n}',
    );
    expect(result).toBeNull();
  });

  it('returns null for a contributedNamespace resolution', () => {
    const result = hover('model Product {\n  label p|g\n}');
    expect(result).toBeNull();
  });

  it('returns null for a crossSpace reference', () => {
    const result = hover('model Cart {\n  user auth:Us|er\n}');
    expect(result).toBeNull();
  });

  it('returns null when the cursor is not on an Ident token', () => {
    const result = hover('model User {| id Int\n}');
    expect(result).toBeNull();
  });

  it('shows a field-attribute signature label and its documentation', () => {
    const result = hover('model User {\n  id Int\n  author User @relat|ion\n}');
    expect(result).toEqual({
      contents: {
        kind: 'markdown',
        value: '```prisma\n@relation(name?: string)\n```\n\nDeclares a relation.',
      },
      range: { start: { line: 2, character: 15 }, end: { line: 2, character: 23 } },
    });
  });

  it('shows a model-attribute signature label and its documentation', () => {
    const result = hover('model User {\n  id Int\n  @@ind|ex\n}');
    expect(result).toEqual({
      contents: {
        kind: 'markdown',
        value: '```prisma\n@@index(fields: string[])\n```\n\nDeclares an index.',
      },
      range: { start: { line: 2, character: 4 }, end: { line: 2, character: 9 } },
    });
  });

  it('omits the documentation section when spec.documentation is empty', () => {
    const result = hover('model User {\n  id Int\n  author User @relates|To(fields: id)\n}');
    expect(result).toEqual({
      contents: { kind: 'markdown', value: '```prisma\n@relatesTo(fields: field name)\n```' },
      range: { start: { line: 2, character: 15 }, end: { line: 2, character: 24 } },
    });
  });

  it('shows a contributed type with documentation and args', () => {
    const result = hover('model Product {\n  price pg.Varc|har(255)\n}');
    expect(result).toEqual({
      contents: {
        kind: 'markdown',
        value: '```prisma\npg.Varchar(length: number)\n```\n\nA variable-length string.',
      },
      range: { start: { line: 1, character: 11 }, end: { line: 1, character: 18 } },
    });
  });

  it('shows a contributed type without documentation as the bare path', () => {
    const result = hover('model Product {\n  label pg.Te|xt\n}');
    expect(result).toEqual({
      contents: { kind: 'markdown', value: '```prisma\npg.Text\n```' },
      range: { start: { line: 1, character: 11 }, end: { line: 1, character: 15 } },
    });
  });

  it('omits the documentation section when descriptor.documentation is empty', () => {
    const result = hover('model Product {\n  flag pg.Fl|ag\n}');
    expect(result).toEqual({
      contents: { kind: 'markdown', value: '```prisma\npg.Flag\n```' },
      range: { start: { line: 1, character: 10 }, end: { line: 1, character: 14 } },
    });
  });

  it('shows a field-preset contributed type as the fence only, with its arg labels', () => {
    const result = hover('model Counter {\n  value pg.Ser|ial(1)\n}');
    expect(result).toEqual({
      contents: { kind: 'markdown', value: '```prisma\npg.Serial(start: number)\n```' },
      range: { start: { line: 1, character: 11 }, end: { line: 1, character: 17 } },
    });
  });

  it('shows a stringArray contributed-type arg as string[]', () => {
    const result = hover('model Product {\n  labels pg.Tag|s([])\n}');
    expect(result).toEqual({
      contents: {
        kind: 'markdown',
        value: '```prisma\npg.Tags(tags: string[])\n```\n\nA list of tags.',
      },
      range: { start: { line: 1, character: 12 }, end: { line: 1, character: 16 } },
    });
  });

  it('shows an option contributed-type arg as its joined allowed values', () => {
    const result = hover('model Product {\n  onDelete pg.Mo|de(cascade)\n}');
    expect(result).toEqual({
      contents: {
        kind: 'markdown',
        value: "```prisma\npg.Mode(mode: 'cascade' | 'restrict')\n```\n\nA deletion mode.",
      },
      range: { start: { line: 1, character: 14 }, end: { line: 1, character: 18 } },
    });
  });

  it('shows a block keyword with documentation', () => {
    const result = hover('polic|y ReadOwn {\n}');
    expect(result).toEqual({
      contents: { kind: 'markdown', value: 'Row-level access rule.' },
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } },
    });
  });

  it('returns null for a block keyword without documentation', () => {
    const result = hover('vie|w Summary {\n}');
    expect(result).toBeNull();
  });
});
