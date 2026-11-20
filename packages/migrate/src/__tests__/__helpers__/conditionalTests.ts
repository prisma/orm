import { Provider } from '@prisma/driver-adapter-utils'

// We have some tests for providers that are not supported by driver adapters yet.
// TODO: D1 is also a special case as its tests have to be transformed to driver adapter tests.
export type SupportedProviders = Provider | 'mongodb' | 'cockroachdb' | 'sqlserver' | 'd1'

export type Matrix = {
  providers: {
    [K in SupportedProviders]?: boolean
  }
}

export const allProviders = {
  mysql: true,
  postgres: true,
  sqlite: true,
  mongodb: true,
  cockroachdb: true,
  sqlserver: true,
  d1: true,
} satisfies Record<SupportedProviders, true>

export const sqliteOnly = {
  providers: { sqlite: true },
} satisfies Matrix

export const postgresOnly = {
  providers: { postgres: true },
} satisfies Matrix

export const noDriverAdapters = {
  providers: allProviders,
} satisfies Matrix

export const cockroachdbOnly = {
  providers: { cockroachdb: true },
} satisfies Matrix

export const sqlServerOnly = {
  providers: { sqlserver: true },
} satisfies Matrix

export const mongodbOnly = {
  providers: { mongodb: true },
} satisfies Matrix

export const mysqlOnly = {
  providers: { mysql: true },
} satisfies Matrix

/**
 * Drop in replacement for `describe` that executes only if the given matrix condition is true.
 * This was initially introduced to exclude tests from for specific driver adapters.
 * Tests for the legacy schema engine run against all providers at once by default except if
 * certain `TEST_SKIP_` env vars are set.
 *
 * There are various shorthands for the matrix:
 * - `sqliteOnly`
 * - `postgresOnly`
 * - `noDriverAdapters`
 * - `cockroachdbOnly`
 * - `sqlServerOnly`
 * - `mongodbOnly`
 *
 * More fine granular can be specified per use-case:
 *
 * Examples:
 * ```ts
 * describeMatrix(
 *   { providers: allProviders },
 *   'test will run with all providers',
 *   () => {...},
 * )
 *
 * describeMatrix(
 *   { providers: { ...allProviders, cockroachdb: false } },
 *   'test will run with all providers except cockroachdb',
 *   () => {...},
 * )
 *
 * describeMatrix(
 *   { providers: { cockroachdb: true } },
 *   'test will run only with cockroachdb',
 *   () => {...},
 * )
 * ```
 */
export function describeMatrix(matrix: Matrix, name: string, fn: jest.EmptyFunction) {
  // Skip tests for certain providers based on test skip env vars (e.g. used during win & mac CI tests)
  if (matrix.providers.cockroachdb && process.env.TEST_SKIP_COCKROACHDB) return skip(name)
  if (matrix.providers.sqlserver && process.env.TEST_SKIP_MSSQL) return skip(name)
  if (matrix.providers.mongodb && process.env.TEST_SKIP_MONGODB) return skip(name)

  // eslint-disable-next-line jest/valid-describe-callback
  describe(name, fn)
}

// Jest does not allow test files without a single describe+it statement.
// => We work around this by adding a dummy describe+it statement.
function skip(name: string) {
  describe(' SKIPPED - ' + name, () => {
    it('is skipped due to test matrix setup', () => {
      expect(true).toBe(true)
    })
  })
}
