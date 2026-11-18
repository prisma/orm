import {
  MysqlSqlRenderer,
  type ProposedRow,
  type ReturningStatement,
} from '@internal/adapter-mysql/sql-renderer';

/**
 * MySQL's renderer, writing SQL MariaDB takes and saying what is true of MariaDB. MariaDB has no row alias on an insert, so an upsert declares none and reads the proposed row's column as `VALUES(column)`, which MariaDB 10.11 and 11.4 accept without a deprecation warning. MariaDB has `INSERT … RETURNING` and `DELETE … RETURNING` but no `UPDATE … RETURNING`. MariaDB loads includes with one query per relation, so an ordered JSON array, which MySQL builds with a hint MariaDB reads as a comment and a cast to a JSON type MariaDB lacks, is refused.
 */
export class MariadbSqlRenderer extends MysqlSqlRenderer {
  protected override proposedRow(): ProposedRow {
    return { alias: undefined, column: (quotedColumn) => `VALUES(${quotedColumn})` };
  }

  protected override returningRefusal(statement: ReturningStatement): string {
    if (statement === 'update') {
      return `${this.target.displayName} has no UPDATE … RETURNING, so the ORM reads updated rows back with a select`;
    }
    return `The ${this.target.displayName} adapter does not write ${statement.toUpperCase()} … RETURNING: it reports no returning capability, since ${this.target.displayName} has no UPDATE … RETURNING, so the ORM reads written rows back with a select`;
  }

  protected override orderedJsonArrayRefusal(): string {
    return `The ${this.target.displayName} adapter does not build an ordered JSON array in SQL; the ORM loads includes with one query per relation`;
  }
}
