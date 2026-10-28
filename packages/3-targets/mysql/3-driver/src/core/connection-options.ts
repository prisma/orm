import { ifDefined } from '@internal/utils/defined';
import { structuredError } from '@internal/utils/structured-error';
import { type } from 'arktype';
import type { ConnectionConfig, PoolConfig } from 'mariadb';
import { SESSION_SETUP } from './session-setup';
import { readTextOrBytes } from './text-or-bytes';

const positiveInteger = type('string.integer.parse').to('number.integer > 0');

const tlsSettings = type({
  'ca?': 'string',
  'cert?': 'string',
  'key?': 'string',
  'passphrase?': 'string',
  'servername?': 'string',
  'rejectUnauthorized?': 'boolean',
}).onUndeclaredKey('reject');

/** The largest statement cache a URL may ask for: at the pool's default of 10 connections, 1,000 each keeps one process at 10,000 open statements, under MySQL's server-wide default of 16,382. */
const MAX_STATEMENT_CACHE_SIZE = 1000;

/**
 * The URL parameters the driver reads. `ssl` is `true` or a JSON object of TLS settings; `statementCacheSize` is the number of prepared statements each connection keeps open, 0 (off) by default.
 */
const URL_PARAMETERS = {
  'ssl?': type('string.json.parse').to(type('boolean').or(tlsSettings)),
  'connectTimeout?': positiveInteger,
  'allowPublicKeyRetrieval?': type("'true' | 'false'").pipe((text) => text === 'true'),
  'connectionLimit?': positiveInteger,
  'poolTimeout?': positiveInteger,
  'statementCacheSize?': type('string.integer.parse').to(
    type('number.integer >= 0').atMost(MAX_STATEMENT_CACHE_SIZE),
  ),
} as const;

const urlParameters = type(URL_PARAMETERS);

type ParameterName = keyof typeof URL_PARAMETERS extends `${infer Name}?` ? Name : never;

/** The form each URL parameter's value must take, for the refusal of a value. */
const PARAMETER_FORMS: Readonly<Record<ParameterName, string>> = {
  ssl: 'true, false, or a JSON object of ca, cert, key, passphrase, servername and rejectUnauthorized',
  connectTimeout: 'a positive integer of milliseconds',
  allowPublicKeyRetrieval: 'true or false',
  connectionLimit: 'a positive integer',
  poolTimeout: 'a positive integer of milliseconds',
  statementCacheSize: `an integer from 0 to ${MAX_STATEMENT_CACHE_SIZE}, so a process's connections stay under MySQL's server-wide limit on open prepared statements`,
};

const PARAMETER_NAMES = Object.keys(PARAMETER_FORMS);

/** What replaces each parameter of a Prisma 7 engine URL. */
const ENGINE_PARAMETER_REPLACEMENTS: ReadonlyMap<string, string> = new Map([
  ['connection_limit', 'use connectionLimit'],
  ['pool_timeout', 'use poolTimeout, in milliseconds'],
  ['connect_timeout', 'use connectTimeout, in milliseconds'],
  ['sslcert', "use ssl, with the CA certificate's PEM text as ca"],
  ['sslidentity', "use ssl, with the client certificate's and key's PEM text as cert and key"],
  ['sslpassword', "use ssl's passphrase"],
  ['sslaccept', "use ssl's rejectUnauthorized"],
  ['socket_timeout', 'no replacement'],
  ['statement_cache_size', 'use statementCacheSize'],
]);

function isParameterName(name: string): name is ParameterName {
  return Object.hasOwn(PARAMETER_FORMS, name);
}

type UrlParameters = typeof urlParameters.infer;

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_POOL_TIMEOUT_MS = 10_000;

/**
 * Options the URL cannot change. Values travel only as prepared-statement parameters, so every option that would rewrite SQL on the client stays off, and `logParam` keeps values out of error messages. `typeCast` reads every column as text or bytes, so no column reaches a codec as a value the package parsed. The connection is utf8mb4: the driver reads each statement as utf8mb4 to find its placeholders, and MySQL must read it the same way.
 */
