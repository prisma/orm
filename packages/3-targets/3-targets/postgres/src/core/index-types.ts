import { defineIndexTypes } from '@internal/sql-contract/index-types';
import { type } from 'arktype';

// Postgres's built-in index access methods (`CREATE INDEX ... USING <method>`).
// Per-method option validation (e.g. `gin` operator classes) is out of scope;
// every method accepts any options object until a later slice narrows it.
export const postgresIndexTypes = defineIndexTypes()
  .add('btree', { options: type('object') })
  .add('hash', { options: type('object') })
  .add('gin', { options: type('object') })
  .add('gist', { options: type('object') })
  .add('spgist', { options: type('object') })
  .add('brin', { options: type('object') });

export type IndexTypes = typeof postgresIndexTypes.IndexTypes;
