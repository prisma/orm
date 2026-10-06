/**
 * TS contract source for the `extension-pgvector` package.
 *
 * Authored against the contract-space package layout convention. The
 * same emit pipeline application authors use is applied here:
 *
 *   `prisma contract emit` → `<package>/src/contract.{json,d.ts}`
 *   `prisma migration plan` → `<package>/migrations/<dirName>/`
 *
 * The descriptor at `src/exports/control.ts` then wires the emitted
 * JSON artefacts via JSON-import declarations.
 *
 * ## IR coverage
 *
 * pgvector ships **no tables** of its own. The single object the
 * extension contributes to the contract IR is the parameterised native
 * type `vector(N)`, registered under `storage.types`. Per-column
 * instances on the user's side carry concrete `typeParams.length`
 * (e.g. `vector(1536)`); the registration here declares the
 * parameterised shape so the verifier sees `vector` as part of
 * pgvector's space contribution and so the pinned `contract.json` on
 * disk is materially distinct from an empty space.
 *
 * Unlike extensions that defer typed objects (composite types /
 * domains / enums) beyond the current IR vocabulary,
 * pgvector's `vector` IS representable in today's IR via
 * {@link StorageTypeInstance}.
 *
 * ## Why TS, not PSL
 *
 * The contract-space package layout convention prefers PSL
 * (`src/contract.prisma`). pgvector is the narrow exception called out
 * in the convention: PSL's `types {}` block instantiates parameterised
 * types at app authoring time (`Vector1536 = pgvector.Vector(1536)`)
 * but has no surface for an extension to register the parameterised
 * BASE type itself (the `storage.types.vector` entry with empty
 * `typeParams` shown below). Until PSL grows that surface, this
 * extension keeps its contract source in TS.
 *
 * @see docs/architecture docs/adrs/ADR 212 - Contract spaces.md
 */

import { assembleDataTypes } from '@internal/framework-components/codec';
import { defineContract } from '@internal/postgres/contract-builder';
import { assemblePostgresCodecRegistryWithBuiltins } from '@internal/target-postgres/codecs';
import { postgresDataTypes } from '@internal/target-postgres/data-types';
import { VECTOR_CODEC_ID } from './core/constants';
import { PGVECTOR_NATIVE_TYPE } from './core/contract-space-constants';
import { pgvectorDataTypes } from './core/data-types';
import { pgvectorCodecRegistry } from './core/registry';

const dataTypeLookup = assembleDataTypes([
  { id: 'postgres', dataTypes: postgresDataTypes },
  { id: 'pgvector', dataTypes: pgvectorDataTypes },
]).lookup;
const codecLookup = assemblePostgresCodecRegistryWithBuiltins(
  [{ types: { codecTypes: { codecDescriptors: [...pgvectorCodecRegistry.values()] } } }],
  dataTypeLookup,
);

export const contract = defineContract({ codecLookup, dataTypeLookup }, () => ({
  types: {
    [PGVECTOR_NATIVE_TYPE]: {
      kind: 'codec-instance',
      codecId: VECTOR_CODEC_ID,
      nativeType: PGVECTOR_NATIVE_TYPE,
      typeParams: {},
    },
  },
  models: {},
}));

export default contract;
