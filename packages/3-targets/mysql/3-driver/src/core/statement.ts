import { mysqlError } from '@internal/target-mysql/errors';
import { assertDefined } from '@internal/utils/assertions';
import type { Connection } from 'mariadb';
import { positionalParams } from './positional-params';
import { CLEAR_UNSUPPORTED_SQL_MODES } from './session-setup';

/** The server status flag MySQL sets in every reply while the session's `sql_mode` includes `NO_BACKSLASH_ESCAPES`. */
const NO_BACKSLASH_ESCAPES = 1 << 9;

function noBackslashEscapesRefusal(params: number): Error {
  return mysqlError(
    'RUNTIME.SQL_MODE_UNSUPPORTED',
    "MySQL reports NO_BACKSLASH_ESCAPES in this connection's sql_mode, which the MySQL target does not support, so the driver does not send a statement with values",
    {
      why: 'In this mode MySQL ends a string at a backslash and a quote, while the mariadb package, which writes the values into the statement, finds its placeholders as if the backslash escaped the quote, so a value could land outside its string literal and run as SQL. The driver removes the mode on every connection it opens; a statement on this connection set it again, such as a raw SET sql_mode or a stored procedure, and it stays until the connection closes.',
      fix: `Do not set NO_BACKSLASH_ESCAPES on a connection Prisma uses, in raw SQL, a stored procedure or a trigger. A raw SET run outside a transaction stays on whichever pooled connection ran it; restart the client to close that connection. A statement that needs the mode must run in a transaction or on a connection you hold, which must set the mode back before it is released, with ${CLEAR_UNSUPPORTED_SQL_MODES}. A statement without values still runs.`,
      meta: { sqlMode: 'NO_BACKSLASH_ESCAPES', params },
    },
  );
}

/**
 * The statement to hand to `connection`: `sql` with its placeholders written as `?` and the values in their order, for the package to write in. A statement without values comes back as written with no values, so the package sends it without searching it for placeholders. Refuses a statement with values while the server last reported `NO_BACKSLASH_ESCAPES` on, which only a statement the application sends can turn on. A statement without values still runs, so the mode can be turned off again; the driver's lexer still reads a backslash as an escape then, so at worst it refuses such a statement for a `?` it reads outside a string.
 */
export function statementFor(
  connection: Pick<Connection, 'info'>,
  sql: string,
  params: readonly unknown[],
): { readonly sql: string; readonly values: unknown[] | undefined } {
  const { info } = connection;
  assertDefined(info, 'the package gives every connection its info when it creates it');
  if (params.length > 0 && (info.status & NO_BACKSLASH_ESCAPES) !== 0) {
    throw noBackslashEscapesRefusal(params.length);
  }
  const statement = positionalParams(sql, params);
  return params.length > 0 ? statement : { sql, values: undefined };
}
