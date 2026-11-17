import type { SqlMigrationPlanOperation } from '@internal/family-sql/control';
import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import { expectAbsent, expectPresent } from '@internal/framework-components/control';
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
import { columnTypeStep } from './operations/columns';
import { step } from './operations/shared';
import type { ColumnTypeCheck } from './planner-sql-checks';
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
  /** The column's type as a migration writes it. */
  readonly type: string;
  /** How the postcheck recognises `type`, or `undefined` when the stack's data types do not read it. */
  readonly checkType: ColumnTypeCheck | undefined;
  readonly temporaryDefault: string;
  readonly lowerer: ExecuteRequestLowerer;
}): Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> {
  const { schema, tableName, columnName, type, checkType, temporaryDefault, lowerer } = options;

  // The recipe handles NOT NULL columns that carry no contract default, so the
  // temporary backfill value is the only default. It is a pre-rendered SQL
  // fragment (e.g. `''`, `0`, `'{}'::jsonb`), carried verbatim as a
  // `FunctionColumnDefault` so the adapter emits it as a `DEFAULT (...)` clause.
  const ddlColumn = col(columnName, type, {
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
  const hasType = await columnTypeStep(
    lowerer,
    { schema, table: tableName, column: columnName },
    type,
    checkType,
  );

  return {
    ...buildAddColumnOperationIdentity(schema, tableName, columnName),
    operationClass: 'additive',
    precheck: [
      step(
        `ensure column "${columnName}" is missing`,
        absent.sql,
        absent.params,
        expectAbsent(`column "${columnName}" on "${tableName}"`),
      ),
    ],
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
      step(
        `verify column "${columnName}" exists`,
        present.sql,
        present.params,
        expectPresent(`column "${columnName}" on "${tableName}"`),
      ),
      step(`verify column "${columnName}" is NOT NULL`, notNullable.sql, notNullable.params),
      step(
        `verify column "${columnName}" has no default after temporary default removal`,
        noDefault.sql,
        noDefault.params,
      ),
      hasType,
    ],
  };
}
