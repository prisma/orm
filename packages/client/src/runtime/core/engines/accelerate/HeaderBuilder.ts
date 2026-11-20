import type { QueryEngineLogLevel } from '@prisma/client-common'
import { enginesVersion } from '@prisma/engines-version'
import type { TracingHelper } from '@prisma/instrumentation-contract'

export type AccelerateHeaders = {
  'Content-Type': string
  'Prisma-Engine-Hash': string
  'Prisma-Engine-Version': string
  'X-Capture-Telemetry'?: string
  'X-Transaction-Id'?: string
  Accept: string
  Authorization: string
  traceparent?: string
}

type HeaderBuilderOptions = {
  traceparent?: string
  transactionId?: string
}

export class HeaderBuilder {
  readonly apiKey: string
  readonly tracingHelper: TracingHelper
  readonly logLevel: QueryEngineLogLevel
  readonly logQueries: boolean | undefined
  readonly engineHash: string

  constructor({
    apiKey,
    tracingHelper,
    logLevel,
    logQueries,
    engineHash,
  }: {
    apiKey: string
    tracingHelper: TracingHelper
    logLevel: QueryEngineLogLevel
    logQueries: boolean | undefined
    engineHash: string
  }) {
    this.apiKey = apiKey
    this.tracingHelper = tracingHelper
    this.logLevel = logLevel
    this.logQueries = logQueries
    this.engineHash = engineHash
  }

  build({ traceparent, transactionId }: HeaderBuilderOptions = {}): AccelerateHeaders {
    const headers: AccelerateHeaders = {
      Accept: 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'Prisma-Engine-Hash': this.engineHash,
      'Prisma-Engine-Version': enginesVersion,
    }

    if (this.tracingHelper.isEnabled()) {
      headers.traceparent = traceparent ?? this.tracingHelper.getTraceParent()
    }

    if (transactionId) {
      headers['X-Transaction-Id'] = transactionId
    }

    const captureTelemetry = this.#buildCaptureSettings()

    if (captureTelemetry.length > 0) {
      headers['X-Capture-Telemetry'] = captureTelemetry.join(', ')
    }

    return headers
  }

  #buildCaptureSettings(): string[] {
    const captureTelemetry: string[] = []

    if (this.tracingHelper.isEnabled()) {
      captureTelemetry.push('tracing')
    }

    if (this.logLevel) {
      captureTelemetry.push(this.logLevel)
    }

    if (this.logQueries) {
      captureTelemetry.push('query')
    }

    return captureTelemetry
  }
}
