import type { SqlControlDriverInstance } from '@internal/sql-contract/types';
import { assembleMysqlCodecRegistry } from '@internal/target-mysql/codecs';
import { mysqlDataTypes } from '@internal/target-mysql/data-types';
import { MysqlControlAdapter } from '../src/core/migrations/control-adapter';
import { readMysqlCatalog } from '../src/core/migrations/introspection-queries';

export function createAdapter(): MysqlControlAdapter<'mysql'> {
  return new MysqlControlAdapter(
    assembleMysqlCodecRegistry({}, []),
    mysqlDataTypes,
    'mysql',
    readMysqlCatalog,
  );
}

/** A driver that records each statement and answers it from `answer`. */
export function recordingDriver(
  answer: (
    sql: string,
    params: readonly unknown[],
  ) => readonly Record<string, unknown>[] = () => [],
): SqlControlDriverInstance<'mysql'> & { readonly statements: string[] } {
  const statements: string[] = [];
  return {
    familyId: 'sql',
    targetId: 'mysql',
    statements,
    async query<Row>(sql: string, params: readonly unknown[] = []) {
      statements.push(sql);
      return { rows: answer(sql, params) as Row[] };
    },
    async close() {},
  };
}
