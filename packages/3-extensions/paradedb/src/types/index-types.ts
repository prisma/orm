import { defineIndexTypes } from '@internal/sql-contract/index-types';
import { type } from 'arktype';

export const paradedbIndexTypes = defineIndexTypes().add('bm25', {
  options: type({
    '+': 'reject',
    key_field: 'string',
  }),
});

export type IndexTypes = typeof paradedbIndexTypes.IndexTypes;
export type Bm25IndexOptions = IndexTypes['bm25']['options'];
