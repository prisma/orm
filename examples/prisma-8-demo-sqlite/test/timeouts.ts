const BASE_MS = 30_000;

function multiplier(): number {
  return Number.parseFloat(process.env['TEST_TIMEOUT_MULTIPLIER'] || '1') || 1;
}

/**
 * The test runs the `prisma` CLI once. CI scales the budget with `TEST_TIMEOUT_MULTIPLIER`, like the repository's own suites. The value is local because an application has no access to the repository's test helpers.
 */
export const sqliteCliTimeoutMs = Math.round(BASE_MS * multiplier());
