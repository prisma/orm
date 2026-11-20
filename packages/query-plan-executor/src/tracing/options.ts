import { SpanOptions } from '@opentelemetry/api'

export type ExtendedSpanOptions = SpanOptions & {
  name: string
}

export function normalizeSpanOptions(nameOrOptions: string | ExtendedSpanOptions): ExtendedSpanOptions {
  if (typeof nameOrOptions === 'string') {
    return { name: nameOrOptions }
  }
  return nameOrOptions
}
