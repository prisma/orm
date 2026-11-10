---
changes:
  - id: engine-pin-moves-to-0-9-0
    summary: |
      The toolchain now peers `@prisma/cli-engine@0.9.0` (up from 0.7.0). An extension package that depends on `@prisma/cli-engine` for its tests or tooling must move to `0.9.0`.
    detection:
      glob: "**/package.json"
      matches:
        - '"@prisma/cli-engine":\s*"[^"]*(?<![\d.])0\.[0-8](?!\d)'
  - id: piped-output-needs-json
    summary: |
      A piped Prisma ORM command no longer prints JSON. A test that runs the CLI with a non-terminal stdout and parses JSON frames from it must pass `--json`.
---

## `engine-pin-moves-to-0-9-0`

For every `package.json` matched by `detection`, change the `@prisma/cli-engine` version (`0.7.0`, `^0.7.0` or any other 0.x below 0.9) to `0.9.0` and reinstall.

## `piped-output-needs-json`

Engine 0.9.0 chooses the output format from flags only. Before, a run whose stdout was not a terminal printed JSON frames; now it prints the human card on stderr and the command's data lines on stdout. The engine's test harness from `@prisma/cli-engine/testing` treats stdout as a pipe unless `isTty.stdout` is set, so it is affected the same way.

Find the tests and tooling that run a Prisma ORM command, through a spawned `prisma` process or `createTestCli`, and read JSON from its output: they parse the `result` frame of its stdout, read `json` from the harness run, or read `presented.presentation.json`. Add `--json` to the argv of each such run. A run in human format still returns the command's document as `presented.data`, so a test that reads only that needs no change.
