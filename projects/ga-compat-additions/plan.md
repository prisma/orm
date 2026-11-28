# Additions never break user code: plan

Spec: [spec.md](spec.md). Stream plan: `projects/ga-compatibility/plan.md` on branch `ga-compatibility`, project 5.

## Status

| Slice | State | Pull request |
| --- | --- | --- |
| 1. Open and closed sets | Not started | |
| 2. Error codes do not disappear | Not started | |
| 3. The name rule | Proposal with Will | |
| 4. Interfaces users implement | Not started | |

## Slices

### 1. Open and closed sets

- List every exported union of literals, and every exported union of objects told apart by `kind`, from the `api.txt` listings under `packages/9-public/@prisma/*/`. About 120 lines match today; many name the same type through two entrypoints.
- Skip types that project 3 (reducing exports, prisma/orm#31241 and its successors) makes private. Agree the order with that session before editing a type it is changing.
- Add `(string & {})` to each open union of strings. For a union of objects, decide per type how its catch-all member looks without spoiling narrowing on `kind`, and record the choice.
- List closed sets, with reasons, in a file the check reads. Expected closed sets: maturity levels, `CodecTrait` (ADR 214 relies on it staying closed), the SQL aggregate alphabet `AggregateFn` (ADR 020).
- Add a check, run in CI beside the API check, that fails on an exported set that is neither open nor listed closed. Its test plants an unmarked set and sees it fail.
- Record the type changes in each package's `api-breaks.json`.

### 2. Error codes do not disappear

- Today `pnpm check:error-reference` fails when a code raised in source is missing from `docs/reference/error-reference.md`. Nothing fails when a code stops being raised.
- Compare with the last release, as the API check does: the codes the last release's published packages can raise are the baseline. A code in the baseline that is no longer raised fails the check, unless a repository-level record names it, with its reason and its replacement.
- Coordinate with the session building Prisma's own tables (prisma/orm#31234), which renames the marker's error codes: its renames are the first records.

### 3. The name rule

Waits for Will's answer on the proposal in the spec.

- `db.fragment` and `tx.fragment` on the PostgreSQL, SQLite and Supabase clients; remove `fragment` from `orm()`'s client and the SQLite special case. Check the MongoDB client for any of our names beside model names.
- Contributed aggregate operations' reducers under `using`; remove `ORM.AGGREGATE_OPERATION_RESERVED` and its reserved-name list.
- Decide the shared registries (column operators, aggregate operations, `using` methods), with evidence.
- A new decision record for the rule; update ADRs 020, 259 and 272, the ORM client README, the aggregate descriptor guide and the error reference; add the client half to section 5.1 of the stream spec.
- An upgrade-instruction entry for `db.orm.fragment` → `db.fragment` and for extension reducers under `using`.

### 4. Interfaces users implement

- No list. Plant a required member on one interface users implement, in a package few others depend on, run the API check for that package only, and confirm it fails. Record the result in the stream plan and in this plan.
- Done as part of slice 1's verification; it needs no pull request of its own unless slice 1's inventory finds an implemented interface that no exported function accepts.

## Machine load

Every build, install, type check, multi-package lint and test runs through `lockf -t 3600 /Users/Shared/claude-shared/heavy-command.lock <command>`. No whole test suite, whole-repository build or check over every package runs locally; CI runs those.
