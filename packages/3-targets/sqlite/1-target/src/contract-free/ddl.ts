import type { DdlColumn, DdlTableConstraint } from '@internal/sql-relational-core/ast';
import { SqliteCreateTable } from '../core/ddl/nodes';

/**
 * Build a SQLite `CREATE TABLE` query node.
 *
 * Pass `constraints` for table-level composite primary keys, foreign keys, and
 * unique constraints — use the {@link PrimaryKeyConstraint}, {@link ForeignKeyConstraint},
 * and {@link UniqueConstraint} classes from `@internal/sql-relational-core/ast`.
 *
 * Precondition: identifiers (`table`, column names/types) are emitted to SQL
 * verbatim — they are not quoted or escaped, so callers must pass pre-trusted
 * values (e.g. fixed control-plane identifiers). String-literal default values,
 * by contrast, are single-quote-escaped (embedded `'` doubled) by the renderer.
 * Identifier quoting for untrusted identifiers is added when the migration
 * planner adopts this lowering path.
 */
export function createTable(options: {
  readonly table: string;
  readonly schema?: string;
  readonly ifNotExists?: boolean;
  readonly columns: readonly DdlColumn[];
  readonly constraints?: readonly DdlTableConstraint[];
}): SqliteCreateTable {
  return new SqliteCreateTable(options);
}
