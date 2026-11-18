import { createDataTypeLookup, emptyCodecLookup } from '@internal/framework-components/codec';
import { buildSqlContractFromDefinition } from '@internal/sql-contract-ts/contract-builder';
import postgresPack from '@internal/target-postgres/pack';
import { postgresCreateNamespace } from '@internal/target-postgres/types';

/** An empty contract the SQL family's builder builds for target `mysql`, as that target's `defineContract` would. */
export const contract = buildSqlContractFromDefinition(
  {
    warnings: undefined,
    target: { ...postgresPack, id: 'mysql', targetId: 'mysql' },
    createNamespace: postgresCreateNamespace,
    models: [],
  },
  { ...emptyCodecLookup, descriptorFor: () => undefined },
  createDataTypeLookup([]),
);
