# @prisma/sqlcommenter-trace-context

W3C Trace Context (`traceparent`) plugin for Prisma SQL commenter.

This plugin adds the `traceparent` header from the current trace context to SQL queries as comments, enabling correlation between distributed traces and database queries.

## Installation

```bash
npm install @prisma/sqlcommenter-trace-context
```

## Usage

```ts
import { traceContext } from '@prisma/sqlcommenter-trace-context'

import { PrismaClient } from './generated/prisma/client'

const prisma = new PrismaClient({
  adapter: myDriverAdapter,
  comments: [traceContext()],
})
```

When tracing is enabled and the current span is sampled, queries will include a `traceparent` comment:

```sql
SELECT * FROM users /*traceparent='00-0af7651916cd43dd8448eb211c80319c-b9c7c989f97918e1-01'*/
```

## How it works

The `traceContext()` plugin:

1. Checks if tracing is enabled via `@prisma/instrumentation`
2. Retrieves the current trace context's `traceparent` header
3. Only includes the `traceparent` in the SQL comment if the sampled flag is set (the trace flags end with `01`)

This means:

- **No traceparent** is added when tracing is not configured
- **No traceparent** is added when the current trace is not sampled (e.g., with ratio-based sampling set to 0%)
- **traceparent is added** only when tracing is active and the span is sampled

## Requirements

- Requires `@prisma/instrumentation` to be configured and enabled for tracing
- Works with Prisma Client using driver adapters

## W3C Trace Context

The `traceparent` header follows the [W3C Trace Context](https://www.w3.org/TR/trace-context/) specification:

```
{version}-{trace-id}-{parent-id}-{trace-flags}
```

Where:

- `version`: Always `00` for the current spec
- `trace-id`: 32 hexadecimal characters representing the trace ID
- `parent-id`: 16 hexadecimal characters representing the parent span ID
- `trace-flags`: 2 hexadecimal characters; `01` indicates sampled

## License

Apache-2.0
