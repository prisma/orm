import type { DefaultMappingOptions } from '@internal/family-sql/psl-infer';
import { createDataTypeLookup } from '@internal/framework-components/codec';
import { postgresDataTypeEntries } from '../data-type-entries';
import { postgresDataTypes } from '../data-types';

function formatDbGeneratedAttribute(expression: string): string {
  return `@default(dbgenerated(${JSON.stringify(expression)}))`;
}

export function createPostgresDefaultMapping(): DefaultMappingOptions {
  return {
    fallbackFunctionAttribute: formatDbGeneratedAttribute,
    dataTypeEntries: postgresDataTypeEntries(),
    dataTypes: createDataTypeLookup(postgresDataTypes),
  };
}
