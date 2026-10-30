import { readFileSync } from 'node:fs';
import { ifDefined } from '@internal/utils/defined';
import { structuredError } from '@internal/utils/structured-error';
import { type } from 'arktype';
import type { ConnectionConfig, PoolConfig } from 'mariadb';
import { SESSION_SETUP } from './session-setup';
import { readTextOrBytes } from './text-or-bytes';

/** The pool settings `mysql()` takes, named and defaulted as the Postgres facade's `poolOptions` and `pg.Pool`. */
export interface MysqlPoolOptions {
  /** How long to wait for a new connection to open, and for a pooled one to come free, in milliseconds. 20 seconds by default. */
  readonly connectionTimeoutMillis?: number;
  /** How long a pooled connection may stay idle before the pool closes it, in milliseconds. 30 seconds by default; 0 keeps idle connections open. */
  readonly idleTimeoutMillis?: number;
  /** The most connections the pool opens. 10 by default. */
  readonly max?: number;
}

const DEFAULT_CONNECT_TIMEOUT_MILLIS = 20_000;
const DEFAULT_IDLE_TIMEOUT_MILLIS = 30_000;

/**
 * The URL parameters the driver reads. The TLS parameters are those `pg-connection-string` reads for the Postgres driver: `ssl` turns TLS on or off; `sslmode`, `sslcert`, `sslkey` and `sslrootcert` turn it on, the last three naming PEM files.
 */
const URL_PARAMETERS = {
  'ssl?': type("'true' | '1' | 'false' | '0'").pipe((text) => text === 'true' || text === '1'),
  'sslmode?': "'disable' | 'prefer' | 'require' | 'verify-ca' | 'verify-full' | 'no-verify'",
  'sslcert?': 'string > 0',
  'sslkey?': 'string > 0',
  'sslrootcert?': 'string > 0',
  'allowPublicKeyRetrieval?': type("'true' | 'false'").pipe((text) => text === 'true'),
} as const;

const urlParameters = type(URL_PARAMETERS);

type ParameterName = keyof typeof URL_PARAMETERS extends `${infer Name}?` ? Name : never;

/** The form each URL parameter's value must take, for the refusal of a value. */
const PARAMETER_FORMS: Readonly<Record<ParameterName, string>> = {
  ssl: 'true, 1, false or 0',
  sslmode: 'disable, prefer, require, verify-ca, verify-full or no-verify',
  sslcert: 'the path of a PEM file',
  sslkey: 'the path of a PEM file',
  sslrootcert: 'the path of a PEM file',
  allowPublicKeyRetrieval: 'true or false',
};

function isParameterName(name: string): name is ParameterName {
  return Object.hasOwn(PARAMETER_FORMS, name);
}

type UrlParameters = typeof urlParameters.infer;

/**
 * Options the URL cannot change. The package writes each value into its statement at a bare `?`; every option that would change where or how it writes one (named placeholders, an object written as `SET` entries, several statements in one) stays off, and `logParam` keeps values out of error messages. `permitRedirect` stays off, so a server cannot send the client, with its credentials, to another host, which `pg` never does. `typeCast` reads every column as text or bytes, so no column reaches a codec as a value the package parsed. `foundRows` makes an UPDATE count the rows it matched, as Postgres's row count does. The connection is utf8mb4: the driver reads each statement as utf8mb4 to find its placeholders, and MySQL must read it the same way.
 */
const FIXED_OPTIONS: ConnectionConfig & { readonly permitRedirect: false } = {
  collation: 'UTF8MB4_UNICODE_CI',
  multipleStatements: false,
  namedPlaceholders: false,
  permitSetMultiParamEntries: false,
  permitLocalInfile: false,
  logParam: false,
  permitRedirect: false,
  foundRows: true,
  typeCast: readTextOrBytes,
};

