/**
 * The statements every new connection runs once, before any other. The lexer that finds placeholders reads a backslash as an escape and `"…"` as a string, so the session clears NO_BACKSLASH_ESCAPES and ANSI_QUOTES and MySQL reads quoted text the same way; and it reads each statement as utf8mb4. These hold no value, so they run as text through the package's `initSql`; the target's session settings, which do, are set afterwards with a prepared statement.
 */
export const SESSION_SETUP = [
  "SET SESSION sql_mode = TRIM(BOTH ',' FROM REPLACE(REPLACE(CONCAT(',', @@SESSION.sql_mode, ','), ',NO_BACKSLASH_ESCAPES,', ','), ',ANSI_QUOTES,', ','))",
  'SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci',
] as const;
