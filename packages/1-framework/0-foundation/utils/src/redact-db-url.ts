import { ifDefined } from './defined';

/**
 * Minimal metadata extracted from a database URL for logging or error output.
 * Sensitive fields (password, full URL) are never returned.
 */
export interface RedactedDatabaseUrl {
  readonly host?: string;
  readonly port?: string;
  readonly database?: string;
  readonly username?: string;
}

/**
 * Redacts a database connection URL to a minimal metadata object.
 *
 * Parsing errors are ignored and result in an empty object so callers never
 * leak raw URLs when the input is malformed.
 */
export function redactDatabaseUrl(url: string): RedactedDatabaseUrl {
  try {
    const parsed = new URL(url);
    const database = parsed.pathname?.replace(/^\//, '') || undefined;
    return {
      ...ifDefined('host', parsed.hostname || undefined),
      ...ifDefined('port', parsed.port || undefined),
      ...ifDefined('database', database),
      ...ifDefined('username', parsed.username || undefined),
    };
  } catch {
    // Ignore parsing errors; return empty metadata
    return {};
  }
}
