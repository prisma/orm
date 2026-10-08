import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import { indexExistsAst } from '../../../contract-free/checks';
import { buildCreateIndexSql, buildDropIndexSql } from '../planner-ddl-builders';
import { buildTargetDetails } from '../planner-target-details';
import { type Op, step } from './shared';

type CheckStep = { sql: string; params?: readonly unknown[] };

async function indexExistsSteps(
  lowerer: ExecuteRequestLowerer,
  indexName: string,
): Promise<{ present: CheckStep; absent: CheckStep }> {
  const checks = indexExistsAst(indexName);
  const present = await lowerer.lowerToExecuteRequest(checks.indexPresent());
  const absent = await lowerer.lowerToExecuteRequest(checks.indexAbsent());
  return { present, absent };
}

export async function createIndex(
  tableName: string,
  indexName: string,
  columns: readonly string[],
  lowerer: ExecuteRequestLowerer,
): Promise<Op> {
  const { present, absent } = await indexExistsSteps(lowerer, indexName);
  return {
    id: `index.${tableName}.${indexName}`,
    label: `Create index ${indexName} on ${tableName}`,
    summary: `Creates index ${indexName} on ${tableName}`,
    operationClass: 'additive',
    target: { id: 'sqlite', details: buildTargetDetails('index', indexName, tableName) },
    precheck: [step(`ensure index "${indexName}" is missing`, absent.sql, absent.params)],
    execute: [
      step(`create index "${indexName}"`, buildCreateIndexSql(tableName, indexName, columns)),
    ],
    postcheck: [step(`verify index "${indexName}" exists`, present.sql, present.params)],
  };
}

export async function dropIndex(
  tableName: string,
  indexName: string,
  lowerer: ExecuteRequestLowerer,
): Promise<Op> {
  const { present, absent } = await indexExistsSteps(lowerer, indexName);
  return {
    id: `dropIndex.${tableName}.${indexName}`,
    label: `Drop index ${indexName} on ${tableName}`,
    summary: `Drops index ${indexName} on ${tableName} which is not in the contract`,
    operationClass: 'widening',
    target: { id: 'sqlite', details: buildTargetDetails('index', indexName, tableName) },
    precheck: [step(`ensure index "${indexName}" exists`, present.sql, present.params)],
    execute: [step(`drop index "${indexName}"`, buildDropIndexSql(indexName))],
    postcheck: [step(`verify index "${indexName}" is gone`, absent.sql, absent.params)],
  };
}
