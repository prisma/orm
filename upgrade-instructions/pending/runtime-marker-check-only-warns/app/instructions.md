---
changes:
  - id: runtime-marker-check-only-warns
    summary: |
      On its first use of the database, the runtime compares the contract with the database's marker. When the marker cannot be read, or its row cannot be decoded, that first call no longer rejects with `CONTRACT.MARKER_READ_FAILED` or `CONTRACT.MARKER_ROW_CORRUPT`. The runtime passes one warning with that code to the `log` option and runs the query. A failed check is not tried again on later calls. When the database cannot be reached at all, the query rejects with the driver's own error. Code that caught either code from a query, for example a startup check, no longer sees it there: run `prisma db verify` in the deploy, or read the warnings that `log` receives.
    detection:
      glob: "**/*.{ts,tsx,mts,cts,js,mjs,cjs}"
      matches:
        - 'CONTRACT\.MARKER_READ_FAILED'
        - 'CONTRACT\.MARKER_ROW_CORRUPT'
---

# The runtime's marker check only warns

## `runtime-marker-check-only-warns`

On its first use of the database, the runtime reads the database's marker and compares it with the contract. A mismatch and a missing marker already only warned. Two more cases now only warn:

- the marker cannot be read, logged as `CONTRACT.MARKER_READ_FAILED`;
- the marker row cannot be decoded, logged as `CONTRACT.MARKER_ROW_CORRUPT`.

In both cases the query runs. Before, the call rejected with that code, and every later call read the marker again and rejected again until a read succeeded.

Most applications need no change. Search for the two codes in the application's code. If the application catches one of them from a query, that branch no longer runs. Decide what it was for:

- To stop a deploy when the database does not match the contract, run `prisma db verify` in the deploy. It still exits with an error for every one of these cases.
- To report the problem, pass `log` to the client and read the warnings there:

```ts
const db = postgres({
  contract,
  url,
  log: {
    ...console,
    warn: (entry) => report(entry),
  },
});
```

When the database cannot be reached, the first query now rejects with the driver's own error, such as a connection refusal, where before it rejected with `CONTRACT.MARKER_READ_FAILED`. Code that matched on the marker code to detect an unreachable database matches on the driver's error instead.
