/**
 * A field that keeps its name while `@map` gives it a new column (Postgres).
 *
 * The Postgres twin of `field-map-change.sqlite.e2e.test.ts`. Journey F1 runs once through `migration plan` and `db migrate`, and once through `db update`: the column is renamed with no question, the unique constraint named after it follows, and the values are read back under the new name.
 */

import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import { timeouts, useDevDatabase } from '../utils/journey-test-helpers';
import {
  COMMANDS,
  columnNames,
  emit,
  expectSettled,
  latestMigrationSource,
  planAndApply,
  postgresJourney,
  rows,
  start,
} from '../utils/stored-name-journeys';

const FROM_PSL = `// use prisma-8

model User {
  id    Int    @id
  email String @unique @map("email")

  @@map("users")
}
`;

const TO_PSL = FROM_PSL.replace('@map("email")', '@map("email_address")');

withTempDir(({ createTempDir }) => {
  describe.each(COMMANDS)('Journey F1 (Postgres): a changed @map with %s', (command) => {
    const db = useDevDatabase();

    it(
      'renames the column with no question and keeps its values',
      async () => {
        const journey = postgresJourney(db.connectionString, createTempDir, command);
        await start(
          journey,
          FROM_PSL,
          `INSERT INTO "users" (id, email) VALUES (1, 'alice@example.com'), (2, 'bob@example.com')`,
          'F1.01',
        );
        await emit(journey, TO_PSL, 'F1.02');

        expect(
          await planAndApply(journey, [], 'F1.03'),
          'F1.03: the column and its constraint are renamed',
        ).toEqual([
          { label: 'Rename column "users"."email" to "email_address"', operationClass: 'widening' },
          {
            label:
              'Rename unique constraint "users_email_key" to "users_email_address_key" on "users"',
            operationClass: 'widening',
          },
        ]);
        if (command === 'migration plan') {
          expect(latestMigrationSource(journey), 'F1.03: migration.ts renames the column').toMatch(
            /\.\.\.this\.renameColumn\(\{\s*schema: 'public',\s*table: 'users',\s*column: 'email',\s*to: 'email_address',?\s*\}\)/,
          );
        }
        expect(await columnNames(journey, 'users'), 'F1.04: the column has its new name').toEqual([
          'email_address',
          'id',
        ]);
        expect(
          await rows(journey, 'SELECT * FROM "users" ORDER BY id'),
          'F1.04: the values',
        ).toEqual([
          { id: 1, email_address: 'alice@example.com' },
          { id: 2, email_address: 'bob@example.com' },
        ]);
        await expectSettled(journey, 'F1.05');
      },
      timeouts.spinUpPpgDev,
    );
  });
});
