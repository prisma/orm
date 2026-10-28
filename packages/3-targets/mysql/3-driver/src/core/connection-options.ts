import { ifDefined } from '@internal/utils/defined';
import { structuredError } from '@internal/utils/structured-error';
import { type } from 'arktype';
import type { ConnectionConfig, PoolConfig } from 'mariadb';
import { SESSION_SETUP } from './session-setup';

const positiveInteger = type('string.integer.parse').to('number.integer > 0');

const tlsSettings = type({
  'ca?': 'string',
  'cert?': 'string',
  'key?': 'string',
  'passphrase?': 'string',
  'servername?': 'string',
  'rejectUnauthorized?': 'boolean',
}).onUndeclaredKey('reject');

/**
 * The URL parameters the driver reads. `ssl` is `true` or a JSON object of TLS settings; `statementCacheSize` is the number of prepared statements each connection keeps open, 0 (off) by default.
 */
const URL_PARAMETERS = {
  'ssl?': type('string.json.parse').to(type('boolean').or(tlsSettings)),
  'connectTimeout?': positiveInteger,
  'allowPublicKeyRetrieval?': type("'true' | 'false'").pipe((text) => text === 'true'),
  'connectionLimit?': positiveInteger,
  'poolTimeout?': positiveInteger,
  'statementCacheSize?': type('string.integer.parse').to('number.integer >= 0'),
} as const;

const urlParameters = type(URL_PARAMETERS).onUndeclaredKey('reject');

const PARAMETER_NAMES = Object.keys(URL_PARAMETERS).map((key) => key.slice(0, -1));

type UrlParameters = typeof urlParameters.infer;

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_POOL_TIMEOUT_MS = 10_000;

/**
 * Options the URL cannot change. The package reads `jsonStrings` and `bitOneIsBoolean`, which its typings leave out. Values travel only as prepared-statement parameters, so every option that would rewrite SQL on the client stays off, and `logParam` keeps values out of error messages. Rows read BIGINT as a `bigint`, DECIMAL as its digits, dates and JSON as the text MySQL sends, and BIT(1) as bytes. The connection is utf8mb4: the driver reads each statement as utf8mb4 to find its placeholders, and MySQL must read it the same way.
 */
const FIXED_OPTIONS: ConnectionConfig & {
  readonly jsonStrings: boolean;
  readonly bitOneIsBoolean: boolean;
} = {
  collation: 'UTF8MB4_UNICODE_CI',
  initSql: [...SESSION_SETUP],
  multipleStatements: false,
  namedPlaceholders: false,
  permitSetMultiParamEntries: false,
  permitLocalInfile: false,
  logParam: false,
  bigIntAsNumber: false,
  decimalAsNumber: false,
  dateStrings: true,
  jsonStrings: true,
  autoJsonMap: false,
  bitOneIsBoolean: false,
};

function invalidBinding(reason: string, received: string): Error {
  return structuredError('RUNTIME.BINDING_INVALID', `MySQL connection URL: ${reason}`, {
    meta: { received, reason },
  });
}

function readUrl(url: string): { readonly parsed: URL; readonly parameters: UrlParameters } {
  const parsed = new URL(url);
  if (parsed.searchParams.has('charset')) {
    throw invalidBinding(
      'the driver always uses utf8mb4, because it reads each statement as utf8mb4 to find its placeholders; remove the charset parameter',
      'charset',
    );
  }
  const parameters = urlParameters(Object.fromEntries(parsed.searchParams));
  if (parameters instanceof type.errors) {
    throw invalidBinding(
      `${parameters.summary}; the driver reads ${PARAMETER_NAMES.join(', ')}`,
      parsed.search,
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
