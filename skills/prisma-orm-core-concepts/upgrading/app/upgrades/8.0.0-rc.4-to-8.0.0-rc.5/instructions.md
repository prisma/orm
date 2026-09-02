---
from: "8.0.0-rc.4"
to: "8.0.0-rc.5"
changes:
  - id: attach-pg-client-error-listener
    summary: |
      Attach an 'error' listener to any pg `Client` or `Pool` your own code constructs outside the Prisma runtime. node-postgres emits 'error' on the pool or client when an idle connection drops (database restart, pooler timeout, network blip); with no listener Node treats it as an uncaught exception and kills the process. Starting at rc.5 every pool and client the Prisma runtime creates or receives — including a pool you pass via the `pg:` binding — gets a listener automatically, so this only applies to pg handles your code uses directly (health checks, side-channel observers, hand-rolled scripts).
    detection:
      glob: "**/*.{ts,tsx}"
      contains:
        - "new Client("
        - "new pg.Client("
        - "new Pool("
        - "new pg.Pool("
      anyMatch: true
  - id: contract-artifacts-restamp
    summary: |
      The emitted `contract.json` / `contract.d.ts` embed the toolchain version, which moves
      to 8.0.0-rc.5. Run `contract emit` once after upgrading so the emitted artifacts match
      the installed toolchain. The restamp is independent of the other changes in this
      release.
    detection:
      glob: "**/contract.json"
      contains:
        - '"version": "8.0.0-rc.4"'
---

# 8.0.0-rc.4 → 8.0.0-rc.5 — User upgrade instructions

## `attach-pg-client-error-listener`

Walk every file matched by `detection.glob`. For each `pg.Client` or `pg.Pool` your code constructs and uses directly (not one handed to `postgres({ pg: ... })` / `supabase({ pg: ... })` — the runtime covers those since rc.5), attach an `'error'` listener right after construction, before `connect()`:

```ts
const client = new pg.Client({ connectionString });
client.on('error', () => {});
await client.connect();
```

A no-op listener is enough: connect and query failures still reject their own promises, so nothing real is masked — the listener only stops a dropped idle connection from becoming an uncaught exception. If the handle is long-lived and you have a logging channel, log the error instead of discarding it.

Note that a surrounding `try/catch` does **not** cover this case — the `'error'` event is emitted on the client object asynchronously, outside any promise chain the `catch` can see.
