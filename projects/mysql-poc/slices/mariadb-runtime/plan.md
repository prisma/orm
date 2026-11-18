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
