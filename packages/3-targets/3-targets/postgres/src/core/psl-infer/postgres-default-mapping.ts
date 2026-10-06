import type { DefaultMappingOptions } from '@internal/family-sql/psl-build';
import { postgresDataTypeEntries } from '../data-type-entries';
import { createPostgresBuiltinDataTypeLookup } from '../data-types';

export function createPostgresDefaultMapping(): DefaultMappingOptions {
  return {
    dataTypeEntries: postgresDataTypeEntries(),
    dataTypeLookup: createPostgresBuiltinDataTypeLookup(),
  };
}
