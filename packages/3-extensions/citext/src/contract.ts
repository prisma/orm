/**
 * citext's contract space ships no tables. It declares the `citext` extension, so `db sign` checks that a database has it and the planner creates it, and registers the `citext` database type under `storage.types`, as pgvector declares `vector` and registers its type.
 *
 * The source is TypeScript because PSL's `types {}` block names an application's own types and has no way for a pack to register a database type under its native name.
 *
 * @see docs/architecture docs/adrs/ADR 212 - Contract spaces.md
 */

import { assembleDataTypes } from '@internal/framework-components/codec';
import { defineContract, extension } from '@internal/postgres/contract-builder';
import { assemblePostgresCodecRegistryWithBuiltins } from '@internal/target-postgres/codecs';
import { postgresDataTypes } from '@internal/target-postgres/data-types';
import { CITEXT_CODEC_ID } from './core/constants';
import { CITEXT_EXTENSION_NAME, CITEXT_NATIVE_TYPE } from './core/contract-space-constants';
import { citextDataTypes } from './core/data-types';
import { citextCodecRegistry } from './core/registry';

const dataTypeLookup = assembleDataTypes([
  { id: 'postgres', dataTypes: postgresDataTypes },
  { id: 'citext', dataTypes: citextDataTypes },
]).lookup;
const codecLookup = assemblePostgresCodecRegistryWithBuiltins(
  [{ types: { codecTypes: { codecDescriptors: [...citextCodecRegistry.values()] } } }],
  dataTypeLookup,
);

export const contract = defineContract({ codecLookup, dataTypeLookup }, () => ({
  databaseTypes: {
    [CITEXT_NATIVE_TYPE]: {
      kind: 'codec-instance',
      codecId: CITEXT_CODEC_ID,
      typeParams: {},
    },
  },
  models: {},
  entities: [extension(CITEXT_EXTENSION_NAME)],
}));

export default contract;
