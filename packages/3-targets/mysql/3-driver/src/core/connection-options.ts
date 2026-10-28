import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { structuredError } from '@internal/utils/structured-error';
import type { ConnectionOptions } from 'mysql2/promise';

const MULTI_STATEMENTS_FLAG = 'MULTI_STATEMENTS';

/** The URL parameters mysql2 reads as connection options. Any other mysql2 option could change how a statement is sent, such as `namedPlaceholders`, so none other is passed on. */
const CONNECTION_PARAMETERS = new Set(['ssl', 'connectTimeout', 'flags']);

/** The URL parameters the runtime driver's pool reads. */
const POOL_PARAMETERS = new Set(['connectionLimit', 'poolTimeout', 'statementCacheSize']);

/** How mysql2 reads the binary protocol's rows: a bigint and a decimal as their exact text, a date and time as the text MySQL prints, JSON as its UTF-8 text, binary strings as Buffers, and every other string as text. */
const BINARY_ROW_OPTIONS = {
  supportBigNumbers: true,
  bigNumberStrings: true,
  dateStrings: true,
  jsonStrings: true,
} as const;

const DEFAULT_POOL_TIMEOUT_MS = 10_000;

/** Prepared statements each connection keeps open, as the Prisma engines' MySQL connector does. MySQL caps open statements server-wide (16,382 by default), and mysql2's own default of 16,000 per connection would let two connections reach it. */
const DEFAULT_STATEMENT_CACHE_SIZE = 100;

/** The largest statement cache a URL may ask for: at mysql2's default of 10 connections, 1,000 each keeps one process at 10,000 open statements, under MySQL's server-wide default of 16,382. */
const MAX_STATEMENT_CACHE_SIZE = 1000;

/** The connection's character set. The renderer writes literal text into the SQL, which mysql2 encodes in this charset; a narrower one, such as latin1 or sjis, can turn a character of it into a quote or a backslash after escaping. */
const CHARSET = 'UTF8MB4_UNICODE_CI';

function parameterValue(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function invalidBinding(reason: string, received: string): Error {
  return structuredError('RUNTIME.BINDING_INVALID', `MySQL connection URL: ${reason}`, {
    meta: { received, reason },
  });
}

function urlParameters(parsed: URL): Map<string, string> {
  const parameters = new Map(parsed.searchParams);
  for (const name of parameters.keys()) {
    if (name === 'charset') {
      throw invalidBinding(
        'the driver always uses utf8mb4, because a narrower charset can turn a character of a value into a quote after escaping; remove the charset parameter',
        name,
      );
    }
    if (!CONNECTION_PARAMETERS.has(name) && !POOL_PARAMETERS.has(name)) {
      throw invalidBinding(
        `the parameter ${name} is not one the MySQL driver reads; it reads ${[...CONNECTION_PARAMETERS, ...POOL_PARAMETERS].join(', ')}`,
        name,
      );
    }
  }
  return parameters;
}

function flagsWithoutMultipleStatements(flags: unknown): string[] | undefined {
  if (flags === undefined) return undefined;
  const listed = Array.isArray(flags) ? flags.map(String) : String(flags).split(/\s*,+\s*/);
  return listed
    .map((flag) => flag.toUpperCase())
    .filter((flag) => flag.length > 0 && flag !== MULTI_STATEMENTS_FLAG);
}

/**
 * The mysql2 options for a connection URL, always utf8mb4, with multiple statements kept off whatever the flags say. Refuses a URL parameter the driver does not read, and a charset.
 */
export function mysqlConnectionOptions(url: string, connectTimeoutMs?: number): ConnectionOptions {
  const parsed = new URL(url);
  const parameters = urlParameters(parsed);
  const { flags, ...options } = Object.fromEntries(
    [...parameters]
      .filter(([name]) => CONNECTION_PARAMETERS.has(name))
      .map(([name, value]) => [name, parameterValue(value)]),
  );
  return {
    ...blindCast<
      ConnectionOptions,
      'each allowed URL parameter is the mysql2 option of the same name, JSON-parsed when it parses'
    >(options),
    host: decodeURIComponent(parsed.hostname),
    ...ifDefined('port', parsed.port === '' ? undefined : Number(parsed.port)),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: decodeURIComponent(parsed.pathname.slice(1)),
    ...ifDefined('flags', flagsWithoutMultipleStatements(flags)),
    multipleStatements: false,
    ...BINARY_ROW_OPTIONS,
    charset: CHARSET,
    timezone: 'Z',
    ...ifDefined('connectTimeout', connectTimeoutMs),
  };
}

export interface MysqlPoolSettings {
  readonly connectionLimit: number | undefined;
  /** How long a statement waits for a free pooled connection before it fails. */
  readonly poolTimeoutMs: number;
  /** How many prepared statements each connection keeps open; it closes the least recently used one beyond that. */
  readonly statementCacheSize: number;
}

function positiveInteger(name: string, text: string | undefined): number | undefined {
  if (text === undefined) return undefined;
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw invalidBinding(`${name} must be a positive integer`, `${name}=${text}`);
  }
  return value;
}

function statementCacheSize(text: string | undefined): number {
  const size = positiveInteger('statementCacheSize', text) ?? DEFAULT_STATEMENT_CACHE_SIZE;
  if (size > MAX_STATEMENT_CACHE_SIZE) {
    throw invalidBinding(
      `statementCacheSize must be at most ${MAX_STATEMENT_CACHE_SIZE}, so a process's connections stay under MySQL's server-wide limit on open prepared statements`,
      `statementCacheSize=${text}`,
    );
  }
  return size;
}

/** The pool settings a connection URL gives: `connectionLimit`; `poolTimeout` in milliseconds, ten seconds unless the URL says otherwise; and `statementCacheSize`, 100 unless it says otherwise. */
export function mysqlPoolSettings(url: string): MysqlPoolSettings {
  const parameters = urlParameters(new URL(url));
  return {
    connectionLimit: positiveInteger('connectionLimit', parameters.get('connectionLimit')),
    poolTimeoutMs:
      positiveInteger('poolTimeout', parameters.get('poolTimeout')) ?? DEFAULT_POOL_TIMEOUT_MS,
    statementCacheSize: statementCacheSize(parameters.get('statementCacheSize')),
  };
}
