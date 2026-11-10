import { describe, expect, it } from 'vitest';
import type { FullTextIndexDefinition } from '../src/core/full-text-index-definition';
import {
  renderFullTextDocument,
  renderFullTextIndexDocument,
} from '../src/core/full-text-search-document';

function render(definition: FullTextIndexDefinition): string {
  return renderFullTextIndexDocument(definition);
}

describe('renderFullTextIndexDocument', () => {
  it('renders one field alone as the bare to_tsvector the column operations use', () => {
    expect(render({ weightGroups: [['title']], language: 'english' })).toBe(
      `to_tsvector('english', "title")`,
    );
  });

  it('coalesces every column of a document of several columns, and weighs none in one group', () => {
    expect(render({ weightGroups: [['title', 'body']], language: 'english' })).toBe(
      `(to_tsvector('english', coalesce("title", '')) || to_tsvector('english', coalesce("body", '')))`,
    );
  });

  it('weights each group, A first, when there is more than one group', () => {
    expect(render({ weightGroups: [['title', 'subtitle'], ['body']], language: 'english' })).toBe(
      `(setweight(to_tsvector('english', coalesce("title", '')), 'A') || setweight(to_tsvector('english', coalesce("subtitle", '')), 'A') || setweight(to_tsvector('english', coalesce("body", '')), 'B'))`,
    );
  });

  it('uses the weights A to D for four groups', () => {
    expect(render({ weightGroups: [['a'], ['b'], ['c'], ['d']], language: 'simple' })).toBe(
      `(setweight(to_tsvector('simple', coalesce("a", '')), 'A') || setweight(to_tsvector('simple', coalesce("b", '')), 'B') || setweight(to_tsvector('simple', coalesce("c", '')), 'C') || setweight(to_tsvector('simple', coalesce("d", '')), 'D'))`,
    );
  });

  it('quotes column names that need it', () => {
    expect(render({ weightGroups: [['Body Text']], language: 'english' })).toBe(
      `to_tsvector('english', "Body Text")`,
    );
  });

  it.each([
    ['an empty weight group', [['a'], [], ['b']], 'has an empty weight group at position 2'],
    ['a field named twice', [['a'], ['b', 'a']], 'names the field "a" more than once'],
  ])('refuses a definition with %s', (_label, weightGroups, problem) => {
    expect(() => render({ weightGroups, language: 'english' })).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.INDEX_INVALID',
        message: expect.stringContaining(problem),
        meta: { weightGroups },
      }),
    );
  });
});

describe('renderFullTextDocument', () => {
  it('renders any column reference and language it is given', () => {
    expect(
      renderFullTextDocument([[0, 1], [2]], {
        column: (position) => `{{arg${position}}}`,
        language: '{{arg9}}',
      }),
    ).toBe(
      `(setweight(to_tsvector({{arg9}}, coalesce({{arg0}}, '')), 'A') || setweight(to_tsvector({{arg9}}, coalesce({{arg1}}, '')), 'A') || setweight(to_tsvector({{arg9}}, coalesce({{arg2}}, '')), 'B'))`,
    );
  });

  it('has no weight for a fifth group', () => {
    expect(() =>
      renderFullTextDocument([['a'], ['b'], ['c'], ['d'], ['e']], {
        column: (name) => name,
        language: `'english'`,
      }),
    ).toThrow(/no weight for group 5/);
  });
});
