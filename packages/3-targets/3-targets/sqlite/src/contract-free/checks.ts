import { FunctionSource, type SelectAst } from '@internal/sql-relational-core/ast';
import { cfExpr, cfTable, exprSelect } from '@internal/sql-relational-core/contract-free';
import { SQLITE_TEXT_CODEC_ID } from '../core/codec-ids';

export interface ColumnExistsCheckBuilder {
  columnAbsent(): SelectAst;
  columnPresent(): SelectAst;
}

/**
 * Typed builder for the migration planner's column-existence checks. Produces
 * `SELECT COUNT(*) {=|>} 0 AS "result" FROM pragma_table_info(?) WHERE "name" = ?`
 * ASTs with the table and column names bound as text parameters — never
 * inlined into the SQL.
 */
export function columnExistsAst(table: string, column: string): ColumnExistsCheckBuilder {
  const source = FunctionSource.of('pragma_table_info', [
    cfExpr.param(table, SQLITE_TEXT_CODEC_ID).ast,
  ]);
  const where = cfExpr.identifierRef('name').eqParam(column, SQLITE_TEXT_CODEC_ID);
  return {
    columnAbsent: () =>
      exprSelect().from(source).project('result', cfExpr.countStar().eqLit(0)).where(where).build(),
    columnPresent: () =>
      exprSelect().from(source).project('result', cfExpr.countStar().gtLit(0)).where(where).build(),
  };
}

export interface ColumnNameTakenCheckBuilder {
  nameFree(): SelectAst;
}

/**
 * Typed builder for the check that no column of the table has a name SQLite takes for `column`.
 * Produces `SELECT COUNT(*) = 0 AS "result" FROM pragma_table_info(?) WHERE "name" COLLATE NOCASE
 * = ?`: SQLite compares column names without regard to the case of ASCII letters, as `NOCASE`
 * does.
 */
export function columnNameTakenAst(table: string, column: string): ColumnNameTakenCheckBuilder {
  const source = FunctionSource.of('pragma_table_info', [
    cfExpr.param(table, SQLITE_TEXT_CODEC_ID).ast,
  ]);
  const name = cfExpr.fn({
    method: 'collateNocase',
    template: '{{self}} COLLATE NOCASE',
    self: cfExpr.identifierRef('name'),
    returns: { codecId: SQLITE_TEXT_CODEC_ID, nullable: false },
  });
  const where = name.eqParam(column, SQLITE_TEXT_CODEC_ID);
  return {
    nameFree: () =>
      exprSelect().from(source).project('result', cfExpr.countStar().eqLit(0)).where(where).build(),
  };
}

export interface TableExistsCheckBuilder {
  tableAbsent(): SelectAst;
  tablePresent(): SelectAst;
}

/**
 * Typed builder for table-existence checks over `sqlite_master`.
 * Produces `SELECT COUNT(*) {=|>} 0 AS "result" FROM "sqlite_master" WHERE "type" = ? AND "name" = ?`
 * with the table name and the literal `'table'` bound as text parameters.
 */
export function tableExistsAst(tableName: string): TableExistsCheckBuilder {
  const source = cfTable('sqlite_master');
  const where = cfExpr.allOf([
    cfExpr.identifierRef('type').eqParam('table', SQLITE_TEXT_CODEC_ID),
    cfExpr.identifierRef('name').eqParam(tableName, SQLITE_TEXT_CODEC_ID),
  ]);
  return {
    tableAbsent: () =>
      exprSelect().from(source).project('result', cfExpr.countStar().eqLit(0)).where(where).build(),
    tablePresent: () =>
      exprSelect().from(source).project('result', cfExpr.countStar().gtLit(0)).where(where).build(),
  };
}

export interface TableNameTakenCheckBuilder {
  nameFree(): SelectAst;
}

/**
 * Typed builder for the check that no table, index or view has a name SQLite takes for `name`.
 * Produces `SELECT COUNT(*) = 0 AS "result" FROM "sqlite_master" WHERE "name" COLLATE NOCASE = ?`:
 * tables, indexes and views share one set of names, which SQLite compares without regard to the
 * case of ASCII letters.
 */
export function tableNameTakenAst(tableName: string): TableNameTakenCheckBuilder {
  const name = cfExpr.fn({
    method: 'collateNocase',
    template: '{{self}} COLLATE NOCASE',
    self: cfExpr.identifierRef('name'),
    returns: { codecId: SQLITE_TEXT_CODEC_ID, nullable: false },
  });
  const where = name.eqParam(tableName, SQLITE_TEXT_CODEC_ID);
  return {
    nameFree: () =>
      exprSelect()
        .from(cfTable('sqlite_master'))
        .project('result', cfExpr.countStar().eqLit(0))
        .where(where)
        .build(),
  };
}

export interface IndexExistsCheckBuilder {
  indexAbsent(): SelectAst;
  indexPresent(): SelectAst;
}

/**
 * Typed builder for index-existence checks over `sqlite_master`.
 * Produces `SELECT COUNT(*) {=|>} 0 AS "result" FROM "sqlite_master" WHERE "type" = ? AND "name" = ?`
 * with the index name and the literal `'index'` bound as text parameters.
 */
export function indexExistsAst(indexName: string): IndexExistsCheckBuilder {
  const source = cfTable('sqlite_master');
  const where = cfExpr.allOf([
    cfExpr.identifierRef('type').eqParam('index', SQLITE_TEXT_CODEC_ID),
    cfExpr.identifierRef('name').eqParam(indexName, SQLITE_TEXT_CODEC_ID),
  ]);
  return {
    indexAbsent: () =>
      exprSelect().from(source).project('result', cfExpr.countStar().eqLit(0)).where(where).build(),
    indexPresent: () =>
      exprSelect().from(source).project('result', cfExpr.countStar().gtLit(0)).where(where).build(),
  };
}
