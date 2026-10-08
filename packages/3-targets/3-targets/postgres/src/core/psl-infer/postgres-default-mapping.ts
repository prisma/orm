import type { DefaultMappingOptions } from '@internal/family-sql/psl-build';
import { postgresDataTypeEntries } from '../data-type-entries';
import { createPostgresBuiltinDataTypeLookup } from '../data-types';

export function createPostgresDefaultMapping(): DefaultMappingOptions {
  return {
    dataTypes: {
      entries: postgresDataTypeEntries(),
      lookup: createPostgresBuiltinDataTypeLookup(),
    },
  };
}
