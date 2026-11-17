const MASK = '****';
const URL_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;
const LEADING_URL_USERINFO = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^/?#\s]+)@/;
const URL_USERINFO = /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^/?#\s]+)@/g;
const PASSWORD_QUERY_PARAMETER = /([?&][^=&#\s]*password[^=&#\s]*=)([^&#\s]*)/gi;

export interface UrlUserinfo {
  readonly username: string;
  readonly password: string;
}

export function hasUrlScheme(text: string): boolean {
  return URL_SCHEME.test(text);
}

/**
 * Reads the userinfo of a URL without parsing its hosts, so it works for URLs `new URL` rejects,
 * such as a seed list of several `host:port` pairs. The userinfo ends at the last `@` before the
 * first `/`, `?` or `#`.
 */
export function urlUserinfo(url: string): UrlUserinfo {
  return splitUserinfo(url.match(LEADING_URL_USERINFO)?.[1] ?? '');
}

/**
 * Reads the values of the query parameters whose key contains `password`, the same ones
 * `redactUrlCredentials` masks, without parsing hosts.
 */
export function passwordQueryValues(url: string): string[] {
  return [...url.matchAll(PASSWORD_QUERY_PARAMETER)].map((match) => match[2] ?? '');
}

/**
 * Masks the userinfo and any password query parameter of every URL in `text`, without parsing
 * hosts. The masked form matches what `new URL` gives when its username and password are set to
 * `****`.
 */
export function redactUrlCredentials(text: string): string {
  return text
    .replace(
      URL_USERINFO,
      (_match, scheme: string, userinfo: string) =>
        `${scheme}${maskUserinfo(splitUserinfo(userinfo))}@`,
    )
    .replace(PASSWORD_QUERY_PARAMETER, `$1${MASK}`);
}

function splitUserinfo(userinfo: string): UrlUserinfo {
  const colon = userinfo.indexOf(':');
  if (colon === -1) {
    return { username: userinfo, password: '' };
  }
  return { username: userinfo.slice(0, colon), password: userinfo.slice(colon + 1) };
}

function maskUserinfo({ username, password }: UrlUserinfo): string {
  return `${username ? MASK : ''}${password ? `:${MASK}` : ''}`;
}
