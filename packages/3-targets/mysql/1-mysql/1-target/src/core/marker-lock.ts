import type { SqlControlDriverInstance } from '@internal/sql-contract/types';
import { mysqlError } from './errors';

/** How long a migration runner or `db sign` waits for another one to release the marker lock. */
export const MARKER_LOCK_TIMEOUT_SECONDS = 60;

/** `GET_LOCK` names are global to the server, so the name carries a hash of the connection's database: two databases on one server never wait on each other. */
const LOCK_NAME = "CONCAT('prisma_marker_', LEFT(SHA2(DATABASE(), 256), 50))";

function lockResult(rows: readonly Record<string, unknown>[]): string | undefined {
  const value = rows[0]?.['acquired'];
  return value === null || value === undefined ? undefined : String(value);
}

/**
 * Takes the marker lock on the connection `driver` holds. MySQL holds a `GET_LOCK` lock for the session, not for a transaction, so the caller releases it with {@link releaseMarkerLock} on the same connection when the work it guards ends.
 */
export async function acquireMarkerLock(
  driver: SqlControlDriverInstance<string>,
  timeoutSeconds: number = MARKER_LOCK_TIMEOUT_SECONDS,
): Promise<void> {
  const { rows } = await driver.query(`SELECT GET_LOCK(${LOCK_NAME}, ?) AS acquired`, [
    timeoutSeconds,
  ]);
  if (lockResult(rows) !== '1') {
    throw mysqlError(
      'MIGRATION.MARKER_LOCK_TIMEOUT',
      `Another process held the migration marker lock for ${timeoutSeconds} seconds.`,
      {
        why: 'A migration or db sign on this database is still running, and they write the contract markers one at a time.',
        fix: 'Wait for the other process to finish, then run the command again.',
        meta: { timeoutSeconds },
      },
    );
  }
}

/** Releases the marker lock {@link acquireMarkerLock} took on this connection. */
export async function releaseMarkerLock(driver: SqlControlDriverInstance<string>): Promise<void> {
  await driver.query(`SELECT RELEASE_LOCK(${LOCK_NAME}) AS released`);
}

/**
 * Releases the marker lock after work that failed, keeping that failure: a release that fails too is dropped. MySQL frees a session's locks when the session ends, which is the usual reason a release fails.
 */
async function releaseMarkerLockAfterFailure(
  driver: SqlControlDriverInstance<string>,
): Promise<void> {
  await releaseMarkerLock(driver).catch(() => undefined);
}

/**
 * The one way MySQL holds the marker lock: takes it on the connection `driver` holds, runs `work`, and releases it on the same connection when `work` ends. A failed release is reported only when `work` succeeded; when `work` throws, or `succeeded` says its result is a failure, that outcome is what comes back.
 */
export async function withMarkerLock<T>(
  driver: SqlControlDriverInstance<string>,
  work: () => Promise<T>,
  succeeded: (result: T) => boolean = () => true,
): Promise<T> {
  await acquireMarkerLock(driver);
  let result: T;
  try {
    result = await work();
  } catch (error) {
    await releaseMarkerLockAfterFailure(driver);
    throw error;
  }
  if (succeeded(result)) await releaseMarkerLock(driver);
  else await releaseMarkerLockAfterFailure(driver);
  return result;
}