/** Refuses the URL. `parameters` names the parameters at fault; no value from the URL goes into the error, because a URL carries the password. */
function invalidBinding(reason: string, parameters: readonly string[]): Error {
  return structuredError('RUNTIME.BINDING_INVALID', `MySQL connection URL: ${reason}`, {
    meta: { received: parameters.join(', '), reason },
  });
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
  const names = [...new Set(parsed.searchParams.keys())].filter(isParameterName);
  const parameters = urlParameters(
    Object.fromEntries([...parsed.searchParams].filter(([name]) => isParameterName(name))),
  );
  if (parameters instanceof type.errors) {
    const invalid = names.filter((name) => parameters.some((error) => error.path[0] === name));
    throw invalidBinding(
      invalid.map((name) => `${name} must be ${PARAMETER_FORMS[name]}`).join('; '),
      invalid,
    );
  }
  if (parameters.sslcert !== undefined && parameters.sslkey === undefined) {
    throw invalidBinding(
      "sslcert names the client's certificate and needs sslkey; to check the server's certificate against a CA file, as sslcert did in Prisma 7, use sslrootcert",
      ['sslcert'],
    );
  }
  return { parsed, parameters };
}

function readPem(parameter: 'sslcert' | 'sslkey' | 'sslrootcert', path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    throw invalidBinding(`the file ${parameter} names cannot be read`, [parameter]);
  }
}

/**
 * The TLS settings the URL gives, read as `pg-connection-string` reads them for the Postgres driver: `ssl=true` turns TLS on and `ssl=false` off; `sslcert`, `sslkey`, `sslrootcert` or `sslmode` turn it on, with the certificate, key and CA read from the files they name. `sslmode=disable` turns it off; `no-verify` accepts any server certificate; every other mode verifies the certificate and the host name, as `verify-full` does.
 */
function tlsOptions(parameters: UrlParameters): ConnectionConfig['ssl'] {
  const { sslcert, sslkey, sslrootcert, sslmode } = parameters;
  if ([sslcert, sslkey, sslrootcert, sslmode].every((value) => value === undefined)) {
    return parameters.ssl;
  }
  if (sslmode === 'disable') return false;
  return {
    ...ifDefined('cert', sslcert === undefined ? undefined : readPem('sslcert', sslcert)),
    ...ifDefined('key', sslkey === undefined ? undefined : readPem('sslkey', sslkey)),
    ...ifDefined('ca', sslrootcert === undefined ? undefined : readPem('sslrootcert', sslrootcert)),
    ...(sslmode === 'no-verify' ? { rejectUnauthorized: false } : {}),
  };
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
    ...ifDefined('ssl', tlsOptions(parameters)),
    allowPublicKeyRetrieval: parameters.allowPublicKeyRetrieval ?? false,
    connectTimeout: connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MILLIS,
    initSql: [...SESSION_SETUP],
    ...FIXED_OPTIONS,
  };
}

/** The `mariadb` options for one connection to the server a `mysql://` URL names. Ignores a URL parameter the driver does not read, as `pg` does, and refuses a charset. */
export function mysqlConnectionOptions(
  url: string,
  settings?: { readonly connectTimeoutMs?: number | undefined },
): ConnectionConfig {
  const { parsed, parameters } = readUrl(url);
  return connectionOptions(parsed, parameters, settings?.connectTimeoutMs);
}

/**
 * The `mariadb` pool options for a `mysql://` URL, sized and timed as the Postgres driver's `pg.Pool`: it opens a connection only when one is needed (`minimumIdle: 0`), closes one idle for `idleTimeoutMillis`, and waits `connectionTimeoutMillis` both to open a connection and for a pooled one to come free.
 */
export function mysqlPoolOptions(url: string, poolOptions?: MysqlPoolOptions): PoolConfig {
  const { parsed, parameters } = readUrl(url);
  const timeoutMs = poolOptions?.connectionTimeoutMillis ?? DEFAULT_CONNECT_TIMEOUT_MILLIS;
  return {
    ...connectionOptions(parsed, parameters, timeoutMs),
    acquireTimeout: timeoutMs,
    minimumIdle: 0,
    idleTimeout: Math.ceil((poolOptions?.idleTimeoutMillis ?? DEFAULT_IDLE_TIMEOUT_MILLIS) / 1000),
    ...ifDefined('connectionLimit', poolOptions?.max),
  };
}
