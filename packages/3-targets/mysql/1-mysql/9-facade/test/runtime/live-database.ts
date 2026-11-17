import type { SqlControlDriverInstance } from '@internal/sql-contract/types';
import { withMysqlDatabase } from '@repo/test-utils/mysql-database';
import { exampleTablesDdl } from '../example-contract';
import type { LiveServer } from './live-servers';

/** What a vitest test context offers to skip the test. */
interface SkippableTest {
  skip(note?: string): void;
}

/** Users, by id: 1 and 2 have posts, 3 and 4 have none. */
export const exampleRows = [
  "INSERT INTO `User` (`id`, `email`, `role`) VALUES (1, 'b@example.com', 'ADMIN'), (2, 'a@example.com', 'ADMIN'), (3, 'c@example.com', 'USER'), (4, 'd@example.com', 'ADMIN')",
  "INSERT INTO `Post` (`id`, `title`, `authorId`) VALUES (1, 'Alpha', 1), (2, 'Gamma', 1), (3, 'Beta', 1), (4, 'Delta', 2)",
] as const;

export async function runStatements(
  driver: SqlControlDriverInstance,
  statements: readonly string[],
): Promise<void> {
  for (const sql of statements) await driver.query(sql);
}

/**
 * Runs `fn` against a database of its own on `server`, holding `statements`, created with the server's control driver as a user would by hand. Skips when the server's URL variable is not set.
 */
export async function withSeededDatabase<TargetId extends string>(
  test: SkippableTest,
  server: LiveServer<TargetId>,
  statements: readonly string[],
  fn: (url: string, driver: SqlControlDriverInstance<TargetId>) => Promise<void>,
): Promise<void> {
  await withMysqlDatabase(
    test,
    async ({ url }) => {
      const driver = await server.controlDriver.create(url);
      try {
        await runStatements(driver, statements);
        await fn(url, driver);
      } finally {
        await driver.close();
      }
    },
    server.urlVariable,
  );
}

export const exampleDatabase = [...exampleTablesDdl, ...exampleRows] as const;
