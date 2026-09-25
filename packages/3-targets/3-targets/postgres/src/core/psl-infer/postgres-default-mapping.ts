import type { DefaultMappingOptions } from '@internal/family-sql/psl-ast';
import { createDataTypeLookup } from '@internal/framework-components/codec';
import { postgresDataTypeEntries } from '../data-type-entries';
import { postgresDataTypes } from '../data-types';

export function createPostgresDefaultMapping(): DefaultMappingOptions {
  return {
    dataTypeEntries: postgresDataTypeEntries(),
    dataTypes: createDataTypeLookup(postgresDataTypes),
  };
}
