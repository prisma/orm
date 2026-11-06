import type {
  SqlMigrationPlanOperation,
  SqlMigrationPlanOperationStep,
} from '@internal/family-sql/control';
import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import {
  type CheckExpectation,
  expectAbsent,
  expectPresent,
} from '@internal/framework-components/control';
import { REFERENTIAL_ACTION_SQL } from '@internal/sql-contract/referential-action-sql';
import type { ReferentialAction } from '@internal/sql-contract/types';
import type { DdlColumn } from '@internal/sql-relational-core/ast';
import { ifDefined } from '@internal/utils/defined';
import { quoteIdentifier } from '../sql-utils';
import type { MysqlPlanTargetDetails } from './planner-target-details';

export type Op = SqlMigrationPlanOperation<MysqlPlanTargetDetails>;

export function step(
  description: string,
  sql: string,
  params?: readonly unknown[],
  expectation?: CheckExpectation,
): SqlMigrationPlanOperationStep {
  return {
    description,
    sql,
    ...ifDefined('params', params),
    ...ifDefined('expectation', expectation),
  };
}

const IN_DATABASE = 'TABLE_SCHEMA = DATABASE()';

interface CatalogQuery {
  readonly sql: string;
  readonly params: readonly unknown[];
}

function count(from: string, where: string, params: readonly unknown[]): CatalogQuery {
  return {
    sql: `SELECT COUNT(*) FROM information_schema.${from} WHERE ${IN_DATABASE} AND ${where}`,
    params,
  };
}

function present(query: CatalogQuery): CatalogQuery {
  return { sql: `SELECT (${query.sql}) > 0 AS result`, params: query.params };
}

function absent(query: CatalogQuery): CatalogQuery {
  return { sql: `SELECT (${query.sql}) = 0 AS result`, params: query.params };
}

const tableQuery = (table: string) => count('TABLES', 'TABLE_NAME = ?', [table]);

const columnQuery = (table: string, column: string) =>
  count('COLUMNS', 'TABLE_NAME = ? AND COLUMN_NAME = ?', [table, column]);

const indexQuery = (table: string, index: string) =>
  count('STATISTICS', 'TABLE_NAME = ? AND INDEX_NAME = ?', [table, index]);

const constraintQuery = (table: string, name: string, type: 'UNIQUE' | 'FOREIGN KEY') =>
  count('TABLE_CONSTRAINTS', 'TABLE_NAME = ? AND CONSTRAINT_NAME = ? AND CONSTRAINT_TYPE = ?', [
    table,
    name,
    type,
  ]);

/** A step that holds when `query` finds the object, or finds none, as `holds` says. */
function check(
  description: string,
  query: CatalogQuery,
  holds: 'present' | 'absent',
  object: string,
): SqlMigrationPlanOperationStep {
  const { sql, params } = holds === 'present' ? present(query) : absent(query);
  return step(
    description,
    sql,
    params,
    holds === 'present' ? expectPresent(object) : expectAbsent(object),
  );
}

export const tableChecks = (table: string) => ({
  present: (description: string) =>
    check(description, tableQuery(table), 'present', `table "${table}"`),
  absent: (description: string) =>
    check(description, tableQuery(table), 'absent', `table "${table}"`),
});

export const columnChecks = (table: string, column: string) => ({
  present: (description: string) =>
    check(description, columnQuery(table, column), 'present', `column "${column}" on "${table}"`),
  absent: (description: string) =>
    check(description, columnQuery(table, column), 'absent', `column "${column}" on "${table}"`),
});

export const indexChecks = (table: string, index: string) => ({
  present: (description: string) =>
    check(description, indexQuery(table, index), 'present', `index "${index}" on "${table}"`),
  absent: (description: string) =>
    check(description, indexQuery(table, index), 'absent', `index "${index}" on "${table}"`),
});

export const constraintChecks = (table: string, name: string, type: 'UNIQUE' | 'FOREIGN KEY') => {
  const object = `${type === 'UNIQUE' ? 'unique constraint' : 'foreign key'} "${name}" on "${table}"`;
  return {
    present: (description: string) =>
      check(description, constraintQuery(table, name, type), 'present', object),
    absent: (description: string) =>
      check(description, constraintQuery(table, name, type), 'absent', object),
  };
};

export function columnList(columns: readonly string[]): string {
  return columns.map(quoteIdentifier).join(', ');
}

/** The column definition `ALTER TABLE … ADD COLUMN` writes, with the default the adapter renders through the column's codec. */
export async function columnDefinitionSql(
  column: DdlColumn,
  table: string,
  lowerer: ExecuteRequestLowerer,
): Promise<string> {
  const defaultClause = await lowerer.renderColumnDefault(column, table);
  return [
    quoteIdentifier(column.name),
    column.type,
    ...(column.notNull ? ['NOT NULL'] : []),
    ...(defaultClause.length > 0 ? [defaultClause] : []),
  ].join(' ');
}

export function foreignKeyActionsSql(actions: {
  readonly onDelete?: ReferentialAction | undefined;
  readonly onUpdate?: ReferentialAction | undefined;
}): string {
  return [
    ...(actions.onDelete === undefined
      ? []
      : [` ON DELETE ${REFERENTIAL_ACTION_SQL[actions.onDelete]}`]),
    ...(actions.onUpdate === undefined
      ? []
      : [` ON UPDATE ${REFERENTIAL_ACTION_SQL[actions.onUpdate]}`]),
  ].join('');
}

/** An operation written out in full in `migration.ts`, such as a table rename made by hand. */
export function rawSql(op: Op): Op {
  return op;
}
