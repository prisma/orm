# Slice: `orm init` writes a config the PostgreSQL package accepts

Part of slice 1 of [plan.md](plan.md) ("`orm init` writes the version"), split out because it needs a framework change the operator approved on 2026-11-26. This brief is our best effort: if the code shows part of it is wrong, say so with the evidence.

## Outcome

A project created by `prisma orm init` for PostgreSQL loads: its config states `databaseVersion`, for a Prisma schema contract, a TypeScript contract, and a project that keeps its Prisma 7 schema. The CLI learns nothing about any database's options to do this.

## Design (approved)

- **One new optional member on the init contribution,** `contractEntry(input)`. It returns the config's `contract:` entry as data: `{ value: <JSON> }`, or `{ call: { module, export, args } }` with JSON arguments. An earlier version returned source text with its imports; the Prisma 7 check, which builds the contract source before anything is written, cannot run text, so the operator approved data on 2026-11-26.
- **The CLI checks the entry's shape and never its class.** The decision record on `init` says a package's `init` entrypoint may import framework types but no framework code that runs, because the CLI that loads it can be a different installed copy of the framework.
- **The CLI's two config templates become one,** which writes `contract: <entry>` and builds its import block with `renderImports`. The Prisma 7 check runs the same entry. A contribution without the member gets today's config: the path, or `prisma7Schema(<path>)`.
- **PostgreSQL writes the newest version in its table** (18 today). `init` cannot write the server's real version: `--probe-db` is optional and runs after the files are written. All four versions give the same contract today, and a user on an older server later gets the refusal that names the version to state. A TypeScript contract states the version in its starter contract.

## Not in this slice

- Writing the version that `--probe-db` reads.
- The advice the CLI adds after a refused database.

## Tests

- The CLI's `init` tests for a project that keeps its Prisma 7 schema pass.
- New: the config `init` writes for a fresh PostgreSQL project (both authoring modes) and for the Prisma 7 path is accepted by the PostgreSQL package's `defineConfig`. The existing tests never loaded it, which is why the fresh-project case did not fail.
- Template tests: no member gives the default; the expression's imports merge with the CLI's into one block; a malformed returned value is refused.

## Validation gate

The test files touched and those covering the changed code, typecheck and lint for the changed packages, `pnpm lint:deps`, and `pnpm api:check` if a public type changes. No whole suites.

## Records

The decision record on `init` is updated in place (orchestrator), and the CLI subsystem doc where it describes the contribution.
