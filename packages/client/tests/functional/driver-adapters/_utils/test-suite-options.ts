import { Providers } from '../../_utils/providers'
import { MatrixOptions } from '../../_utils/types'

/**
 * Opt out from providers not specified in `driverAdaptersTestProviders` in `setupTestSuite`
 * (to avoid the error about missing providers in the test suite matrix).
 */
export const optOutFromProvidersWithNoMatchingDriverAdapters: MatrixOptions['optOut'] = {
  from: [Providers.COCKROACHDB, Providers.SQLSERVER, Providers.MONGODB],
  reason: 'no availability of a Driver Adapter with these providers yet',
}

/**
 * Default sensible options for driver adapters tests.
 */
export const defaultTestSuiteOptions: MatrixOptions = {
  skipDefaultClientInstance: true,
  optOut: optOutFromProvidersWithNoMatchingDriverAdapters,
  skip(when, { clientEngineExecutor }) {
    when(clientEngineExecutor === 'remote', "Can't use driver adapters with Acelerate.")
  },
}
