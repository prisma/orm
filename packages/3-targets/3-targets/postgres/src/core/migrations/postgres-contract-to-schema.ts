import type { ColumnDefault, Contract } from '@internal/contract/types';
import { sqlTypeLookupsOf } from '@internal/family-sql/control';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import type { StorageColumn } from '@internal/sql-contract/types';
import { blindCast } from '@internal/utils/casts';
import { postgresResolveDefault } from '../default-normalizer';
import type { PostgresContract } from '../postgres-schema';
import type { PostgresDatabaseSchemaNode } from '../schema-ir/postgres-database-schema-node';
import { contractToPostgresDatabaseSchemaNode } from './contract-to-postgres-database-schema-node';
import { renderDefaultLiteral } from './planner-ddl-builders';

export function postgresRenderDefault(
  def: ColumnDefault,
  column: StorageColumn,
  type: { readonly dataType: string; readonly baseTypeName: string },
): string {
  if (def.kind === 'function') {
    return def.expression;
  }
  return renderDefaultLiteral(def.value, { many: column.many, ...type });
}

/**
 * The Postgres schema tree a contract describes, as the planner's "from" side:
 * the target descriptor's `migrations.contractToSchema` hook and the trees
 * `renameTable` compares to find its companion renames both go through here,
 * so they are built with the same type lookups, default renderer and default resolver.
 */
export function postgresContractToSchema(
  contract: Contract | null,
  frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>,
): PostgresDatabaseSchemaNode {
  const types = sqlTypeLookupsOf(frameworkComponents);
  const postgresContract = blindCast<
    PostgresContract | null,
    'the family resolver only binds this hook for a Postgres-target contract'
  >(contract);
  return contractToPostgresDatabaseSchemaNode(postgresContract, {
    annotationNamespace: 'pg',
    dataTypeLookup: types.dataTypeLookup,
    codecLookup: types.codecLookup,
    renderDefault: postgresRenderDefault,
    resolveDefault: postgresResolveDefault,
  });
}
