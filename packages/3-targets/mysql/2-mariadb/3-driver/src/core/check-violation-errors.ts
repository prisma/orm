/** MariaDB's error for a failed CHECK constraint, `ER_CONSTRAINT_FAILED`. MySQL uses 4025 for an unrelated error, and MariaDB does not use MySQL's 3819 for one. */
export const MARIADB_CHECK_VIOLATION_ERRORS: readonly number[] = [4025];
