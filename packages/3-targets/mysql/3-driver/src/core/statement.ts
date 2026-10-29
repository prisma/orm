import { assertDefined } from '@internal/utils/assertions';
import { structuredError } from '@internal/utils/structured-error';
import type { Connection } from 'mariadb';
import { positionalParams } from './positional-params';

/** The server status flag MySQL sets in every reply while the session's `sql_mode` includes `NO_BACKSLASH_ESCAPES`. */
const NO_BACKSLASH_ESCAPES = 1 << 9;

function backslashEscapesOff(params: number): Error {
  return structuredError(
    'RUNTIME.PARAM_PLACEHOLDER_MISMATCH',
    "MySQL's NO_BACKSLASH_ESCAPES mode is on for this connection, so the driver does not send a statement with values",
    {
      why: "In this mode MySQL ends a string at a backslash and a quote, where the mariadb package, which finds the statement's placeholders, reads an escaped quote, so a value could land outside its string literal and run as SQL. The driver turns the mode off on every new connection; a raw SET sql_mode turned it on.",
      fix: "Turn the mode off on this connection, with SET SESSION sql_mode = REPLACE(@@SESSION.sql_mode, 'NO_BACKSLASH_ESCAPES', ''), before running statements with values.",
      meta: { reason: 'no-backslash-escapes', params },
    },
  );
}

/**
 * The statement to hand to `connection`: `sql` with its placeholders written as `?` and the values in their order, for the package to write in. Refuses a statement with values while the server last reported `NO_BACKSLASH_ESCAPES` on, which only a raw `SET` can do. A statement without values still runs, so the mode can be turned off again; the driver's lexer still reads a backslash as an escape then, so at worst it refuses such a statement for a `?` it reads outside a string.
 */
export function statementFor(
  connection: Pick<Connection, 'info'>,
  sql: string,
  params: readonly unknown[],
): { readonly sql: string; readonly values: unknown[] } {
  const { info } = connection;
  assertDefined(info, 'the package gives every connection its info when it creates it');
  if (params.length > 0 && (info.status & NO_BACKSLASH_ESCAPES) !== 0) {
    throw backslashEscapesOff(params.length);
  }
  return positionalParams(sql, params);
}
