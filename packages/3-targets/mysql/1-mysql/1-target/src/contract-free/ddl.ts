import type { DdlColumn, DdlTableConstraint } from '@internal/sql-relational-core/ast';
import { MysqlCreateTable } from '../core/ddl/nodes';

/**
 * A MySQL `CREATE TABLE` node. Identifiers and column types are written as given, so callers pass trusted values such as the control tables' names; string literal defaults are escaped by the renderer.
 */
export function createTable(options: {
  readonly table: string;
  readonly ifNotExists?: boolean;
  readonly columns: readonly DdlColumn[];
  readonly constraints?: readonly DdlTableConstraint[];
}): MysqlCreateTable {
  return new MysqlCreateTable(options);
}
