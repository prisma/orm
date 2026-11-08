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
    const normalized = normalizeRedactedUrl(url);
    const parsed = new URL(normalized.connectionString);
    const database = parsed.pathname?.replace(/^\//, '') || undefined;
    const omitted = normalized.hostWasOmitted;
    return {
      ...ifDefined('host', omitted ? undefined : parsed.hostname || undefined),
      ...ifDefined('port', parsed.port || undefined),
      ...ifDefined('database', database),
      ...ifDefined('username', parsed.username || undefined),
    };
  } catch {
    // Ignore parsing errors; return empty metadata
    return {};
  }
}

function normalizeRedactedUrl(url: string): { connectionString: string; hostWasOmitted: boolean } {
  try {
    new URL(url);
    return { connectionString: url, hostWasOmitted: false };
  } catch {
    const match = /^postgres(?:ql)?:\/\/([^/@]*@)?(:[^/]*)?(\/|$)/.exec(url);
    if (match === null) return { connectionString: url, hostWasOmitted: false };
    const afterUserinfo = url.indexOf('//') + 2 + (match[1]?.length ?? 0);
    return {
      connectionString: `${url.slice(0, afterUserinfo)}redacted-placeholder.invalid${url.slice(afterUserinfo)}`,
      hostWasOmitted: true,
    };
  }
}
