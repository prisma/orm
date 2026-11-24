/**
 * This package is built to leave the repository, so it cannot use the repository's shared timeouts helper. These constants apply `TEST_TIMEOUT_MULTIPLIER` the same way.
 */
function multiplier(): number {
  return Number.parseFloat(process.env['TEST_TIMEOUT_MULTIPLIER'] || '1') || 1;
}

function scaled(baseMs: number): number {
  return Math.round(baseMs * multiplier());
}

export const timeouts = {
  test: scaled(30_000),
  hook: scaled(60_000),
  devServerStart: scaled(60_000),
  devServerClose: scaled(10_000),
};
