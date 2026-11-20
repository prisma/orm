import { trace, TracerProvider } from '@opentelemetry/api'
import {
  InstrumentationBase,
  InstrumentationConfig,
  InstrumentationNodeModuleDefinition,
} from '@opentelemetry/instrumentation'
import {
  clearGlobalTracingHelper,
  getGlobalTracingHelper,
  setGlobalTracingHelper,
} from '@prisma/instrumentation-contract'

import { ActiveTracingHelper } from './ActiveTracingHelper'
import { MODULE_NAME, NAME, VERSION } from './constants'

export interface PrismaInstrumentationConfig {
  ignoreSpanTypes?: (string | RegExp)[]
}

type Config = PrismaInstrumentationConfig & InstrumentationConfig

export class PrismaInstrumentation extends InstrumentationBase {
  private tracerProvider: TracerProvider | undefined

  constructor(config: Config = {}) {
    super(NAME, VERSION, config)
  }

  setTracerProvider(tracerProvider: TracerProvider): void {
    this.tracerProvider = tracerProvider
  }

  init() {
    const module = new InstrumentationNodeModuleDefinition(MODULE_NAME, [VERSION])

    return [module]
  }

  enable() {
    const config = this._config as Config

    setGlobalTracingHelper(
      new ActiveTracingHelper({
        tracerProvider: this.tracerProvider ?? trace.getTracerProvider(),
        ignoreSpanTypes: config.ignoreSpanTypes ?? [],
      }),
    )
  }

  disable() {
    clearGlobalTracingHelper()
  }

  isEnabled() {
    return getGlobalTracingHelper() !== undefined
  }
}
