import { describe, expect, it } from 'vitest';
import { errorSqliteMigrationStackMissing } from '../src/core/errors';

describe('errorSqliteMigrationStackMissing', () => {
  it('renders under the stable MIGRATION.SQLITE_CONTROL_STACK_MISSING code', () => {
    expect(errorSqliteMigrationStackMissing('createTable').toEnvelope().code).toBe(
      'MIGRATION.SQLITE_CONTROL_STACK_MISSING',
    );
  });

  it('names the operation that failed in summary, why, and meta', () => {
    const envelope = errorSqliteMigrationStackMissing('dropColumn').toEnvelope();
    expect(envelope.summary).toContain('dropColumn');
    expect(envelope.why).toContain('dropColumn');
    expect(envelope.meta).toEqual({ operation: 'dropColumn' });
  });

  it('reports each operation distinctly rather than always naming one', () => {
    const createTable = errorSqliteMigrationStackMissing('createTable').toEnvelope().summary;
    const dropColumn = errorSqliteMigrationStackMissing('dropColumn').toEnvelope().summary;
    expect(createTable).not.toBe(dropColumn);
  });
});
