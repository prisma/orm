/** Whether the tests run in CI, where every live-test server the job configures must be present. */
export const inCi = process.env['CI'] !== undefined;
