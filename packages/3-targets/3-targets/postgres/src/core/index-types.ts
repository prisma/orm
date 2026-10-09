import { accessMethodOf, defineIndexTypes } from '@internal/sql-contract/index-types';
import { type } from 'arktype';
import { FULL_TEXT_INDEX_TYPE, fullTextIndexType } from './full-text-index-definition';

// Postgres's built-in index access methods (`CREATE INDEX ... USING <method>`),
// which accept any options object, and the full-text index.
//
// `fullText` is not an access method: its access method is `gin`, and the
// target turns its options into the expression the `gin` index is built over.
export const postgresIndexTypes = defineIndexTypes()
  .add('btree', { options: type('object') })
  .add('hash', { options: type('object') })
  .add('gin', { options: type('object') })
  .add('gist', { options: type('object') })
  .add('spgist', { options: type('object') })
  .add('brin', { options: type('object') })
  .add(FULL_TEXT_INDEX_TYPE, fullTextIndexType);

export type IndexTypes = typeof postgresIndexTypes.IndexTypes;

/** The access method an index of this type is created with; a type Postgres does not register is its own. */
export function postgresAccessMethodOf(typeLiteral: string): string {
  const entry = postgresIndexTypes.entries.find((candidate) => candidate.type === typeLiteral);
  return entry === undefined ? typeLiteral : accessMethodOf(entry);
}
