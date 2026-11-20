# @prisma/instrumentation-contract

This package provides the contract types and utilities for Prisma's instrumentation system. It defines the `TracingHelper` interface and provides functions to access the global tracing helper.

> **Note:** This is an internal package with no API stability guarantees primarily intended for Prisma's own packages. However, it may be useful for third-party observability vendors whose solutions are not built on OpenTelemetry and who want to integrate with Prisma's tracing system.

## Installation

```sh
npm install @prisma/instrumentation-contract
```

## Usage

### Accessing the Global Tracing Helper

If you're building an observability integration that needs to read tracing information from Prisma:

```ts
import { getGlobalTracingHelper } from '@prisma/instrumentation-contract'

const helper = getGlobalTracingHelper()

if (helper && helper.isEnabled()) {
  const traceParent = helper.getTraceParent()
  // Use traceParent for correlation
}
```

### Implementing a Custom Tracing Helper

If you're building a custom instrumentation solution (not based on OpenTelemetry), you can implement the `TracingHelper` interface and register it globally:

```ts
import { setGlobalTracingHelper, clearGlobalTracingHelper, type TracingHelper } from '@prisma/instrumentation-contract'

const myTracingHelper: TracingHelper = {
  isEnabled() {
    return true
  },

  getTraceParent(context) {
    // Return W3C Trace Context traceparent header
    return '00-traceId-spanId-01'
  },

  dispatchEngineSpans(spans, events, emitLogEvent) {
    // Handle emulated remote spans. In Prisma 7, this is only used for Accelerate spans.
    // Every event must be handed to `emitLogEvent`, ideally while the span it
    // belongs to is active, or the client drops logs the user asked for.
    for (const event of events) {
      emitLogEvent(event)
    }
  },

  getActiveContext() {
    // Return the active context, if any
    return undefined
  },

  runInChildSpan(nameOrOptions, callback) {
    // Execute callback within a child span
    return callback()
  },
}

// Register your tracing helper
setGlobalTracingHelper(myTracingHelper)

// Later, when shutting down
clearGlobalTracingHelper()
```

## API Reference

### Functions

#### `getGlobalTracingHelper(): TracingHelper | undefined`

Returns the currently registered global tracing helper, or `undefined` if none is set.

#### `setGlobalTracingHelper(helper: TracingHelper): void`

Registers a tracing helper globally. This is typically called by instrumentation packages when they are enabled.

#### `clearGlobalTracingHelper(): void`

Clears the global tracing helper. This is typically called when instrumentation is disabled.

### Types

#### `TracingHelper`

The main interface for tracing integration:

```ts
interface TracingHelper {
  isEnabled(): boolean
  getTraceParent(context?: Context): string
  dispatchEngineSpans(
    spans: EngineSpan[],
    events: EngineTraceEvent[],
    emitLogEvent: (event: EngineTraceEvent) => void,
  ): void
  getActiveContext(): Context | undefined
  runInChildSpan<R>(nameOrOptions: string | ExtendedSpanOptions, callback: SpanCallback<R>): R
}
```

See the TypeScript definitions for additional types like `EngineSpan`, `ExtendedSpanOptions`, and `SpanCallback`.

## For OpenTelemetry Users

If you're using OpenTelemetry, you should use [`@prisma/instrumentation`](https://www.npmjs.com/package/@prisma/instrumentation) instead. It provides a complete OpenTelemetry-based instrumentation that automatically registers the appropriate tracing helper.

```ts
import { PrismaInstrumentation, registerInstrumentations } from '@prisma/instrumentation'

registerInstrumentations({
  instrumentations: [new PrismaInstrumentation()],
})
```
