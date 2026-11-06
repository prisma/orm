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
 * Checks whether a parsed database URL has a comma-separated multi-host authority that should be rejected during metadata extraction, while allowing MongoDB replica sets and percent-encoded Unix socket paths.
 */
function hasRejectedMultiHost(parsed: URL): boolean {
  if (!parsed.host.includes(',') && !parsed.hostname.includes(',')) {
    return false;
  }
  // biome-ignore lint/plugin/no-family-vocabulary: protocol check for database URL metadata extraction
  if (parsed.protocol === 'mongodb:') {
    return false;
  }
  try {
    return !decodeURIComponent(parsed.hostname).startsWith('/');
  } catch {
    return true;
  }
}

/**
 * Parses a database connection URL for metadata extraction, normalizing blank-host authorities with a synthetic placeholder host when needed.
 */
function parseUrlForMetadata(url: string): { parsed: URL; dummyHost: boolean } | undefined {
  try {
    const parsed = new URL(url);
    if (hasRejectedMultiHost(parsed)) {
      return undefined;
    }
    return { parsed, dummyHost: false };
  } catch {
    let dummyHost = false;
    const normalized = url.replace(
      /^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^/?#]*)/,
      (_match, scheme: string, authority: string) => {
        const atIndex = authority.lastIndexOf('@');
        const userinfo = atIndex !== -1 ? authority.slice(0, atIndex + 1) : '';
        let hostpart = atIndex !== -1 ? authority.slice(atIndex + 1) : authority;
        if (!hostpart.includes(',') && (hostpart === '' || hostpart.startsWith(':'))) {
          dummyHost = true;
          hostpart = `dummy-host${hostpart}`;
        }
        return `${scheme}${userinfo}${hostpart}`;
      },
    );
    try {
      const parsed = new URL(normalized);
      if (hasRejectedMultiHost(parsed)) {
        return undefined;
      }
      return { parsed, dummyHost };
    } catch {
      return undefined;
    }
  }
}

/**
 * Redacts a database connection URL to a minimal metadata object.
 *
 * Parsing errors are ignored and result in an empty object so callers never
 * leak raw URLs when the input is malformed.
 */
export function redactDatabaseUrl(url: string): RedactedDatabaseUrl {
  const result = parseUrlForMetadata(url);
  if (result === undefined) {
    return {};
  }
  const { parsed, dummyHost } = result;
  const database = parsed.pathname?.replace(/^\//, '') || undefined;
  return {
    ...ifDefined('host', dummyHost ? undefined : parsed.hostname || undefined),
    ...ifDefined('port', parsed.port || undefined),
    ...ifDefined('database', database),
    ...ifDefined('username', parsed.username || undefined),
  };
}
