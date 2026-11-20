import packageJson from '../package.json'
import type { PrismaInstrumentationGlobalValue, TracingHelper } from './types'

const majorVersion = packageJson.version.split('.')[0]

const GLOBAL_INSTRUMENTATION_KEY = 'PRISMA_INSTRUMENTATION'
const GLOBAL_VERSIONED_INSTRUMENTATION_KEY = `V${majorVersion}_PRISMA_INSTRUMENTATION` as const

type GlobalThisWithPrismaInstrumentation = typeof globalThis & {
  [GLOBAL_INSTRUMENTATION_KEY]?: PrismaInstrumentationGlobalValue
} & {
  [K in typeof GLOBAL_VERSIONED_INSTRUMENTATION_KEY]?: PrismaInstrumentationGlobalValue
}

const globalThisWithPrismaInstrumentation = globalThis as GlobalThisWithPrismaInstrumentation

/**
 * Returns the TracingHelper from the global instrumentation if available,
 * preferring the versioned global over the fallback global for compatibility.
 */
export function getGlobalTracingHelper(): TracingHelper | undefined {
  // Try versioned global first for major version isolation
  const versionedGlobal = globalThisWithPrismaInstrumentation[GLOBAL_VERSIONED_INSTRUMENTATION_KEY]

  if (versionedGlobal?.helper) {
    return versionedGlobal.helper
  }

  // Fall back to unversioned global for backwards compatibility
  // TODO(v8): Consider removing the fallback in future major versions
  const fallbackGlobal = globalThisWithPrismaInstrumentation[GLOBAL_INSTRUMENTATION_KEY]

  return fallbackGlobal?.helper
}

/**
 * Sets the global tracing helper. This is called by @prisma/instrumentation
 * when instrumentation is enabled.
 */
export function setGlobalTracingHelper(helper: TracingHelper): void {
  const globalValue: PrismaInstrumentationGlobalValue = { helper }

  // Set both versioned and unversioned globals for compatibility
  // TODO(v8): Consider only writing to the versioned global in future major versions
  globalThisWithPrismaInstrumentation[GLOBAL_VERSIONED_INSTRUMENTATION_KEY] = globalValue
  globalThisWithPrismaInstrumentation[GLOBAL_INSTRUMENTATION_KEY] = globalValue
}

/**
 * Clears the global tracing helper. This is called by @prisma/instrumentation
 * when instrumentation is disabled.
 */
export function clearGlobalTracingHelper(): void {
  delete globalThisWithPrismaInstrumentation[GLOBAL_VERSIONED_INSTRUMENTATION_KEY]
  delete globalThisWithPrismaInstrumentation[GLOBAL_INSTRUMENTATION_KEY]
}
