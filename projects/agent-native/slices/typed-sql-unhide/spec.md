# Slice: typed-sql-unhide

_(Parent project `projects/agent-native/`. Outcome: `typedSql` becomes a visible (active)
preview feature — discoverable in schema autocomplete and valid-feature error listings —
project-DoD condition 5.)_

## At a glance

`typedSql` sits in the PSL's **hidden** preview set: valid but absent from autocomplete and
error listings, so users and agents cannot discover it — even as the project's pitfalls
guidance recommends TypedSQL as the escape hatch for full-text search on PostgreSQL. One
enum-set move in prisma-engines plus a schema-Wasm bump here makes it visible. GA is
explicitly out of scope.

## Chosen design

Two halves with an enforced boundary (the wasm publish):

- **Half A — prisma-engines** (completable now): in
  `psl/psl-core/src/common/preview_features.rs`, move `TypedSql` out of the `hidden`
  bitflags (it sits alongside `ReactNative`, which stays) and into the `active` set. Audit
  engines-side tests that pin the valid/active-features list (snapshot or assertion) and
  update them. Probe-first (retro rule): verify the `/tmp` checkout freshens to latest
  `main` and that a Rust toolchain exists before promising local validation; if `cargo`
  is unavailable, the PR opens with a clear note that CI is the validation surface —
  stated in the PR body, not hidden.
- **Half B — prisma/prisma** (deferred by publish dependency): once the engines PR merges
  and a `@prisma/prisma-schema-wasm` dev version publishes, bump it here and update
  snapshots that enumerate valid preview features. **Cannot complete unattended this
  weekend**; the slice's weekend reach is Half A's PR open plus prep notes naming the
  prisma-side files expected to change.

## Coherence rationale

The eventual merge unit in this repo is one small bump-PR whose entire story is "typedSql is
now visible"; the engines PR is the upstream half of the same single claim. One reviewer
holds both in one sitting each.

## Scope

**In (A):** `psl/psl-core/src/common/preview_features.rs`; engines tests pinning the
feature-set classification; the engines PR.
**In (B, deferred):** `@prisma/prisma-schema-wasm` version bump; snapshot updates (e.g. the
`lintSchema` territory in `packages/internals`); prep notes now.

**Out:** GA/stabilization of `typedSql` (would make `$queryRawTyped` generation
unconditional — separate decision); `reactNative` (the other hidden feature) stays hidden;
any TS-side gating changes (`getPrismaClient.ts`, generators) — the feature's behavior is
unchanged, only its visibility.

## Pre-investigated edge cases

| Edge case                                                                                                    | Disposition                                                                          | Notes                                                         |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| The engines repo may enforce commit conventions/CI gates unknown to this project (e.g. rustfmt, commit lint) | Probe the repo's CONTRIBUTING/CI config before pushing; follow what it declares      | Cross-repo work; conventions not derivable from prisma/prisma |
| `/tmp` checkout provenance is unknown (created by an earlier research session)                               | Fetch latest `main`, verify cleanliness, branch fresh; clone anew if anything is off | Stale-base PRs invite conflicts                               |

## Slice-specific done conditions

- [ ] Engines PR open: `TypedSql` in `active`, out of `hidden`; affected engines tests
      updated; PR body states the motivation (discoverability; agent-native project) and
      the validation surface used.
- [ ] Prep note recorded (in this slice's `verification.md`) naming the prisma-side bump
      steps and files for Half B.
- [ ] (Post-weekend, Half B) `typedSql` appears in valid-preview-feature error listings via
      the bumped Wasm; no behavior change for schemas already enabling it.

## Open Questions

1. Active vs stabilized as the landing set. Working position: **active** (visible preview)
   per the task draft — GA is a separate decision with compatibility questions.

## References

- Parent project: `projects/agent-native/spec.md`; task draft
  `docs/plans/agent-native/008-unhide-typed-sql.md`
- Linear: [TML-2970](https://linear.app/prisma-company/issue/TML-2970/s4-unhide-typedsql-preview-feature-engines-wasm-bump)
- Engines surface: `psl/psl-core/src/common/preview_features.rs` (features! macro ~40–92;
  FeatureMap classification ~158–235; hidden set ~234 with `ReactNative | TypedSql`)
- Access verified 2026-07-03: gh push+maintain on prisma/prisma-engines; checkout at
  `/tmp/prisma-engines-compact-plan-format`
