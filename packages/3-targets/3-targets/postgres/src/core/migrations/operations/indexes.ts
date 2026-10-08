import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { indexExistsAst } from '../../../contract-free/checks';
import {
  alterIndexRename as alterIndexRenameDdl,
  createIndex as createIndexDdl,
  dropIndex as dropIndexDdl,
} from '../../../contract-free/ddl';
import type { CreateIndexElements } from '../../ddl/nodes';
import { type Op, step, targetDetails } from './shared';

type CheckStep = { sql: string; params?: readonly unknown[] };

async function indexExistsSteps(
  lowerer: ExecuteRequestLowerer,
  schemaName: string,
  indexName: string,
): Promise<{ present: CheckStep; absent: CheckStep }> {
  const checks = indexExistsAst(schemaName, indexName);
  const present = await lowerer.lowerToExecuteRequest(checks.indexPresent());
  const absent = await lowerer.lowerToExecuteRequest(checks.indexAbsent());
  return { present, absent };
}

/** An unbound-namespace object renders unqualified: the DDL node takes no schema. */
function ddlSchemaOf(schemaName: string): string | undefined {
  return schemaName === UNBOUND_NAMESPACE_ID ? undefined : schemaName;
}

export interface CreateIndexExtras {
  readonly type?: string;
  readonly options?: Record<string, unknown>;
  /**
   * Partial-index predicate (WHERE body, without the keyword). Inserted
   * verbatim, never quoted or escaped — the same opaque-SQL stance as RLS
   * policy predicates.
   */
  readonly where?: string;
  readonly unique?: boolean;
}

export async function createIndex(
  schemaName: string,
  tableName: string,
  indexName: string,
  elements: CreateIndexElements,
  lowerer: ExecuteRequestLowerer,
  extras?: CreateIndexExtras,
): Promise<Op> {
  const ddlNode = createIndexDdl({
    schema: ddlSchemaOf(schemaName),
    table: tableName,
    name: indexName,
    unique: extras?.unique === true,
    elements,
    type: extras?.type,
    options: extras?.options,
    where: extras?.where,
  });
  const execute = await lowerer.lowerToExecuteRequest(ddlNode);
  const { present, absent } = await indexExistsSteps(lowerer, schemaName, indexName);
  return {
    id: `index.${tableName}.${indexName}`,
    label: `Create index "${indexName}" on "${tableName}"`,
    operationClass: 'additive',
    target: targetDetails('index', indexName, schemaName, tableName),
    precheck: [step(`ensure index "${indexName}" does not exist`, absent.sql, absent.params)],
    execute: [step(`create index "${indexName}"`, execute.sql, execute.params)],
    postcheck: [step(`verify index "${indexName}" exists`, present.sql, present.params)],
  };
}

/**
 * `ALTER INDEX … RENAME TO`. `widening` for the same typology reason as the
 * RLS policy rename: a rename is neither additive creation nor destructive,
 * and the class vocabulary has no neutral middle class — it is NOT that a
 * rename widens anything.
 */
export function renameIndexOperationId(
  schemaName: string,
  tableName: string,
  fromName: string,
): string {
  return `index.${schemaName}.${tableName}.${fromName}.rename`;
}

export async function renameIndex(
  schemaName: string,
  tableName: string,
  fromName: string,
  toName: string,
  lowerer: ExecuteRequestLowerer,
): Promise<Op> {
  const fromChecks = indexExistsAst(schemaName, fromName);
  const toChecks = indexExistsAst(schemaName, toName);
  const fromPresent = await lowerer.lowerToExecuteRequest(fromChecks.indexPresent());
  const toAbsent = await lowerer.lowerToExecuteRequest(toChecks.indexAbsent());
  const toPresent = await lowerer.lowerToExecuteRequest(toChecks.indexPresent());
  const ddlNode = alterIndexRenameDdl({
    schema: ddlSchemaOf(schemaName),
    from: fromName,
    to: toName,
  });
  const execute = await lowerer.lowerToExecuteRequest(ddlNode);
  return {
    id: renameIndexOperationId(schemaName, tableName, fromName),
    label: `Rename index "${fromName}" to "${toName}" on "${tableName}"`,
    operationClass: 'widening',
    target: targetDetails('index', toName, schemaName, tableName),
    precheck: [
      step(`ensure index "${fromName}" exists`, fromPresent.sql, fromPresent.params),
      step(`ensure index "${toName}" does not exist`, toAbsent.sql, toAbsent.params),
    ],
    execute: [step(`rename index "${fromName}" to "${toName}"`, execute.sql, execute.params)],
    postcheck: [step(`verify index "${toName}" exists`, toPresent.sql, toPresent.params)],
  };
}

export async function dropIndex(
  schemaName: string,
  tableName: string,
  indexName: string,
  lowerer: ExecuteRequestLowerer,
): Promise<Op> {
  const ddlNode = dropIndexDdl({ schema: ddlSchemaOf(schemaName), name: indexName });
  const execute = await lowerer.lowerToExecuteRequest(ddlNode);
  const { present, absent } = await indexExistsSteps(lowerer, schemaName, indexName);
  return {
    id: `dropIndex.${tableName}.${indexName}`,
    label: `Drop index "${indexName}"`,
    operationClass: 'widening',
    target: targetDetails('index', indexName, schemaName, tableName),
    precheck: [step(`ensure index "${indexName}" exists`, present.sql, present.params)],
    execute: [step(`drop index "${indexName}"`, execute.sql, execute.params)],
    postcheck: [step(`verify index "${indexName}" does not exist`, absent.sql, absent.params)],
  };
}
