import { MysqlSqlRenderer } from '@internal/adapter-mysql/sql-renderer';

/** MySQL's renderer, with the upsert MariaDB takes: MariaDB has no row alias on an insert, so the proposed row's column is read as `VALUES(column)`, which MariaDB 10.11 and 11.4 accept without a deprecation warning. */
export class MariadbSqlRenderer extends MysqlSqlRenderer {
  protected override onDuplicateKeyUpdate(set: string): string {
    return `ON DUPLICATE KEY UPDATE ${set}`;
  }

  protected override proposedRowColumn(column: string): string {
    return `VALUES(${column})`;
  }
}
