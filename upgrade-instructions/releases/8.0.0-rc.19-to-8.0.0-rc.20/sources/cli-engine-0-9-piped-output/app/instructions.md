---
changes:
  - id: engine-pin-moves-to-0-9-0
    summary: |
      The toolchain now requires `@prisma/cli-engine@0.9.0` (up from 0.7.0). A project that depends on `@prisma/cli-engine` itself must move to `0.9.0`.
    detection:
      glob: "**/package.json"
      matches:
        - '"@prisma/cli-engine":\s*"[^"]*(?<![\d.])0\.[0-8](?!\d)'
  - id: piped-output-needs-json
    summary: |
      A piped Prisma ORM command no longer prints JSON. Without `--json`, stdout receives the command's plain data lines, such as one tab-separated line per migration. A script that reads JSON from `prisma contract …`, `prisma db …`, `prisma migration …` or `prisma orm init` must pass `--json`.
---

## `engine-pin-moves-to-0-9-0`

For every `package.json` matched by `detection`, change the `@prisma/cli-engine` version (`0.7.0`, `^0.7.0` or any other 0.x below 0.9) to `0.9.0` and reinstall. Projects assembled by the `prisma` CLI resolve the engine automatically.

## `piped-output-needs-json`

Engine 0.9.0 chooses the output format from flags only. Before, a command whose stdout was not a terminal (a pipe, a file, `$(…)`, a CI log or an agent) printed JSON frames. Now it prints the human card on stderr and the command's data lines on stdout. JSON needs `--json`.

Find every place that runs a Prisma ORM command and parses its stdout as JSON: `package.json` scripts and shell scripts that pipe into `jq`, CI steps, and code that spawns `prisma` and calls `JSON.parse` on its output. Add `--json` to each such command. For example, `prisma migration status | jq '.envelope.result'` becomes `prisma migration status --json | jq '.envelope.result'`.

A script that only needs a list or a value can read the data lines instead. Fields are separated by a tab and come in the order below. A field whose JSON value is null or absent is an empty field. A backslash, tab, newline or carriage return inside a value is written as `\\`, `\t`, `\n` or `\r`. Paths are relative to the working directory. New fields are only ever added at the end of a line.

- `migration list`: space, name, from, to and operation count, one line per migration.
- `migration status`: space, name, from, to, operation count and status (`applied`, `pending`, or empty when the JSON status is null), one line per migration.
- `migration log`: applied at, space, name, from, to and operation count, one line per applied migration.
- `migration graph`: space, name, from and to, one line per migration; with `--dot`, the DOT text.
- `migration show`: `key<TAB>value` lines, then one `operation` line per operation.
- `migration check`: space, code and where (the path the failure is about), one line per failure.
- `migration new` and `migration plan`: the directories written.
- `migration ref list`: name, hash and comma-separated invariants, one line per ref. `migration ref set`: the hash the ref points at.
- `db migrate`: space, name, from, to and operations run, one line per applied migration; with `--show`, space, name, from and to per migration that will run.
- `db sign`: space, status and contract storage hash, one line per space.
- `orm init`: the paths of the files written.
- `contract emit`: the paths of `contract.json` and `contract.d.ts`. `contract infer`: the path written. `contract format`: the paths formatted. `contract print`: the PSL.

`db init`, `db update`, `db verify`, `db schema` and `migration ref delete` print nothing on stdout; their exit code is the result, and `--json` carries the document. An error in a pipe is now human text on stderr, with the same exit code.
