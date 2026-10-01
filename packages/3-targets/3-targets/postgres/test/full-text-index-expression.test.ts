import { describe, expect, it } from 'vitest';
import {
  type FullTextIndexDefinition,
  fullTextIndexDefinitionOf,
  renderFullTextDocument,
  renderFullTextIndexExpression,
} from '../src/core/full-text-index-expression';

function render(definition: FullTextIndexDefinition): string {
  return renderFullTextIndexExpression(definition);
}

describe('renderFullTextIndexExpression', () => {
  it('renders one field alone as the bare to_tsvector the column operations use', () => {
    expect(render({ fields: [['title']], language: 'english' })).toBe(
      `to_tsvector('english', "title")`,
    );
  });

  it('coalesces every column of a document of several columns, and weighs none in one group', () => {
    expect(render({ fields: [['title', 'body']], language: 'english' })).toBe(
      `(to_tsvector('english', coalesce("title", '')) || to_tsvector('english', coalesce("body", '')))`,
    );
  });

  it('weights each group, A first, when there is more than one group', () => {
    expect(render({ fields: [['title', 'subtitle'], ['body']], language: 'english' })).toBe(
      `(setweight(to_tsvector('english', coalesce("title", '')), 'A') || setweight(to_tsvector('english', coalesce("subtitle", '')), 'A') || setweight(to_tsvector('english', coalesce("body", '')), 'B'))`,
    );
  });

  it('uses the weights A to D for four groups', () => {
    expect(render({ fields: [['a'], ['b'], ['c'], ['d']], language: 'simple' })).toBe(
      `(setweight(to_tsvector('simple', coalesce("a", '')), 'A') || setweight(to_tsvector('simple', coalesce("b", '')), 'B') || setweight(to_tsvector('simple', coalesce("c", '')), 'C') || setweight(to_tsvector('simple', coalesce("d", '')), 'D'))`,
    );
  });

  it('quotes column names that need it', () => {
    expect(render({ fields: [['Body Text']], language: 'english' })).toBe(
      `to_tsvector('english', "Body Text")`,
    );
  });
});

describe('fullTextIndexDefinitionOf', () => {
  const fullTextIndex = (overrides: Record<string, unknown> = {}) => ({
    name: 'post_search',
    type: 'fullText',
    columns: ['title', 'body'],
    options: { fields: [['title'], ['body']], language: 'german' },
    ...overrides,
  });

  it('reads the definition of an index of type fullText', () => {
    expect(fullTextIndexDefinitionOf(fullTextIndex())).toEqual({
      fields: [['title'], ['body']],
      language: 'german',
    });
  });

  it.each([
    ['an index without a type', {}],
    ['a gin index, whatever its options', { type: 'gin', options: { fields: [['title']] } }],
    ['a btree index', { type: 'btree', columns: ['title'] }],
  ])('reads nothing from %s', (_label, index) => {
    expect(fullTextIndexDefinitionOf(index)).toBeUndefined();
  });

  it.each([
    ['an empty weight group', { options: { fields: [['title'], []], language: 'english' } }],
    ['a missing language', { options: { fields: [['title'], ['body']] } }],
    [
      'an option other than fields and language',
      { options: { fields: [['title'], ['body']], language: 'english', fastupdate: 'off' } },
    ],
  ])('refuses %s', (_label, overrides) => {
    expect(() => fullTextIndexDefinitionOf(fullTextIndex(overrides))).toThrow(
      expect.objectContaining({ code: 'CONTRACT.INDEX_INVALID' }),
    );
  });

  it('refuses a unique full-text index, which Postgres cannot build as gin', () => {
    expect(() => fullTextIndexDefinitionOf(fullTextIndex({ unique: true }))).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.INDEX_INVALID',
        message: expect.stringContaining('unique'),
      }),
    );
  });

  it.each([
    ['different columns', ['title', 'summary']],
    ['the same columns in another order', ['body', 'title']],
    ['fewer columns', ['title']],
  ])('refuses columns that are not the fields of its weight groups: %s', (_label, columns) => {
    expect(() => fullTextIndexDefinitionOf(fullTextIndex({ columns }))).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.INDEX_INVALID',
        message: expect.stringContaining('"post_search"'),
        why: expect.stringContaining('columns'),
        fix: expect.stringContaining('Re-emit'),
      }),
    );
  });
});

describe('renderFullTextDocument', () => {
  it('renders any field reference and language syntax it is given', () => {
    expect(
      renderFullTextDocument([[0, 1], [2]], {
        column: (position) => `{{arg${position}}}`,
        language: '{{arg9}}',
      }),
    ).toBe(
      `(setweight(to_tsvector({{arg9}}, coalesce({{arg0}}, '')), 'A') || setweight(to_tsvector({{arg9}}, coalesce({{arg1}}, '')), 'A') || setweight(to_tsvector({{arg9}}, coalesce({{arg2}}, '')), 'B'))`,
    );
  });

  it('refuses more than four groups', () => {
    expect(() =>
      renderFullTextDocument([['a'], ['b'], ['c'], ['d'], ['e']], {
        column: (name) => name,
        language: `'english'`,
      }),
    ).toThrow(/at most 4/);
  });

  it('refuses an empty group', () => {
    expect(() =>
      renderFullTextDocument([['a'], []], { column: (name) => name, language: `'english'` }),
    ).toThrow(/empty/);
  });
});
