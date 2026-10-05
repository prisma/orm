import type { SqlMigrationPlanOperation } from '@internal/family-sql/control';
import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import type { SqlTypeLookups } from '@internal/sql-contract/data-type';
import type { StorageColumn, StorageTypeInstance } from '@internal/sql-contract/types';
import { FunctionColumnDefault, opaqueSql } from '@internal/sql-relational-core/ast';
import { col } from '@internal/sql-relational-core/contract-free';
import { ifDefined } from '@internal/utils/defined';
import {
  columnDefaultAst,
  columnExistsAst,
  columnNullabilityAst,
} from '../../contract-free/checks';
import * as contractFreeDdl from '../../contract-free/ddl';
import { boundSchema } from './bound-schema';
import { step } from './operations/shared';
import { buildColumnTypeSql } from './planner-ddl-builders';
import { buildTargetDetails, type PostgresPlanTargetDetails } from './planner-target-details';

export function buildAddColumnOperationIdentity(
  schema: string,
  tableName: string,
  columnName: string,
): Pick<
  SqlMigrationPlanOperation<PostgresPlanTargetDetails>,
  'id' | 'label' | 'summary' | 'target'
> {
  return {
    id: `column.${tableName}.${columnName}`,
    label: `Add column ${columnName} to ${tableName}`,
    summary: `Adds column ${columnName} to table ${tableName}`,
    target: {
      id: 'postgres',
      details: buildTargetDetails('table', tableName, schema),
    },
  };
}

export async function buildAddNotNullColumnWithTemporaryDefaultOperation(options: {
  readonly schema: string;
  readonly tableName: string;
  readonly columnName: string;
  readonly column: StorageColumn;
  readonly types: SqlTypeLookups;
  readonly storageTypes: Record<string, StorageTypeInstance>;
  readonly temporaryDefault: string;
  readonly lowerer: ExecuteRequestLowerer;
}): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
  const { schema, tableName, columnName, column, types, storageTypes, temporaryDefault, lowerer } =
    options;

  // The recipe handles NOT NULL columns that carry no contract default, so the
  // temporary backfill value is the only default. It is a pre-rendered SQL
  // fragment (e.g. `''`, `0`, `'{}'::jsonb`), carried verbatim as a
  // `FunctionColumnDefault` so the adapter emits it as a `DEFAULT (...)` clause.
  const ddlColumn = col(columnName, buildColumnTypeSql(column, types, storageTypes), {
    notNull: true,
    default: new FunctionColumnDefault(opaqueSql(temporaryDefault)),
  });
  const addColumn = await lowerer.lowerToExecuteRequest(
    contractFreeDdl.alterTable({
      ...ifDefined('schema', boundSchema(schema)),
      table: tableName,
      actions: [contractFreeDdl.addColumnAction(ddlColumn)],
    }),
  );
  const dropTempDefault = await lowerer.lowerToExecuteRequest(
    contractFreeDdl.alterTable({
      ...ifDefined('schema', boundSchema(schema)),
      table: tableName,
      actions: [contractFreeDdl.dropDefaultAction(columnName)],
    }),
  );

  const absent = await lowerer.lowerToExecuteRequest(
    columnExistsAst({ schema, table: tableName, column: columnName }).columnAbsent(),
  );
  const present = await lowerer.lowerToExecuteRequest(
    columnExistsAst({ schema, table: tableName, column: columnName }).columnPresent(),
  );
  const notNullable = await lowerer.lowerToExecuteRequest(
    columnNullabilityAst({ schema, table: tableName, column: columnName, nullable: false }),
  );
  const noDefault = await lowerer.lowerToExecuteRequest(
    columnDefaultAst({ schema, table: tableName, column: columnName }).noDefault(),
  );

  return {
    ...buildAddColumnOperationIdentity(schema, tableName, columnName),
    operationClass: 'additive',
    precheck: [step(`ensure column "${columnName}" is missing`, absent.sql, absent.params)],
    execute: [
      {
        description: `add column "${columnName}"`,
        sql: addColumn.sql,
      },
      {
        description: `drop temporary default from column "${columnName}"`,
        sql: dropTempDefault.sql,
      },
    ],
    postcheck: [
      step(`verify column "${columnName}" exists`, present.sql, present.params),
      step(`verify column "${columnName}" is NOT NULL`, notNullable.sql, notNullable.params),
      step(
        `verify column "${columnName}" has no default after temporary default removal`,
        noDefault.sql,
        noDefault.params,
      ),
    ],
  };
}
