import type { DefaultMappingOptions } from '@internal/family-sql/psl-build';
import { createPostgresBuiltinCodecLookup } from '../codec-registry';
import { postgresDataTypeEntries } from '../data-type-entries';
import { createPostgresBuiltinDataTypeLookup } from '../data-types';

export function createPostgresDefaultMapping(): DefaultMappingOptions {
  const codecLookup = createPostgresBuiltinCodecLookup();
  return {
    dataTypes: {
      entries: postgresDataTypeEntries(),
      lookup: createPostgresBuiltinDataTypeLookup(),
      dataTypeOfCodec: (codecId) => codecLookup.descriptorFor(codecId)?.dataType,
    },
  };
}
