import { defineContract, field, model } from '@prisma/orm-sqlite/contract-builder';
import { describe, expect, it } from 'vitest';
import { applyMigration, int, integerColumn } from './harness';

/**
 * Regression for the integer `@default` drift loop: an integer default the database reports must
 * read, through the column's codec, as the value the contract stores, or every plan reports a
 * default mismatch.
 */
describe('SQLite Migration E2E - integer default drift', () => {
  it('verifies an integer `@default(42)` without drift', async () => {
    await applyMigration(
      {
        destination: defineContract({
          models: {
            Setting: model('Setting', {
              fields: {
                id: int.id(),
                priority: field.column(integerColumn).default(42),
              },
            }),
          },
        }),
      },
      async ({ driver }) => {
        await driver.query('INSERT INTO "Setting" (id) VALUES (?)', [1]);
        const rows = await driver.query<{ priority: number }>(
          'SELECT priority FROM "Setting" WHERE id = ?',
          [1],
        );
        expect(rows.rows[0]!.priority).toBe(42);
      },
    );
  });
});
