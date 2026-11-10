import type { Contract, ControlPolicy } from '@internal/contract/types';
import type { SqlSchemaDiffResult } from '@internal/family-sql/control';
import { contractToSchemaIR, sqlTypeLookupsOf } from '@internal/family-sql/control';
import type { TypeLookups } from '@internal/framework-components/codec';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import type { SchemaDiffIssue } from '@internal/framework-components/control';
import { diffSchemas } from '@internal/framework-components/control';
import { entityAt } from '@internal/framework-components/ir';
import type { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { SqlSchemaIR, type SqlSchemaIRNode } from '@internal/sql-schema-ir/types';
import { mysqlResolveDefault } from '../default-normalizer';
import { mysqlError } from '../errors';

/**
 * The schema IR a contract describes on MySQL: one flat tree of tables, each column typed by the data type its codec represents. A MySQL database holds no schemas, so foreign keys name no referenced schema, as introspection reports them.
 */
export function mysqlContractToSchema(
  contract: Contract<SqlStorage> | null,
  types: TypeLookups,
): SqlSchemaIR {
  return contractToSchemaIR(contract, {
    annotationNamespace: 'mysql',
    resolveDefault: mysqlResolveDefault,
    dataTypeLookup: types.dataTypeLookup,
    codecLookup: types.codecLookup,
  });
}

/** The control policy of the table an issue is about. The tree is flat, so the table's name is the second segment of the issue's path. */
function resolveControlPolicy(
  issue: SchemaDiffIssue,
  contract: Contract<SqlStorage>,
): ControlPolicy | undefined {
  const tableName = issue.path[1];
  if (tableName === undefined) return undefined;
  for (const namespaceId of Object.keys(contract.storage.namespaces)) {
    const table = entityAt<StorageTable>(contract.storage, {
      namespaceId,
      entityKind: 'table',
      entityName: tableName,
    });
    if (table !== undefined) return table.control;
  }
  return undefined;
}

/** The full-tree diff `db verify` derives its verdict from: the contract's tree against the one introspection built. */
export function diffMysqlSchema(input: {
  readonly contract: Contract<SqlStorage>;
  readonly schema: SqlSchemaIRNode;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
}): SqlSchemaDiffResult {
  if (!(input.schema instanceof SqlSchemaIR)) {
    throw mysqlError(
      'CONTRACT.TARGET_MISMATCH',
      'The MySQL schema diff received a schema tree that MySQL introspection did not build.',
    );
  }
  const expected = mysqlContractToSchema(
    input.contract,
    sqlTypeLookupsOf(input.frameworkComponents),
  );
  const actual = input.schema;
  const namespacesWithTables = Object.values(input.contract.storage.namespaces).filter(
    (ns) => Object.keys(ns.entries.table ?? {}).length > 0,
  );
  return {
    issues: diffSchemas(expected, actual),
    resolveControlPolicy: (issue) => resolveControlPolicy(issue, input.contract),
    namespacePairs: namespacesWithTables.map(() => ({ actual })),
  };
}
