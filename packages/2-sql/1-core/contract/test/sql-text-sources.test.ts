import { describe, expect, it } from 'vitest';
import { createSqlTextSources } from '../src/sql-text-sources';

describe('createSqlTextSources', () => {
  it('imports sql only once a written text uses the tag', () => {
    const sql = createSqlTextSources('@internal/postgres/migration');
    const fallback = sql.source('  now()');
    const importsAfterFallback = sql.imports();
    const template = sql.source('now()');
    sql.source('\nx');

    expect({ fallback, importsAfterFallback, template, imports: sql.imports() }).toEqual({
      fallback: '"  now()"',
      importsAfterFallback: [],
      template: 'sql`now()`',
      imports: [{ moduleSpecifier: '@internal/postgres/migration', symbol: 'sql' }],
    });
  });
});
