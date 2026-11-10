import { describe, expect, it } from 'vitest';
import { hover } from './helpers/hover';

describe('providePslHover', () => {
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

  it('shows a named attribute-argument key and its documentation', () => {
    const result = hover('model User {\n  author User @relation(nam|e: "x")\n}');
    expect(result).toEqual({
      contents: {
        kind: 'markdown',
        value: '```prisma\nname?: string\n```\n\nAn explicit relation name.',
      },
      range: { start: { line: 1, character: 24 }, end: { line: 1, character: 28 } },
    });
  });

  it('shows a named attribute-argument key while its value is missing', () => {
    const result = hover('model User {\n  author User @incompleteKey(referen|ces: )\n}');
    expect(result).toEqual({
      contents: {
        kind: 'markdown',
        value: '```prisma\nreferences?: string\n```\n\nReferenced fields.',
      },
      range: { start: { line: 1, character: 29 }, end: { line: 1, character: 39 } },
    });
  });

  it('omits the documentation section for a parameter with empty documentation', () => {
    const result = hover('model User {\n  id Int\n  author User @relatesTo(field|s: id)\n}');
    expect(result).toEqual({
      contents: { kind: 'markdown', value: '```prisma\nfields: field name\n```' },
      range: { start: { line: 2, character: 25 }, end: { line: 2, character: 31 } },
    });
  });

  it('shows a struct-block entry key and its documentation', () => {
    const result = hover('policy ReadOwn {\n  usi|ng = "x"\n}');
    expect(result).toEqual({
      contents: {
        kind: 'markdown',
        value: '```prisma\nusing: string\n```\n\nThe policy filter expression.',
      },
      range: { start: { line: 1, character: 2 }, end: { line: 1, character: 7 } },
    });
  });

  it('shows a function name without args and its documentation', () => {
    const result = hover('model User {\n  id Int @default(autoincreme|nt())\n}');
    expect(result).toEqual({
      contents: {
        kind: 'markdown',
        value: '```prisma\nautoincrement()\n```\n\nGenerates sequential integers.',
      },
      range: { start: { line: 1, character: 18 }, end: { line: 1, character: 31 } },
    });
  });

  it('shows a function name past leading scalar leaves, in the real @default arm order', () => {
    const result = hover('model User {\n  id Int @defaultRealOrder(autoincreme|nt())\n}');
    expect(result).toEqual({
      contents: {
        kind: 'markdown',
        value: '```prisma\nautoincrement()\n```\n\nGenerates sequential integers.',
      },
      range: { start: { line: 1, character: 27 }, end: { line: 1, character: 40 } },
    });
  });

  it('shows a function name with args and its documentation', () => {
    const result = hover('model User {\n  value String @default(dbgenerat|ed(expr: "now()"))\n}');
    expect(result).toEqual({
      contents: {
        kind: 'markdown',
        value: '```prisma\ndbgenerated(expr: string)\n```\n\nLets the database generate the value.',
      },
      range: { start: { line: 1, character: 24 }, end: { line: 1, character: 35 } },
    });
  });

  it('shows a named function-call-argument key and its documentation', () => {
    const result = hover('model User {\n  value String @default(dbgenerated(ex|pr: "now()"))\n}');
    expect(result).toEqual({
      contents: {
        kind: 'markdown',
        value: '```prisma\nexpr: string\n```\n\nThe database expression.',
      },
      range: { start: { line: 1, character: 36 }, end: { line: 1, character: 40 } },
    });
  });

  it('shows a constant not first in a oneOf and its documentation', () => {
    const result = hover('model User {\n  author User @onDeleteExample(onDelete: Casc|ade)\n}');
    expect(result).toEqual({
      contents: { kind: 'markdown', value: '```prisma\nCascade\n```\n\nCascades the delete.' },
      range: { start: { line: 1, character: 41 }, end: { line: 1, character: 48 } },
    });
  });

  it('shows a block attribute and its documentation', () => {
    const result = hover('policy ReadOwn {\n  @@someBlockAttri|bute("x")\n}');
    expect(result).toEqual({
      contents: {
        kind: 'markdown',
        value: '```prisma\n@@someBlockAttribute(string)\n```\n\nDoes something.',
      },
      range: { start: { line: 1, character: 4 }, end: { line: 1, character: 22 } },
    });
  });
});
