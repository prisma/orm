import { createDataTypeLookup } from '@internal/framework-components/codec';
import { createPostgresBuiltinCodecLookup } from '@internal/target-postgres/codecs';
import { postgresDataTypes } from '@internal/target-postgres/data-types';

/** The Postgres target's codecs and data types, for tests that build a contract from its packs. */
export const postgresTypeLookups = {
  codecLookup: createPostgresBuiltinCodecLookup(),
  dataTypeLookup: createDataTypeLookup(postgresDataTypes),
};
