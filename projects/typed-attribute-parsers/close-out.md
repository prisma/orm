# Typed attribute parsers — close-out ledger

## Delivery state

| Slice | Evidence | State |
| --- | --- | --- |
| Attribute-spec kit + SQL `@relation` | [prisma/prisma-next#891](https://github.com/prisma/prisma-next/pull/891) | Merged |
| Remaining non-default SQL attributes | [prisma/prisma-next#932](https://github.com/prisma/prisma-next/pull/932) | Merged |
| SQL `@default` dynamic specs and typed function calls | [prisma/prisma-next#938](https://github.com/prisma/prisma-next/pull/938) | Merged |
| Mongo attributes | [prisma/orm#29833](https://github.com/prisma/orm/pull/29833) | Approved and queued for merge; final close gate |

The original plan named three slices. SQL `@default` became a fourth slice when its registry-sensitive function grammar and enum path proved independently reviewable.

## Project DoD verification

- [ ] **Team DoD floor:** Final repo-wide gates, project deletion, and Linear completion wait for the Mongo merge and the close-out branch.
- [x] **Attribute-spec substrate:** PR #891 delivered the combinator kit, `AttributeSpec`, `interpretAttribute`, `InferAttr`, unit coverage, and the first SQL consumer.
- [x] **SQL attributes:** PRs #891, #932, and #938 migrated SQL relation, non-default attributes, and both `@default` paths. Typed function-call parsing and dynamic registry/enum specs replaced the legacy default-call parser.
- [ ] **Mongo attributes:** PR #29833 migrates the Mongo family and removes legacy argument parsers. The PR is approved, all 20 CI checks pass, and it is queued for merge; mark complete only after the merge commit is on `main`.
- [x] **Validation evidence on the final Mongo PR head:** package tests, full integration tests, retail tests, build, fixtures, upgrade coverage, DCO, lint, typecheck, e2e, security, and all CI shards pass.
- [x] **Legacy parser retirement:** Each slice removed the parsing helpers whose final consumers migrated; final PR review and typechecking report no remaining consumers.
- [x] **ADR audit:** ADR 231 is reconciled with the shipped API, separates language-tooling follow-up from current behavior, and is `Accepted`.
- [x] **Mandatory final retro:** `projects/typed-attribute-parsers/retros.md` records the project retro and lands the durable architecture in ADR 231.
- [x] **Manual QA roll-up:** N/A for interactive workflow QA. The project changes interpreter parsing rather than a runnable user flow; parser tests, interpreter tests, integration tests, fixtures, example tests, and executable upgrade instructions cover the observable schema-syntax changes.

## Classification

All files under `projects/typed-attribute-parsers/` are transient coordination artifacts and will be deleted after the Mongo merge is confirmed.

- `spec.md`, `plan.md`, `close-out.md`, and `retros.md`: transient project shaping, sequencing, verification, and retro records.
- Every slice `spec.md` and `plan.md`: transient slice scope and sequencing records.
- Every `dispatches/*.md`: transient implementation briefs.

No project-local file migrates to `docs/`. The durable technical outcome has already landed in `docs/architecture docs/adrs/ADR 231 - Declarative attribute specifications.md`.

## Remaining close gates

1. Confirm PR #29833 is merged and update local `main`.
2. Run the final repo-wide validation gates on the close-out branch.
3. Confirm the umbrella Linear issue reflects the merged delivery; do not manually complete it before GitHub integration runs.
4. Remove external references to `projects/typed-attribute-parsers/` without using a repository search tool; inspect known durable surfaces and use build/link validation.
5. Delete `projects/typed-attribute-parsers/`.
6. Commit and open the close-out PR referencing TML-2956.
