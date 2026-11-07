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

const SCHEME_AUTHORITY_PATH =
  /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/(?:([^/?#@\s]*)@)?([^/?#:\s]*)(?::(\d+))?(?:\/([^?#\s]*))?/;

/**
 * Redacts a database connection URL to a minimal metadata object.
 *
 * Supports PostgreSQL/libpq-style connection URLs where user or host is left
 * blank (such as `postgresql:///mydb`, `postgresql://user@/mydb`, or
 * `postgresql://@localhost:5432/mydb`), which standard WHATWG `new URL()`
 * rejects when userinfo is present without a host.
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
      ...ifDefined('username', parsed.username ? decodeURIComponent(parsed.username) : undefined),
    };
  } catch {
    const match = url.match(SCHEME_AUTHORITY_PATH);
    if (!match) {
      return {};
    }
    const rawUserinfo = match[1] ?? '';
    const colonIndex = rawUserinfo.indexOf(':');
    const rawUsername = colonIndex === -1 ? rawUserinfo : rawUserinfo.slice(0, colonIndex);
    const host = match[2] || undefined;
    const port = match[3] || undefined;
    const database = match[4] || undefined;
    let username: string | undefined;
    try {
      username = rawUsername ? decodeURIComponent(rawUsername) : undefined;
    } catch {
      username = rawUsername || undefined;
    }
    return {
      ...ifDefined('host', host),
      ...ifDefined('port', port),
      ...ifDefined('database', database),
      ...ifDefined('username', username),
    };
  }
}
