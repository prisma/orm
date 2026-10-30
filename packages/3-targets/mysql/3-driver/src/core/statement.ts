import { mysqlError } from '@internal/target-mysql/errors';
import { assertDefined } from '@internal/utils/assertions';
import type { Connection } from 'mariadb';
import { positionalParams } from './positional-params';
import { CLEAR_UNSUPPORTED_SQL_MODES, SET_UTF8MB4 } from './session-setup';

/** The server status flag MySQL sets in every reply while it reports `NO_BACKSLASH_ESCAPES` in the session's `sql_mode`. */
const NO_BACKSLASH_ESCAPES = 1 << 9;

function noBackslashEscapesRefusal(params: number): Error {
  return mysqlError(
    'RUNTIME.SQL_MODE_UNSUPPORTED',
    "MySQL reports NO_BACKSLASH_ESCAPES in this connection's sql_mode, which the MySQL target does not support, so the driver does not send a statement with values",
    {
      why: 'In this mode MySQL ends a string at a backslash and a quote, while the mariadb package, which writes the values into the statement, finds its placeholders as if the backslash escaped the quote, so a value could land outside its string literal and run as SQL. The driver removes the mode on every connection it opens, so a statement on this connection made MySQL report it: a raw SET sql_mode that set it, which stays until the connection closes or a statement clears it, or a stored procedure that set it inside itself, after which MySQL restores the mode the connection had, which may be off, but keeps reporting this one until a statement sets sql_mode again.',
      fix: `Do not set NO_BACKSLASH_ESCAPES on a connection Prisma uses, in raw SQL, a stored procedure or a trigger. A raw SET run outside a transaction stays on whichever pooled connection ran it; restart the client to close that connection. A statement that needs the mode must run in a transaction or on a connection you hold, which must set the mode back before it is released, with ${CLEAR_UNSUPPORTED_SQL_MODES}. A statement without values still runs.`,
      meta: { sqlMode: 'NO_BACKSLASH_ESCAPES', params },
    },
  );
}

/** The character set MySQL last reported for the statements the connection sends, as the package records it: utf8mb3 and utf8mb4 both as `utf8`, told apart by their longest character. */
function reportedCharacterSet(collation: unknown): string {
  if (
    typeof collation === 'object' &&
    collation !== null &&
    'charset' in collation &&
    'maxLength' in collation
  ) {
    return collation.charset === 'utf8'
      ? `utf8mb${String(collation.maxLength)}`
      : String(collation.charset);
  }
  return 'unknown';
}

function characterSetRefusal(characterSet: string, params: number): Error {
  return mysqlError(
    'RUNTIME.CHARACTER_SET_UNSUPPORTED',
    `The driver could not confirm that MySQL reads this connection's statements as utf8mb4: the character set the mariadb package last recorded for it is ${characterSet}. The MySQL target supports only utf8mb4, so the driver does not send a statement with values`,
    {
      why: "The mariadb package, which writes the values into the statement, encodes the statement in the character set it last recorded and finds its placeholders byte by byte. In a character set such as sjis, cp932, big5 or gbk, the second byte of some characters is a backslash, so the package can read the end of a string literal in the SQL differently from MySQL, and a value could run as SQL. The package records the character set from the server greeting and from MySQL's report of changed session variables. Two causes are known: a statement on this connection changed character_set_client, such as a raw SET NAMES; or the server does not report character_set_client in session_track_system_variables, so the package never saw the driver set utf8mb4 and still holds the default character set from the greeting.",
      fix: `If a statement changed the character set: do not change it on a connection Prisma uses. A raw SET run outside a transaction stays on whichever pooled connection ran it; restart the client to close that connection. A statement that needs another character set must run in a transaction or on a connection you hold, which must set it back before it is released, with ${SET_UTF8MB4}. If no statement changed it: add character_set_client back to the server's session_track_system_variables, as in MySQL's default, and restart the client. A statement without values still runs.`,
      meta: { characterSet, params },
    },
  );
}

/**
 * The statement to hand to `connection`: `sql` with its placeholders written as `?` and the values in their order, for the package to write in. A statement without values comes back as written with no values, so the package sends it without searching it for placeholders. Refuses a statement with values while the server last reported `NO_BACKSLASH_ESCAPES` on, or while the package's record of the character set is not utf8mb4, which a statement the application sends or a server that does not report `character_set_client` can cause. A statement without values still runs, so the setting can be put back; the driver's lexer still reads a backslash as an escape then, so at worst it refuses such a statement for a `?` it reads outside a string.
 */
export function statementFor(
  connection: Pick<Connection, 'info'>,
  sql: string,
  params: readonly unknown[],
): { readonly sql: string; readonly values: unknown[] | undefined } {
  const { info } = connection;
  assertDefined(info, 'the package gives every connection its info when it creates it');
  if (params.length > 0) {
    if ((info.status & NO_BACKSLASH_ESCAPES) !== 0) {
      throw noBackslashEscapesRefusal(params.length);
    }
    const characterSet = reportedCharacterSet(info.collation);
    if (characterSet !== 'utf8mb4') {
      throw characterSetRefusal(characterSet, params.length);
    }
  }
  const statement = positionalParams(sql, params);
  return params.length > 0 ? statement : { sql, values: undefined };
}
