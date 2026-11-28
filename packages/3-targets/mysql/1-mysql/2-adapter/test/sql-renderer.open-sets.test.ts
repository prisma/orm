import { createMysqlBuiltinCodecLookup } from '@internal/target-mysql/codecs';
import { mysqlTargetDescriptorMetaRuntime } from '@internal/target-mysql/descriptor-meta-runtime';
import { describe, expect, it } from 'vitest';
import { MysqlSqlRenderer, type ReturningStatement } from '../src/core/sql-renderer';

class ReturningRefusalProbe extends MysqlSqlRenderer {
  refusalFor(statement: ReturningStatement): string {
    return this.returningRefusal(statement);
  }
}

describe('returningRefusal for a statement a later release adds', () => {
  it('names the statement with an article', () => {
    const probe = new ReturningRefusalProbe(
      createMysqlBuiltinCodecLookup(),
      mysqlTargetDescriptorMetaRuntime,
    );
    expect(probe.refusalFor('merge')).toBe(
      'MySQL cannot return the rows a merge writes; it has no RETURNING',
    );
  });
});
