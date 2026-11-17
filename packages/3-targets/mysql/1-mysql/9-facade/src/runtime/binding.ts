import type { MysqlBinding } from '@internal/driver-mysql/runtime';
import { structuredError } from '@internal/utils/structured-error';

export type MysqlBindingInput = { readonly url: string };

/** The database a client binds to: its target id, its name as messages show it, and the URL schemes it accepts. */
export interface BoundDatabase {
  readonly targetId: string;
  readonly displayName: string;
  readonly urlSchemes: readonly string[];
}

function invalidUrl(database: BoundDatabase, message: string, meta: Record<string, string>): Error {
  return structuredError('RUNTIME.BINDING_INVALID', message, {
    meta: { extension: database.targetId, ...meta },
  });
}

/** Checks `url` as the Postgres facade checks its own: a non-empty URL that parses, with a scheme the database accepts. No part of the URL goes into the error. */
export function validateMysqlUrl(url: string, database: BoundDatabase): string {
  const { displayName, urlSchemes } = database;
  const trimmed = url.trim();
  if (trimmed.length === 0) {
    throw invalidUrl(database, `${displayName} URL must be a non-empty string`, {
      reason: 'empty url',
    });
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw invalidUrl(database, `${displayName} URL must be a valid URL`, {
      reason: 'unparseable url',
    });
  }
  if (!urlSchemes.some((scheme) => parsed.protocol === `${scheme}:`)) {
    throw invalidUrl(
      database,
      `${displayName} URL must use ${urlSchemes.map((scheme) => `${scheme}://`).join(' or ')}`,
      { reason: 'wrong scheme', received: parsed.protocol },
    );
  }
  return trimmed;
}

export function resolveMysqlBinding(
  input: MysqlBindingInput,
  database: BoundDatabase,
): MysqlBinding {
  return { kind: 'url', url: validateMysqlUrl(input.url, database) };
}

export function resolveOptionalMysqlBinding(
  options: { readonly url?: string },
  database: BoundDatabase,
): MysqlBinding | undefined {
  return options.url === undefined
    ? undefined
    : resolveMysqlBinding({ url: options.url }, database);
}
