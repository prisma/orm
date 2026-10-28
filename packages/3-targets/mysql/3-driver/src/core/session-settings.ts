import type { SessionSettings } from '@internal/framework-components/components';
import { quoteIdentifier } from '@internal/target-mysql/sql-utils';
import { assertDefined } from '@internal/utils/assertions';
import type { Connection } from 'mariadb';

const DECIMAL_INTEGER = /^-?\d+$/;

/** A setting's value as MySQL takes it: decimal integer text as a whole number, because MySQL refuses text for an integer variable, and any other text as it is. */
function settingValue(value: string): string | bigint {
  return DECIMAL_INTEGER.test(value) ? BigInt(value) : value;
}

export interface SessionSettingsStatement {
  readonly sql: string;
  readonly values: readonly (string | bigint)[];
}

/** The one statement that sets `sessionSettings`: each name a quoted identifier, each value a parameter. Undefined when there is nothing to set. */
export function sessionSettingsStatement(
  sessionSettings: SessionSettings,
): SessionSettingsStatement | undefined {
  const entries = Object.entries(sessionSettings);
  if (entries.length === 0) return undefined;
  return {
    sql: `SET SESSION ${entries.map(([name]) => `${quoteIdentifier(name)} = ?`).join(', ')}`,
    values: entries.map(([, value]) => settingValue(value)),
  };
}

/** Sets the session settings on `connection` with a prepared statement, so no value travels inside SQL text. Throws the package's error as it is. */
export async function applySessionSettings(
  connection: Connection,
  statement: SessionSettingsStatement,
): Promise<void> {
  const prepared = await connection.prepare(statement.sql);
  try {
    await prepared.execute([...statement.values]);
  } finally {
    prepared.close();
  }
}

/**
 * Ensures the session settings a target declares on each physical connection the runtime driver gets from its pool, once, as the Postgres driver's `SessionSettingsGuard` does for a pool it did not start the sessions of. The package hands out a new wrapper for each `getConnection`, so a connection is known by its `info`, which belongs to the physical connection.
 */
export class SessionSettingsGuard {
  readonly #statement: SessionSettingsStatement | undefined;
  readonly #ensured = new WeakSet<object>();

  constructor(sessionSettings: SessionSettings) {
    this.#statement = sessionSettingsStatement(sessionSettings);
  }

  async ensure(connection: Connection): Promise<void> {
    const key = connection.info;
    assertDefined(key, 'the package gives every connection its info when it creates it');
    if (this.#statement === undefined || this.#ensured.has(key)) return;
    await applySessionSettings(connection, this.#statement);
    this.#ensured.add(key);
  }
}
