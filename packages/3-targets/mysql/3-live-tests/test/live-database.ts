import type { SqlControlDriverInstance } from '@internal/sql-contract/types';
import { withMysqlDatabase } from '@repo/test-utils/mysql-database';
import type { LiveTargetId } from '#live-types';
import type { LiveServer } from './live-server';

/** What a vitest test context offers to skip the test. */
interface SkippableTest {
  skip(note?: string): void;
}

/** The `User` and `Post` tables, written by hand as a MySQL or MariaDB user would create them. */
export const exampleTablesDdl = [
  `CREATE TABLE \`User\` (
    \`id\` int NOT NULL AUTO_INCREMENT,
    \`email\` varchar(191) NOT NULL,
    \`role\` enum('USER','ADMIN') NOT NULL,
    PRIMARY KEY (\`id\`),
    UNIQUE KEY \`User_email_key\` (\`email\`)
  )`,
  `CREATE TABLE \`Post\` (
    \`id\` int NOT NULL AUTO_INCREMENT,
    \`title\` varchar(191) NOT NULL,
    \`authorId\` int NOT NULL,
    PRIMARY KEY (\`id\`),
    KEY \`Post_authorId_idx_e47547ed\` (\`authorId\`),
    CONSTRAINT \`Post_authorId_fkey\` FOREIGN KEY (\`authorId\`) REFERENCES \`User\` (\`id\`)
  )`,
] as const;

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
export async function withSeededDatabase(
  test: SkippableTest,
  server: LiveServer,
  statements: readonly string[],
  fn: (url: string, driver: SqlControlDriverInstance<LiveTargetId>) => Promise<void>,
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
