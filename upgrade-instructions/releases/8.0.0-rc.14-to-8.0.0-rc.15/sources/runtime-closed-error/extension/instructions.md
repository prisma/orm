---
changes:
  - id: sql-runtime-close-refusal-option
    summary: "The options of SqlRuntimeBase and its subclasses (RuntimeOptions, for example new PostgresRuntimeImpl({ ... })) have a new optional key closeRefusal: 'when-idle' | 'at-once'. Pass 'at-once' for a runtime that many callers share; leaving it out means 'when-idle', which suits a runtime that one request owns."
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - 'new \w*RuntimeImpl\('
        - 'RuntimeOptions'
---

## `sql-runtime-close-refusal-option`

`close()` on a SQL runtime waits for the work already in flight and refuses runtime-scope work that starts later with `DRIVER.NOT_CONNECTED` ("Runtime is closed"). The new `closeRefusal` option says when the refusal begins: `'at-once'` refuses from the call of `close()`, and `'when-idle'` refuses once the runtime has been idle for one turn of the event loop, so work that keeps it busy from the close onward is admitted.

The key is optional, so existing code compiles unchanged. In each place that constructs a runtime class that extends `SqlRuntimeBase`, or builds a `RuntimeOptions` object for one, decide whether to add it:

1. If the runtime belongs to a client or service that many callers share, such as a pooled client, pass `closeRefusal: 'at-once'`.
2. If the runtime belongs to one request or one scope, such as a per-request connection, leave the key out or pass `closeRefusal: 'when-idle'`.
