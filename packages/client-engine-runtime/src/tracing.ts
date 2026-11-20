import { type Context, type Span, SpanKind, type SpanOptions } from '@opentelemetry/api'
import type { SqlQuery } from '@prisma/driver-adapter-utils'

import { QueryEvent } from './events'
import type { SchemaProvider } from './schema'
import { assertNever, DeepReadonly } from './utils'

export type SpanCallback<R> = (span?: Span, context?: Context) => R

export type ExtendedSpanOptions = SpanOptions & {
  name: string
}

// A smaller version of the equivalent interface from `@prisma/internals`
export interface TracingHelper {
  isEnabled(): boolean
  runInChildSpan<R>(nameOrOptions: string | ExtendedSpanOptions, callback: SpanCallback<R>): R
}

export const noopTracingHelper: TracingHelper = {
  isEnabled() {
    return false
  },
  runInChildSpan(_, callback) {
    return callback()
  },
}

export function providerToOtelSystem(provider: SchemaProvider): string {
  switch (provider) {
    case 'postgresql':
    case 'postgres':
    case 'prisma+postgres':
      return 'postgresql'
    case 'sqlserver':
      return 'mssql'
    case 'mysql':
    case 'sqlite':
    case 'cockroachdb':
    case 'mongodb':
      return provider
    default:
      assertNever(provider, `Unknown provider: ${provider}`)
  }
}

export async function withQuerySpanAndEvent<T>({
  query,
  tracingHelper,
  provider,
  onQuery,
  execute,
}: {
  query: DeepReadonly<SqlQuery>
  tracingHelper: TracingHelper
  provider: SchemaProvider
  onQuery?: (event: QueryEvent) => void
  execute: () => Promise<T>
}): Promise<T> {
  const callback =
    onQuery === undefined
      ? execute
      : async () => {
          const timestamp = new Date()
          const startInstant = performance.now()
          const result = await execute()
          const endInstant = performance.now()

          onQuery({
            timestamp,
            duration: endInstant - startInstant,
            query: query.sql,
            params: query.args,
          })

          return result
        }

  if (!tracingHelper.isEnabled()) {
    return callback()
  }

  return await tracingHelper.runInChildSpan(
    {
      name: 'db_query',
      kind: SpanKind.CLIENT,
      attributes: {
        'db.query.text': query.sql,
        'db.system.name': providerToOtelSystem(provider),
      },
    },
    callback,
  )
}
