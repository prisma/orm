import { describe, expect, it } from 'vitest';
import { hover } from './helpers/hover';

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

  it('shows a namespace declaration line at a namespace resolution', () => {
    const result = hover(
      'namespace billing {\n  model Invoice {\n    id Int\n  }\n}\nmodel Foo {\n  bad billi|ng\n}',
    );
    expect(result).toEqual({
      contents: { kind: 'markdown', value: '```prisma\nnamespace billing\n```' },
      range: { start: { line: 6, character: 6 }, end: { line: 6, character: 13 } },
    });
  });

  it('shows the namespace at a namespace block name', () => {
    const result = hover('namespace bil|ling {\n  model Invoice {\n    id Int\n  }\n}');
    expect(result).toEqual({
      contents: { kind: 'markdown', value: '```prisma\nnamespace billing\n```' },
      range: { start: { line: 0, character: 10 }, end: { line: 0, character: 17 } },
    });
  });

  it('shows the namespace at the qualifier of a type reference', () => {
    const result = hover('model Post {\n  author au|th.User\n}', [
      'namespace auth {\n  /// A user.\n  model User {\n    id Int\n  }\n}',
    ]);
    expect(result).toEqual({
      contents: { kind: 'markdown', value: '```prisma\nnamespace auth\n```' },
      range: { start: { line: 1, character: 9 }, end: { line: 1, character: 13 } },
    });
  });

  it('shows the namespace at the qualifier of an entity reference', () => {
    const result = hover(
      'namespace auth {\n  policy ReadOwn {\n  }\n}\nmodel Invoice {\n  id Int\n  @@guardedBy(policy: au|th.ReadOwn)\n}',
    );
    expect(result).toEqual({
      contents: { kind: 'markdown', value: '```prisma\nnamespace auth\n```' },
      range: { start: { line: 6, character: 22 }, end: { line: 6, character: 26 } },
    });
  });

  it('shows the member at the member of a qualified entity reference', () => {
    const result = hover(
      'namespace auth {\n  /// Owner-only access.\n  policy ReadOwn {\n  }\n}\nmodel Invoice {\n  id Int\n  @@guardedBy(policy: auth.Read|Own)\n}',
    );
    expect(result).toEqual({
      contents: {
        kind: 'markdown',
        value: '```prisma\npolicy ReadOwn\n```\n\nOwner-only access.',
      },
      range: { start: { line: 7, character: 27 }, end: { line: 7, character: 34 } },
    });
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
});
