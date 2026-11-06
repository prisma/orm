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
function hasRejectedMultiHost(parsed: URL): boolean {
  return (
    (parsed.host.includes(',') || parsed.hostname.includes(',')) &&
    // biome-ignore lint/plugin/no-family-vocabulary: protocol check for database URL metadata extraction
    parsed.protocol !== 'mongodb:'
  );
}

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
