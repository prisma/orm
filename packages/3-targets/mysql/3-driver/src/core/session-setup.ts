/**
 * Removes the `sql_mode` entries the MySQL target does not support, `NO_BACKSLASH_ESCAPES` and `ANSI_QUOTES`, and the combination mode `ANSI`, which MySQL lists beside its parts and which would set `ANSI_QUOTES` again; no other combination mode includes either. It adds `NO_AUTO_VALUE_ON_ZERO`, so an explicit 0 in an auto-increment column is stored as 0, as Postgres stores it, rather than replaced with a generated value. Leaves no empty entry between two commas.
 */
export const SET_SQL_MODE =
  "SET SESSION sql_mode = TRIM(LEADING ',' FROM CONCAT(REPLACE(REPLACE(REPLACE(REPLACE(CONCAT(',', @@SESSION.sql_mode, ','), ',NO_BACKSLASH_ESCAPES,', ','), ',ANSI_QUOTES,', ','), ',ANSI,', ','), ',NO_AUTO_VALUE_ON_ZERO,', ','), 'NO_AUTO_VALUE_ON_ZERO'))";

/** Makes MySQL read each statement, and the package write it, as utf8mb4. */
export const SET_UTF8MB4 = 'SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci';

/**
 * The statements every new connection runs once, before any other. The lexer that finds placeholders reads a backslash as an escape and `"…"` as a string, so the session clears NO_BACKSLASH_ESCAPES and ANSI_QUOTES and MySQL reads quoted text the same way, and sets NO_AUTO_VALUE_ON_ZERO; and it reads each statement as utf8mb4. These hold no value, so they run through the package's `initSql`; the target's session settings, which do, are set afterwards.
 */
export const SESSION_SETUP = [SET_SQL_MODE, SET_UTF8MB4] as const;
