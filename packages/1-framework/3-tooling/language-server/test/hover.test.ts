import { assembleAuthoringContributions } from '@internal/framework-components/control';
import {
  buildSymbolTable,
  entityRef,
  fieldAttribute,
  fieldRef,
  modelAttribute,
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
const authoringContributions = assembleAuthoringContributions([
  {
    id: 'hover-fixture',
    authoring: {
      attributeSpecs: {
        field: { relatesTo: () => relatesTo },
        model: { guardedBy: () => guardedBy },
      },
    },
  },
]);

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
    binder: testBinder({ sources, symbolTable, authoringContributions }),
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

  it('returns null for an unresolved name', () => {
    const result = hover('model Post {\n  author Unkno|wn\n}');
    expect(result).toBeNull();
  });

  it('returns null when the cursor is not on an Ident token', () => {
    const result = hover('model User {| id Int\n}');
    expect(result).toBeNull();
  });
});
