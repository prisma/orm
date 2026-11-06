import { defineIndexTypes } from '@internal/sql-contract/index-types';
import { type } from 'arktype';

const testIndexTypes = defineIndexTypes()
  .add('bm25', { options: type('object') })
  .add('hash', { options: type('object') });

export const testIndexPack = {
  kind: 'extension',
  id: 'test-index-pack',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  indexTypes: testIndexTypes,
} as const;
