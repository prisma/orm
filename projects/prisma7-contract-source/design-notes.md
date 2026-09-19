# Design notes — prisma7-contract-source

## Principles

- Prisma 7 stays the source of truth for the database until cutover. Prisma 8 adopts the database read-only during the transition.
- A construct is either expressible in the contract or a hard error. No warnings, no silent behaviour changes.
- The Prisma 7 dialect is frozen. Nothing is added to it.
- Fidelity is defined by what `db verify` compares, not by what the PSL can spell.

## The model

A contract source is a `ContractConfig` whose `source.load` returns a family contract or diagnostics. The emit path calls it without caring about format. The Prisma 7 source parses `schema.prisma` with the Prisma 8 syntax parser, which already reads the Prisma 7 grammar almost completely, and interprets it with Prisma 7's rules straight into the family contract. The converter reuses the loaded contract and prints it as Prisma 8 PSL through a new contract-to-PSL printer.

## Alternatives considered

- **One-shot converter that prints Prisma 8 PSL, using Prisma 7's parser.** This was the original spec. Rejected as the primary shape because the converted file drifts after every Prisma 7 migration, because every Prisma 8 PSL spelling limit becomes a lossy rule, and because `@prisma/prisma7` exposes no parser. The converter survives as the cutover step on top of the interpreter.
- **Prisma 7's WebAssembly parser via `@prisma/get-dmmf`.** Rejected. Its DMMF output deletes `@ignore` fields and `@@ignore` models, lists views as ordinary models, and may omit implicit referential actions. It is also a 3 MB synchronous CommonJS load on the emit path.
- **Port Prisma 7's parser to TypeScript.** Unnecessary. The Prisma 8 parser handles the grammar with two small additions (attributes on enum members, field lines in `view` blocks).
- **`contract infer` plus hand fixes.** The status quo. Loses relation field names, ORM-side defaults, `@updatedAt`, and needs re-doing after every migration.
- **Filling the capability gaps in this project** (views, Mongo defaults, Mongo scalar types, opaque Postgres columns). Rejected: hard error now, fill later. Mongo defaults alone is a runtime change touching the contract validator, the generator registry, and the ORM.

## Decisions settled in shaping

- `cuid()` maps to the cuid2 generator. Prisma 7's `cuid()` is cuid v1, which Prisma 8 does not ship; the column type is identical and ids are opaque.
- `@updatedAt` becomes on-create and on-update generators with column `timestamp(3)`. It is a hard error on an optional field and a hard error together with `@default`; see the decision below.
- Implicit many-to-many relations become the junction model Prisma 7 creates, with a `(A, B)` primary key. Databases last migrated on Prisma 5 or earlier have a unique index instead (Prisma 6.0.0 made the change) and must migrate on Prisma 7 first.
- Constraint names are set only where `db verify` compares them: indexes and check constraints.
- `defineConfig` accepts a `ContractConfig` for `contract`, and `prisma7Schema(path)` returns one. Detection by file content was rejected as magic.

## Unspellable shapes are hard errors, not relaxed checks

The contract accepts execution generators on a nullable column and alongside a storage default, and `db verify` is satisfied by either. Prisma 8 PSL cannot spell them: a preset field may not be optional, and a preset may not combine with `@default`. The Prisma 7 source therefore rejects both, with `PSL.PRISMA7_OPTIONAL_GENERATED_FIELD_UNSUPPORTED` and `PSL.PRISMA7_UPDATED_AT_WITH_DEFAULT_UNSUPPORTED`.

The rule behind that: **Prisma 8 does not compromise its parser or its interpreter for a feature it has not built. A construct the language cannot express is a signal to build the feature.** The feature here is first-class authoring for an optional generated timestamp, and for a storage default combined with an update generator, each designed on its own terms rather than admitted by a loosened check. Until that exists, the hard errors stand. [ADR 252](<../../docs/architecture docs/adrs/ADR 252 - An earlier Prisma version's schema is a contract source.md>) records the rule.

## The public upgrade guide (read 2026-09-14)

[Prisma ORM 7 to 8 (PostgreSQL)](https://www.prisma.io/docs/guides/upgrade-prisma-orm/postgresql) documents the side-by-side story this project serves. Prisma 7 becomes the `@prisma/prisma7` dev dependency with a `prisma7` binary and a `prisma7.config.ts` (`defineConfig` from `@prisma/prisma7/config`); Prisma 8 is the `prisma` package with the `prisma` binary and a `prisma.config.ts` (`definePrismaConfig` from `prisma/config` wrapping `@prisma/orm-postgres/config`). There is no binary collision; the `parallel-install.md` project note that assumes `prisma-next` is stale. The guide's phase 2 today is `contract infer` followed by two hand edits (delete the `PrismaMigrations` model, add `@@map` to every model); the Prisma 7 source replaces that step. Its phase 4 cutover is `migration plan --name baseline`, `db sign`, `migration ref set db <timestamp>_baseline`; slice 3's converter must fit that routine, and its docs should describe cutover in those terms. The [MongoDB guide](https://www.prisma.io/docs/guides/upgrade-prisma-orm/mongodb) is a Prisma 6 to 8 port with no side-by-side phase, which slice 2 must take into account.

## References

- `spec.md`, `slices/*/spec.md`.
- The public upgrade guides above are the transition story this project serves. `projects/prisma-8-rc1/parallel-install.md` predates them and assumes `prisma-next`; do not read it as current.
