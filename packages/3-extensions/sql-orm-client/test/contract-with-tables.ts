import type { Contract } from '@internal/contract/types';
import sqlFamilyPack from '@internal/family-sql/pack';
import { assembleDataTypes } from '@internal/framework-components/codec';
import type { SqlStorage } from '@internal/sql-contract/types';
import {
  buildContractDefinition,
  buildSqlContractFromDefinition,
  type ModelLike,
  type TableNode,
} from '@internal/sql-contract-ts/contract-builder';
import { assemblePostgresCodecRegistryWithBuiltins } from '@internal/target-postgres/codecs';
import postgresPack from '@internal/target-postgres/pack';
import { postgresCreateNamespace } from '@internal/target-postgres/types';

/**
 * A Postgres contract of `models` whose storage also holds `tables`: columns added to a model's table, or tables no model maps. The storage no model maps comes from table nodes in the contract definition.
 */
export function defineContractWithTables(
  models: Record<string, ModelLike>,
  tables: readonly TableNode[],
): Contract<SqlStorage> {
  const dataTypeLookup = assembleDataTypes([postgresPack]).lookup;
  const codecLookup = assemblePostgresCodecRegistryWithBuiltins([], dataTypeLookup);
  const definition = buildContractDefinition({
    family: sqlFamilyPack,
    target: postgresPack,
    createNamespace: postgresCreateNamespace,
    models,
  });
  return buildSqlContractFromDefinition({ ...definition, tables }, codecLookup, dataTypeLookup);
}
