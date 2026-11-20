import { Tracer } from '@opentelemetry/api'
import { BasicTracerProvider, IdGenerator, TracerConfig } from '@opentelemetry/sdk-trace-base'

/**
 * Creates a new {@link IdGenerator} that generates predictable sequential
 * identifiers for tests.
 */
export function newIdGenerator(): IdGenerator {
  const generator = (length: number) => {
    let value = 1
    return () => (value++).toString(16).padStart(length, '0')
  }

  return {
    generateSpanId: generator(16),
    generateTraceId: generator(32),
  }
}

/**
 * A {@link BasicTracerProvider} that can be used with `using` statements to
 * automatically shutdown.
 */
export class DisposableTracerProvider extends BasicTracerProvider {
  [Symbol.asyncDispose]() {
    return this.shutdown()
  }
}

/**
 * Creates a `TracerProvider` suitable for use in tests that need to store the
 * trace and span IDs in snapshots.
 */
export function getTestTracerProvider({
  idGenerator = newIdGenerator(),
  ...config
}: TracerConfig = {}): DisposableTracerProvider {
  return new DisposableTracerProvider({
    idGenerator,
    ...config,
  })
}

/**
 * Creates a {@link Tracer} suitable for use in tests that need to store the
 * trace and span IDs in snapshots.
 */
export function getTestTracer(tracerProvider = getTestTracerProvider()): Tracer {
  return tracerProvider.getTracer('test')
}