const FIXED_OPTIONS: ConnectionConfig = {
  collation: 'UTF8MB4_UNICODE_CI',
  initSql: [...SESSION_SETUP],
  multipleStatements: false,
  namedPlaceholders: false,
  permitSetMultiParamEntries: false,
  permitLocalInfile: false,
  logParam: false,
  typeCast: readTextOrBytes,
};

/** Refuses the URL. `parameters` names the parameters at fault; no value from the URL goes into the error, because a URL carries the password and TLS keys. */
function invalidBinding(reason: string, parameters: readonly string[]): Error {
  return structuredError('RUNTIME.BINDING_INVALID', `MySQL connection URL: ${reason}`, {
    meta: { received: parameters.join(', '), reason },
  });
}

function describeUnknown(name: string): string {
  const replacement = ENGINE_PARAMETER_REPLACEMENTS.get(name);
  return replacement === undefined ? name : `${name} (${replacement})`;
}

function acceptedList(): string {
  return `${PARAMETER_NAMES.slice(0, -1).join(', ')} and ${PARAMETER_NAMES.at(-1)}`;
}

/** Parses `url` as the Postgres facade does, refusing it without the parser's error, which carries the whole URL. */
function parseUrl(url: string): URL {
  try {
    return new URL(url);
  } catch {
    throw invalidBinding('the URL cannot be parsed', []);
  }
}

function readUrl(url: string): { readonly parsed: URL; readonly parameters: UrlParameters } {
  const parsed = parseUrl(url);
  if (parsed.searchParams.has('charset')) {
    throw invalidBinding(
      'the driver always uses utf8mb4, because it reads each statement as utf8mb4 to find its placeholders; remove the charset parameter',
      ['charset'],
    );
  }
  const names = [...new Set(parsed.searchParams.keys())];
  const unknown = names.filter((name) => !isParameterName(name));
  if (unknown.length > 0) {
    throw invalidBinding(
      `the driver does not accept ${unknown.map(describeUnknown).join(', ')}; it accepts ${acceptedList()}`,
      unknown,
    );
  }
  const parameters = urlParameters(Object.fromEntries(parsed.searchParams));
  if (parameters instanceof type.errors) {
    const invalid = names
      .filter(isParameterName)
      .filter((name) => parameters.some((error) => error.path[0] === name));
    throw invalidBinding(
      invalid.map((name) => `${name} must be ${PARAMETER_FORMS[name]}`).join('; '),
      invalid,
    );
  }
  return { parsed, parameters };
}

function connectionOptions(
  parsed: URL,
  parameters: UrlParameters,
  connectTimeoutMs: number | undefined,
): ConnectionConfig {
  return {
    host: decodeURIComponent(parsed.hostname).replace(/^\[(.*)\]$/, '$1'),
    ...ifDefined('port', parsed.port === '' ? undefined : Number(parsed.port)),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: decodeURIComponent(parsed.pathname.slice(1)),
    ...ifDefined('ssl', parameters.ssl),
    allowPublicKeyRetrieval: parameters.allowPublicKeyRetrieval ?? false,
    connectTimeout: connectTimeoutMs ?? parameters.connectTimeout ?? DEFAULT_CONNECT_TIMEOUT_MS,
    prepareCacheLength: parameters.statementCacheSize ?? 0,
    ...FIXED_OPTIONS,
  };
}

/** The `mariadb` options for one connection to the server a `mysql://` URL names. Refuses a URL parameter the driver does not read, and a charset. */
export function mysqlConnectionOptions(url: string, connectTimeoutMs?: number): ConnectionConfig {
  const { parsed, parameters } = readUrl(url);
  return connectionOptions(parsed, parameters, connectTimeoutMs);
}

/** The `mariadb` pool options for a `mysql://` URL: the connection options, `connectionLimit`, and `poolTimeout` in milliseconds, ten seconds unless the URL says otherwise, as the pool's `acquireTimeout`. */
export function mysqlPoolOptions(url: string): PoolConfig {
  const { parsed, parameters } = readUrl(url);
  return {
    ...connectionOptions(parsed, parameters, undefined),
    ...ifDefined('connectionLimit', parameters.connectionLimit),
    acquireTimeout: parameters.poolTimeout ?? DEFAULT_POOL_TIMEOUT_MS,
  };
}
