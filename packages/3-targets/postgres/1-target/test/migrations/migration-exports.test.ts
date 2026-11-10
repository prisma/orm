import { describe, expect, it } from 'vitest';
import * as migrationExports from '../../src/exports/migration';

describe('@internal/target-postgres/migration exports', () => {
  it('exports only helpers a migration.ts can call without a control adapter', () => {
    expect(Object.keys(migrationExports).sort()).toEqual([
      'Migration',
      'MigrationCLI',
      'checkExpression',
      'col',
      'dataTransform',
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
