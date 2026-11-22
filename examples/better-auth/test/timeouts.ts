const BASE_MS = 60_000;

function multiplier(): number {
  return Number.parseFloat(process.env['TEST_TIMEOUT_MULTIPLIER'] || '1') || 1;
}

/**
 * The tests run the `prisma` and `auth` command-line tools, which load the project's TypeScript first. CI scales the budget with `TEST_TIMEOUT_MULTIPLIER`, like the repository's own suites. The value is local because an application has no access to the repository's test helpers.
 */
export const cliTimeoutMs = Math.round(BASE_MS * multiplier());
