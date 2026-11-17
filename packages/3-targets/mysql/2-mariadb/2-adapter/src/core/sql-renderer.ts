import { MysqlSqlRenderer, type ReturningStatement } from '@internal/adapter-mysql/sql-renderer';
import type { ProjectionItem } from '@internal/sql-relational-core/ast';
import type { MysqlCodecDescriptorRegistry } from '@internal/target-mysql/codec-descriptor';
import { mysqlError } from '@internal/target-mysql/errors';

/**
 * MySQL's renderer, writing SQL MariaDB takes. MariaDB has no row alias on an insert, so an upsert writes none and reads the proposed row's column as `VALUES(column)`, which MariaDB 10.11 and 11.4 accept without a deprecation warning. MariaDB has `INSERT … RETURNING` and `DELETE … RETURNING`, which the adapter does not use, so a refusal of them says so.
 */
export class MariadbSqlRenderer extends MysqlSqlRenderer {
  constructor(codecs: MysqlCodecDescriptorRegistry) {
    super(codecs, { targetId: 'mariadb', displayName: 'MariaDB' });
  }

  protected override onDuplicateKeyUpdate(set: string): string {
    return `ON DUPLICATE KEY UPDATE ${set}`;
  }

  protected override proposedRowColumn(column: string): string {
    return `VALUES(${column})`;
  }

  protected override refuseReturning(
    returning: ReadonlyArray<ProjectionItem> | undefined,
    statement: ReturningStatement,
  ): void {
    if (statement === 'update' || returning === undefined || returning.length === 0) {
      super.refuseReturning(returning, statement);
      return;
    }
    const keyword = statement.toUpperCase();
    throw mysqlError(
      'RUNTIME.AST_UNSUPPORTED',
      `The MariaDB adapter does not write ${keyword} … RETURNING: it reports no returning capability, since MariaDB has no UPDATE … RETURNING, so the ORM reads written rows back with a select`,
      { meta: { target: 'mariadb', feature: 'returning' } },
    );
  }
}
