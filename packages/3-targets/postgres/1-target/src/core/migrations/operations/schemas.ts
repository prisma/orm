import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import {
  schemaExistsAst,
  schemaHoldsNoObjectsAst,
  tableExistsAst,
  unboundTableMovedAst,
} from '../../../contract-free/checks';
import * as contractFreeDdl from '../../../contract-free/ddl';
import { boundSchema } from '../bound-schema';
import { schemaContentsMeta } from '../schema-contents';
import { type Op, step, targetDetails } from './shared';

export async function setTableSchema(
  schemaName: string,
  tableName: string,
  toSchemaName: string,
  lowerer: ExecuteRequestLowerer,
): Promise<Op> {
  const from = tableExistsAst(schemaName, tableName);
  const to = tableExistsAst(toSchemaName, tableName);
  const fromPresent = await lowerer.lowerToExecuteRequest(from.tablePresent());
  const toSchemaPresent = await lowerer.lowerToExecuteRequest(
    schemaExistsAst(toSchemaName).schemaPresent(),
  );
  const toAbsent = await lowerer.lowerToExecuteRequest(to.tableAbsent());
  const statement = await lowerer.lowerToExecuteRequest(
    contractFreeDdl.alterTableSetSchema({
      schema: boundSchema(schemaName),
      table: tableName,
      to: toSchemaName,
    }),
  );
  const toPresent = await lowerer.lowerToExecuteRequest(to.tablePresent());
  const fromAbsent = await lowerer.lowerToExecuteRequest(
    schemaName === UNBOUND_NAMESPACE_ID
      ? unboundTableMovedAst(tableName, toSchemaName)
      : from.tableAbsent(),
  );
  return {
    id: `setTableSchema.${tableName}`,
    label: `Move table "${tableName}" to schema "${toSchemaName}"`,
    operationClass: 'widening',
    target: targetDetails('table', tableName, toSchemaName),
    precheck: [
      step(`ensure table "${tableName}" exists`, fromPresent.sql, fromPresent.params),
      step(`ensure schema "${toSchemaName}" exists`, toSchemaPresent.sql, toSchemaPresent.params),
      step(
        `ensure schema "${toSchemaName}" has no table "${tableName}"`,
        toAbsent.sql,
        toAbsent.params,
      ),
    ],
    execute: [
      step(
        `move table "${tableName}" to schema "${toSchemaName}"`,
        statement.sql,
        statement.params,
      ),
    ],
    postcheck: [
      step(
        `verify table "${tableName}" exists in schema "${toSchemaName}"`,
        toPresent.sql,
        toPresent.params,
      ),
      step(
        `verify table "${tableName}" no longer exists where it was`,
        fromAbsent.sql,
        fromAbsent.params,
      ),
    ],
  };
}

export async function renameSchema(
  schemaName: string,
  toSchemaName: string,
  lowerer: ExecuteRequestLowerer,
): Promise<Op> {
  const from = schemaExistsAst(schemaName);
  const to = schemaExistsAst(toSchemaName);
  const fromPresent = await lowerer.lowerToExecuteRequest(from.schemaPresent());
  const toAbsent = await lowerer.lowerToExecuteRequest(to.schemaAbsent());
  const statement = await lowerer.lowerToExecuteRequest(
    contractFreeDdl.alterSchemaRename({ schema: schemaName, to: toSchemaName }),
  );
  const toPresent = await lowerer.lowerToExecuteRequest(to.schemaPresent());
  const fromAbsent = await lowerer.lowerToExecuteRequest(from.schemaAbsent());
  return {
    id: `renameSchema.${schemaName}`,
    label: `Rename schema "${schemaName}" to "${toSchemaName}"`,
    operationClass: 'widening',
    target: { id: 'postgres' },
    precheck: [
      step(`ensure schema "${schemaName}" exists`, fromPresent.sql, fromPresent.params),
      step(`ensure schema "${toSchemaName}" does not exist`, toAbsent.sql, toAbsent.params),
    ],
    execute: [
      step(`rename schema "${schemaName}" to "${toSchemaName}"`, statement.sql, statement.params),
    ],
    postcheck: [
      step(`verify schema "${toSchemaName}" exists`, toPresent.sql, toPresent.params),
      step(`verify schema "${schemaName}" no longer exists`, fromAbsent.sql, fromAbsent.params),
    ],
  };
}

export async function dropSchema(schemaName: string, lowerer: ExecuteRequestLowerer): Promise<Op> {
  const empty = await lowerer.lowerToExecuteRequest(schemaHoldsNoObjectsAst(schemaName));
  const statement = await lowerer.lowerToExecuteRequest(
    contractFreeDdl.dropSchema({ schema: schemaName }),
  );
  const absent = await lowerer.lowerToExecuteRequest(schemaExistsAst(schemaName).schemaAbsent());
  return {
    id: `dropSchema.${schemaName}`,
    label: `Drop schema "${schemaName}"`,
    operationClass: 'widening',
    target: { id: 'postgres' },
    precheck: [
      {
        ...step(
          `ensure schema "${schemaName}" holds no tables, views, sequences, types or functions`,
          empty.sql,
          empty.params,
        ),
        meta: schemaContentsMeta(schemaName),
      },
    ],
    execute: [step(`drop schema "${schemaName}"`, statement.sql, statement.params)],
    postcheck: [step(`verify schema "${schemaName}" does not exist`, absent.sql, absent.params)],
  };
}
