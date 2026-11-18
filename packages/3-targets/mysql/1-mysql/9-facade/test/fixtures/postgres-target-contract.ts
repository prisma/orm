import { createDataTypeLookup, emptyCodecLookup } from '@internal/framework-components/codec';
import { buildSqlContractFromDefinition } from '@internal/sql-contract-ts/contract-builder';
import mysqlPack from '@internal/target-mysql/pack';
import { mysqlCreateNamespace } from '@internal/target-mysql/types';

/** An empty contract the SQL family's builder builds for target `postgres`, as that target's `defineContract` would. */
export const contract = buildSqlContractFromDefinition(
  {
    warnings: undefined,
    target: { ...mysqlPack, id: 'postgres', targetId: 'postgres' },
    createNamespace: mysqlCreateNamespace,
    models: [],
  },
  { ...emptyCodecLookup, descriptorFor: () => undefined },
  createDataTypeLookup([]),
);
