import { defineIndexTypes } from '@internal/sql-contract/index-types';
import { type } from 'arktype';
import { POSTGRES_TEXT_SEARCH_LANGUAGES } from './text-search-languages';

/** The weights Postgres's `setweight` takes, strongest first. Each weight group takes the next one. */
export const FULL_TEXT_WEIGHTS = ['A', 'B', 'C', 'D'] as const;

const fullTextFields = type('string > 0')
  .array()
  .atLeastLength(1)
  .array()
  .atLeastLength(1)
  .atMostLength(FULL_TEXT_WEIGHTS.length)
  .narrow((groups, ctx) => {
    const fields = groups.flat();
    return (
      new Set(fields).size === fields.length || ctx.mustBe('weight groups naming each field once')
    );
  });

const fullTextLanguage = type.enumerated(...POSTGRES_TEXT_SEARCH_LANGUAGES);

/** The options of a full-text index: its weight groups, as storage column names, and its language. */
export const fullTextIndexOptions = type({
  '+': 'reject',
  fields: fullTextFields,
  language: fullTextLanguage,
});

// Postgres's built-in index access methods (`CREATE INDEX ... USING <method>`),
// which accept any options object, and the full-text index. btree and hash
// serve the equality lookups a foreign key needs; the others do not.
//
// `fullText` is not an access method: its options are the index's definition
// (weight groups and language), not storage parameters, and the target turns
// them into a `gin` index over the rendered search document.
export const postgresIndexTypes = defineIndexTypes()
  .add('btree', { options: type('object'), backsForeignKey: true })
  .add('hash', { options: type('object'), backsForeignKey: true })
  .add('gin', { options: type('object'), backsForeignKey: false })
  .add('gist', { options: type('object'), backsForeignKey: false })
  .add('spgist', { options: type('object'), backsForeignKey: false })
  .add('brin', { options: type('object'), backsForeignKey: false })
  .add('fullText', {
    options: fullTextIndexOptions,
    backsForeignKey: false,
    columnTraits: ['textual'],
  });

export type IndexTypes = typeof postgresIndexTypes.IndexTypes;
