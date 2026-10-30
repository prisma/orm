/** Removes the `sql_mode` entries the MySQL target does not support, `NO_BACKSLASH_ESCAPES` and `ANSI_QUOTES`, leaving no empty entry between two commas. */
export const CLEAR_UNSUPPORTED_SQL_MODES =
  "SET SESSION sql_mode = TRIM(BOTH ',' FROM REPLACE(REPLACE(CONCAT(',', @@SESSION.sql_mode, ','), ',NO_BACKSLASH_ESCAPES,', ','), ',ANSI_QUOTES,', ','))";

/** Makes MySQL read each statement, and the package write it, as utf8mb4. */
export const SET_UTF8MB4 = 'SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci';

/**
 * The statements every new connection runs once, before any other. The lexer that finds placeholders reads a backslash as an escape and `"…"` as a string, so the session clears NO_BACKSLASH_ESCAPES and ANSI_QUOTES and MySQL reads quoted text the same way; and it reads each statement as utf8mb4. These hold no value, so they run through the package's `initSql`; the target's session settings, which do, are set afterwards.
 */
export const SESSION_SETUP = [CLEAR_UNSUPPORTED_SQL_MODES, SET_UTF8MB4] as const;
