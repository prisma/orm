import type { DataTypeLookup } from '@internal/framework-components/codec';
import {
  createPostgresBuiltinCodecLookup,
  type PostgresCodecRegistry,
} from '@internal/target-postgres/codecs';
import {
  createPostgresBuiltinDataTypeLookup,
  postgresDataTypes,
} from '@internal/target-postgres/data-types';
import { PostgresControlAdapter } from '../../src/core/control-adapter';

/** A control adapter that resolves introspected column types over the Postgres target's data types. */
export function createTestPostgresControlAdapter(
  codecRegistry: PostgresCodecRegistry = createPostgresBuiltinCodecLookup(),
  dataTypeLookup: DataTypeLookup = createPostgresBuiltinDataTypeLookup(),
): PostgresControlAdapter {
  return new PostgresControlAdapter(codecRegistry, dataTypeLookup, postgresDataTypes);
}
