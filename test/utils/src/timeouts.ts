const BASE_TIMEOUTS = {
  spinUpPpgDev: 30000,
  spinUpDbServer: 30000,
  spinUpMongoMemoryServer: 60000,
  typeScriptCompilation: 8000,
  coldTransformImport: 30000,
  databaseOperation: 5000,
  default: 100,
  /**
   * Vitest `testTimeout` / `hookTimeout` when a package uses mostly local I/O
   * but CI sets `TEST_TIMEOUT_MULTIPLIER` (e.g. 2): 100ms × multiplier is a
   * common false failure (Vitest reports 200ms). This baseline stays sub-second
   * locally while giving cold workers headroom.
   */
  vitestPackageDefault: 500,
} as const;

function getMultiplier(): number {
  return Number.parseFloat(process.env['TEST_TIMEOUT_MULTIPLIER'] || '1') || 1.0;
}

/**
 * Centralized test timeout values with environment variable support.
 * Provides semantic timeout values for different test scenarios.
 *
 * Uses a single TEST_TIMEOUT_MULTIPLIER environment variable to scale all timeouts.
 * The multiplier is read dynamically at access time, ensuring it works correctly
 * in CI environments where the environment variable is set at runtime.
 *
 * @example
 * ```typescript
 * import { spinUpPpgDev, typeScriptCompilation } from '@repo/test-utils';
 *
 * describe('my test', { timeout: timeouts.spinUpPpgDev }, () => {
 *   // ...
 * });
 *
 * beforeEach(async () => {
 *   // setup that needs ppg-dev
 * }, timeouts.spinUpPpgDev);
 *
 * it('compiles TypeScript', async () => {
 *   // test that runs tsc
 * }, timeouts.typeScriptCompilation);
 * ```
 *
 * @example
 * ```bash
 * # Double all timeouts (useful for CI)
 * TEST_TIMEOUT_MULTIPLIER=2 pnpm test
 *
 * # Use default timeouts (multiplier = 1)
 * pnpm test
 * ```
 */
export const timeouts = {
  /**
   * Timeout for tests that need to spin up ppg-dev (PostgreSQL dev server).
   * This includes database initialization, connection setup, and server startup.
   */
  get spinUpPpgDev(): number {
    return Math.round(BASE_TIMEOUTS.spinUpPpgDev * getMultiplier());
  },
  /**
   * Timeout for tests that spin up an in-memory database server (e.g. mongodb-memory-server).
   * Use this when the timeout is not specific to a particular database technology.
   */
  get spinUpDbServer(): number {
    return Math.round(BASE_TIMEOUTS.spinUpDbServer * getMultiplier());
  },
  /**
   * Timeout for mongodb-memory-server startup, which includes binary download,
   * extraction, and mongod replica set initialization. Must be large enough to
   * survive a cold-cache download on CI — if the beforeAll hook is killed early,
   * the partially-extracted binary corrupts the shared cache and every subsequent
   * mongo test in the CI run will SIGSEGV.
   *
   * Use this for `hookTimeout` and `testTimeout` in vitest configs of any package
   * that depends on `mongodb-memory-server`.
   */
  get spinUpMongoMemoryServer(): number {
    return Math.round(BASE_TIMEOUTS.spinUpMongoMemoryServer * getMultiplier());
  },
  /**
   * Timeout for tests that perform TypeScript compilation.
   * This includes running tsc to verify type checking and import resolution.
   */
  get typeScriptCompilation(): number {
    return Math.round(BASE_TIMEOUTS.typeScriptCompilation * getMultiplier());
  },

  /**
   * Timeout for hooks (typically `beforeAll`) that perform a dynamic
   * `import()` of a heavy module that is not statically imported by the
   * test file. The first call pays vitest's full transform cost for the
   * imported module graph, which can exceed the default 200ms hook
   * timeout on cold CI workers — so use this for the hook timeout when
   * a suite uses lazy `await import('…')` to avoid eager module side
   * effects (e.g. pulling Commander into every test file).
   */
  get coldTransformImport(): number {
    return Math.round(BASE_TIMEOUTS.coldTransformImport * getMultiplier());
  },

  /**
   * Timeout for database operations (queries, setup, teardown).
   * This includes table creation, data insertion, and cleanup.
   */
  get databaseOperation(): number {
    return Math.round(BASE_TIMEOUTS.databaseOperation * getMultiplier());
  },

  /**
   * A short wait inside a test: polling a condition, a connection attempt that
   * must give up quickly. Never a vitest `testTimeout` or `hookTimeout` — CI's
   * multiplier makes it 200ms, which fails healthy tests; `pnpm
   * lint:vitest-timeouts` rejects a config that budgets with it. Use
   * `vitestPackageDefault` there.
   */
  get default(): number {
    return Math.round(BASE_TIMEOUTS.default * getMultiplier());
  },

  get vitestPackageDefault(): number {
    return Math.round(BASE_TIMEOUTS.vitestPackageDefault * getMultiplier());
  },
} as const;
