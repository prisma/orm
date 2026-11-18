# Slice 6b-1 plan — per-relation includes

**Design:** [`include-loading-design.md`](./include-loading-design.md). **Spec:** [`spec.md`](./spec.md). One pull request. One implementer (Opus) carries every dispatch; reviewers run on Fable (Will, 2026-11-14).

| # | Dispatch | Outcome | Builds on | Done when |
| --- | --- | --- | --- | --- |
| 1 | Rename and capabilities | `mutation-graph/` is `statement-graph/` (its own commit). Adapters report the capabilities of design section 1. `selectIncludeStrategy` exists and is tested. Fixtures regenerated. Nothing chooses `'query'` yet. | — | Build, typecheck and the touched packages' tests pass; `pnpm fixtures:check` passes |
| 2 | Reads, simple forms | A read with a to-many or to-one include runs as a graph under `'query'`: the tie parameter in the include builder, `FindRelated`, `NestJoin` with its whole-row edge, `stitchKey`, the shared chunk helper, the per-relation row consumer, the transaction rule, the identity fix. The test helper that picks the adapter by strategy exists. | 1 | The basic include integration suites pass under both strategies on Postgres, and assert per-relation statements under `'query'` |
| 3 | Reads, every form | `limit`/`offset`, `distinct`, `distinctOn`, many-to-many, variant relations, scalar includes, `combine`, nested includes, composite identities, chunk limits. | 2 | Every include suite passes under both strategies; the new tests of the design's Tests section for reads pass |
| 4 | Writes, cache key, prepared reads | Read-back steps without includes plus `FindRelated`/`NestJoin`; delete ordering; `hashInput` for both strategies; the prepared-read refusal. | 3 | Write-with-include suites pass under both strategies; cache-key and refusal tests pass |
| 5 | Docs | The docs, ADRs, `coupling.md` row 17, release note and upgrade instructions the design lists. | 4 | `pnpm lint:docs`-style checks the repo has pass; links resolve |

After dispatch 5: `/drive-code-review` without the walkthrough, fixes, a second review if the fixes are substantial, manual QA with the two MariaDB probes, then the PR.

# Slice 6b-2 plan — MariaDB runtime

**Spec:** [`spec.md`](./spec.md), sections 2 to 6. One pull request, branch `tml-3697-mariadb-runtime` from `main` after 6b-1 merged (prisma/orm#31058). One implementer (Opus) carries every dispatch; reviewers run on Fable.

| # | Dispatch | Outcome | Builds on | Done when |
| --- | --- | --- | --- | --- |
| 1 | MySQL ORM aggregates | The MySQL target supplies the ORM client's aggregates the way the Postgres target does, so `include('posts', (p) => p.count())` and `combine()` with an aggregate branch run on MySQL. | — | MySQL's live include tests cover scalar includes and `combine()` and pass on MySQL 8.4 |
| 2 | Renderer class | The SQL of every MySQL renderer test input and live-test query is captured as snapshots, rendered without a database. Then, in its own commit, the renderer becomes `MysqlSqlRenderer` with every snapshot unchanged. `MariadbSqlRenderer` overrides the upsert to write `VALUES(c)` and no row alias. | 1 | Snapshots unchanged across the conversion commit; MariaDB upsert rendering tested |
| 3 | Runtime and `mariadb()` | Runtime target and adapter factories; `createMysqlClient`; `@prisma/orm-mariadb/runtime` and `/static`; error messages true of MariaDB (spec section 5). | 2 | Package tests pass; `mariadb()` refuses a contract of another target |
| 4 | Live tests and the example | MySQL's ORM live test files run against MySQL 8.4 and MariaDB 10.11, each difference stated in a test. `examples/prisma-8-demo-mariadb` reads and writes, and runs in the Test Examples CI job. Docs, `coupling.md`, upgrade instructions if any public surface changed. | 3 | Live tests pass on both servers locally; the example's tests pass against MariaDB 10.11 |

After dispatch 4: `/drive-code-review` without the walkthrough, fixes, a second review if the fixes are substantial, manual QA on both servers, then the PR.
