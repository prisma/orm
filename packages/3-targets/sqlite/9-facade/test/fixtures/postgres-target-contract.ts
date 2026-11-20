import { createDataTypeLookup, emptyCodecLookup } from '@internal/framework-components/codec';
import { buildSqlContractFromDefinition } from '@internal/sql-contract-ts/contract-builder';
import sqlitePack from '@internal/target-sqlite/pack';
import { sqliteCreateNamespace } from '@internal/target-sqlite/types';

/** An empty contract the SQL family's builder builds for target `postgres`, as that target's `defineContract` would. */
export const contract = buildSqlContractFromDefinition(
  {
    warnings: undefined,
    target: { ...sqlitePack, id: 'postgres', targetId: 'postgres' },
    createNamespace: sqliteCreateNamespace,
    models: [],
  },
  { ...emptyCodecLookup, descriptorFor: () => undefined },
  createDataTypeLookup([]),
);
