import { isCI as ciInfoIsCI } from 'ci-info';

/**
 * Whether `process.env` is a CI environment by `ci-info`'s rules. Telemetry reads this. Command
 * handlers read the CLI engine's `ctx.isCI` instead, which applies the same rules to the
 * environment the engine was given, so a test can set it.
 */
export function isCI(): boolean {
  return ciInfoIsCI;
}
