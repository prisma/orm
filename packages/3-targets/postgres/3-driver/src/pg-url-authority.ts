const PLACEHOLDER_HOST = 'prisma-placeholder.invalid';

const POSTGRES_SCHEME = /^postgres(?:ql)?:\/\//;

/**
 * WHATWG's URL parser rejects a postgres URL whose authority omits the host (`postgresql:///db`,
 * `postgresql://:5432/db`, `postgresql://user@/db`), yet libpq accepts every one of them: an empty
 * host means the default unix socket, and an empty user means the operating-system user. `pg`
 * follows libpq, so Prisma must accept these URLs and pass them through without inventing values.
 *
 * The parser only needs a host-shaped authority to survive; `parseHostlessAuthority` inserts a
 * reserved `.invalid` placeholder and reports that the host was omitted, so callers can drop the
 * fabricated host and leave the connection settings to libpq's defaults.
 */
export interface NormalizedPostgresUrl {
  readonly connectionString: string;
  readonly hostWasOmitted: boolean;
}

function normalizeHostlessAuthority(url: string, hostStart: number): NormalizedPostgresUrl {
  const placeholder = `${url.slice(0, hostStart)}${PLACEHOLDER_HOST}${url.slice(hostStart)}`;
  return { connectionString: placeholder, hostWasOmitted: true };
}

/**
 * Returns `url` parseable by WHATWG's URL parser, plus whether the host had to be fabricated. A
 * URL whose host is present, including an encoded unix socket path, is returned unchanged.
 */
export function normalizePostgresAuthority(url: string): NormalizedPostgresUrl {
  if (!POSTGRES_SCHEME.test(url)) {
    return { connectionString: url, hostWasOmitted: false };
  }
  const authorityStart = url.indexOf('//', url.indexOf(':') + 1) + 2;
  const authorityEnd = url.indexOf('/', authorityStart);
  const authority = url.slice(authorityStart, authorityEnd === -1 ? undefined : authorityEnd);
  const atSign = authority.lastIndexOf('@');
  const hostPart = authority.slice(atSign + 1);
  if (hostPart !== '' && !hostPart.startsWith(':')) {
    return { connectionString: url, hostWasOmitted: false };
  }
  return normalizeHostlessAuthority(url, authorityStart + atSign + 1);
}

/** The host the placeholder replaced, when {@link normalizePostgresAuthority} fabricated one. */
export const omittedPostgresHost = PLACEHOLDER_HOST;
