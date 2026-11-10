import type { SqlMigrationPlanOperationStep } from '@internal/family-sql/control';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDriver,
  createTestDatabase,
  type PostgresControlDriver,
  resetDatabase,
  testTimeout,
} from './runner-fixtures';

export interface PostcheckOperation {
  readonly precheck: readonly SqlMigrationPlanOperationStep[];
  readonly execute: readonly SqlMigrationPlanOperationStep[];
  readonly postcheck: readonly SqlMigrationPlanOperationStep[];
}

/**
 * One operation, checked both ways: on a database holding `before` and `conflicting` (an object with the operation's name but another definition) its postchecks must not all hold, so the runner cannot skip it; on a database holding only `before` its prechecks must hold, and after its execute steps its postchecks must hold.
 */
export interface PostcheckCase {
  readonly name: string;
  readonly before: readonly string[];
  readonly conflicting: readonly string[];
  readonly operation: () => Promise<PostcheckOperation>;
}

export interface PostcheckDatabase {
  run(statements: readonly string[]): Promise<void>;
  allHold(steps: readonly SqlMigrationPlanOperationStep[]): Promise<boolean>;
}

/** Runs `cases` both ways against a fresh PGlite database per case. `schemas` are dropped before each case, beside `public`. */
export function describePostcheckCases(
  title: string,
  cases: readonly PostcheckCase[],
  options: {
    readonly schemas: readonly string[];
    readonly extra?: (database: PostcheckDatabase) => void;
  },
): void {
  describe(title, { concurrent: false }, () => {
    let database: Awaited<ReturnType<typeof createTestDatabase>>;
    let driver: PostgresControlDriver | undefined;

    beforeAll(async () => {
      database = await createTestDatabase();
    }, testTimeout);

    afterAll(async () => {
      await database?.close();
    }, testTimeout);

    beforeEach(async () => {
      driver = await createDriver(database.connectionString);
      await resetDatabase(driver);
      for (const schema of options.schemas) {
        await driver.query(`drop schema if exists "${schema}" cascade`);
      }
    }, testTimeout);

    afterEach(async () => {
      await driver?.close();
      driver = undefined;
    }, testTimeout);

    function requireDriver(): PostgresControlDriver {
      if (driver === undefined) throw new Error('driver not initialised');
      return driver;
    }

    const db: PostcheckDatabase = {
      async run(statements) {
        for (const statement of statements) await requireDriver().query(statement);
      },
      async allHold(steps) {
        for (const step of steps) {
          const result = await requireDriver().query<Record<string, unknown>>(
            step.sql,
            step.params ?? [],
          );
          if (Object.values(result.rows[0] ?? {})[0] !== true) return false;
        }
        return true;
      },
    };

    it.each(cases)(
      '$name: the postchecks do not all hold',
      async ({ before, conflicting, operation }) => {
        await db.run([...before, ...conflicting]);
        const op = await operation();

        expect(await db.allHold(op.postcheck)).toBe(false);
      },
      testTimeout,
    );

    it.each(cases)(
      '$name: on a database without the object the prechecks hold, and the postchecks hold once it runs',
      async ({ before, operation }) => {
        await db.run(before);
        const op = await operation();
        const prechecksHold = await db.allHold(op.precheck);
        await db.run(op.execute.map((step) => step.sql));

        expect({ prechecksHold, postchecksHold: await db.allHold(op.postcheck) }).toEqual({
          prechecksHold: true,
          postchecksHold: true,
        });
      },
      testTimeout,
    );

    options.extra?.(db);
  });
}
