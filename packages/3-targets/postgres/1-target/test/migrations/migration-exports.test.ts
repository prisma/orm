import { describe, expect, it } from 'vitest';
import * as migrationExports from '../../src/exports/migration';

describe('@internal/target-postgres/migration exports', () => {
  it('exports no free function that needs an argument only the migration class has', () => {
    expect(Object.keys(migrationExports).sort()).toEqual([
      'Migration',
      'MigrationCLI',
      'checkExpression',
      'col',
      'fn',
      'foreignKey',
      'lit',
      'placeholder',
      'primaryKey',
      'rawSql',
      'sql',
      'unique',
    ]);
  });
});
