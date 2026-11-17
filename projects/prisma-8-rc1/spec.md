# Prisma 8 RC1 — Project Spec

# Summary

Ship Prisma Next as **`prisma@8.0.0-rc.1`, published from the merged `prisma/prisma` repository, by July 31 2026**, with the announcement live the same day. Users arrive at the same GitHub repository and install the same npm package they always have — and what they get is Prisma Next.

# Purpose

End the period where Prisma's future ORM lives in a separate repo under a separate name. One repository, one package name, one upgrade story — so that every user who looks for Prisma finds Prisma 8, and every v7 user has a concrete, tested path to run both versions side by side and migrate incrementally.

The RC redefines the release bar: **not parity with Prisma 7, but confidence** — everything the RC ships works, the API surface it exposes is frozen, and everything it doesn't ship is named explicitly.

# At a glance

A v7 user's first contact with the RC, end to end:

```jsonc
// package.json — both versions installed in one project
{
  "dependencies": {
    "prisma-v7": "npm:prisma@^7",   // existing app code keeps working
    "prisma": "npm:prisma@next"     // resolves to 8.0.0-rc.1
  }
}
```

```bash
# v7 keeps owning the database schema and migrations
npx -p prisma-v7 prisma migrate deploy

# v8 adopts the same database read-only: infer a contract, verify, sign
prisma-next contract infer
prisma-next db sign          # verifies the live schema satisfies the contract, then records a marker
prisma-next db verify --schema-only   # CI check: schema still matches
```

New queries are written against the v8 client; old code paths stay on v7. At the end of the migration, ownership flips once: the final `db sign` against the last v7-migrated state, and v7 is removed. `npm install prisma` continues to resolve to v7 until `8.0.0` final ships — nobody gets v8 by accident.

# Non-goals

- **Prisma 7 feature parity.** The RC ships what works. Missing capabilities are named in the supported-surface matrix, not implied.
- **Guaranteed-stable polymorphism/MTI at RC.** In scope until the July 24 go/no-go; if the bug curve hasn't flattened, it ships marked experimental.
- **Renaming `prisma/prisma` → `prisma/prisma-orm`.** Parked. GitHub redirects make it cheap to do later; it does not need to ride along with the merge.
- **Migrating the internal toolchain to TypeScript 7.** Consumer-side TS 7 validation is in scope (types must work under the native compiler); switching our own build to it is not.
- **Comparative benchmarks.** The public benchmark surface is measurements-only (our own numbers over time). No v7 or competitor comparison — fair comparison is genuinely hard and the claim would become the story.
- **ADR 211 Flavor 2 bundling before RC.** Consolidating the ~60 internal `@internal/*` packages into the shim is designed and non-breaking, and therefore deliberately deferred to after RC.
- **The public road-to-final dashboard.** Goes live *with* the RC announcement, not before. Pre-RC tracking is org-internal (the Linear project).
- **An exhaustive up-front ticket backlog.** Tickets are created just-in-time as work starts; the Linear project's milestones and status updates are the tracking surface.

# Place in the larger world

- **prisma/prisma** currently holds Prisma 7. This project merges prisma-next's content in **on a `v8` branch early** (CI running there for weeks) and merges to `main` in the final week. v7 history moves to a `v7` maintenance branch (bug fixes and security updates for 18 months from 8.0.0 final). At merge time, open v7 issues and PRs are closed except v7 bugs, with a pinned explanation issue.
- **The `prisma` npm package** is currently v7's. The RC publishes under a non-`latest` dist-tag; `latest` stays v7 until 8.0.0 final. Publishing requires npm rights + trusted-publisher (OIDC) configuration on that package — an external dependency chased first.
- **prisma/prisma-cli (`@prisma/cli`)** is the long-term CLI home; out of scope here but the bin strategy must not conflict with it.
- **EA shipped June 1** with good sentiment but little uptake — which means production feedback is thin, and the mined-from-P7 test suite plus the side-by-side fixture do the confidence work that adoption otherwise would.

# Cross-cutting requirements

1. **Parallel install must actually work, and be proven by a fixture.** One project, both versions installed, one Postgres database, v7 owning DDL. The npm alias covers library resolution; there is no CLI bin conflict because v8 ships only the `prisma-next` binary (`prisma` unambiguously means v7 until v7 is removed); migration ownership stays with v7 until a single final cutover (adoption via `contract infer` → `db sign`, per ADR 122). The e2e fixture is simultaneously the coexistence proof, the differential-testing harness, and the executable form of the upgrade guide.
2. **Everything that freezes at RC must land before RC.** The freeze set: public package names, error codes, config keys (`extensionPacks` → `extensions`), the `migrations/` directory layout (snapshot centralization), CLI bin names, and the Node/TS/database version floors. Anything not in the freeze set may trail.
3. **Claims in the announcement must have receipts.** "Works" → the supported-surface matrix backed by named green test suites. "TS performance" → the public Bencher project. "Run both in parallel" → the fixture. No unverifiable claims.
4. **The org can see the state at any time.** The Linear project *Prisma 8 RC1* (lead: Will, milestones Jul 18 / Jul 22 / Jul 24 / Jul 31) is the internal dashboard; status updates at each milestone.

# Transitional-shape constraints

- The v8 branch lives in `prisma/prisma` with green CI for as long as possible before the final merge; merge mechanics are never last-week discoveries.
- The RC is never reachable via `npm install prisma` (non-`latest` dist-tag) until 8.0.0 final.
- Only the visible package set is renamed at RC (`prisma-next` shim → `prisma`; `@internal/{postgres,sqlite,mongo}` facades → `@prisma/*`, collision-audited against classic's `@prisma/*` names). All other `@internal/*` packages remain published and untouched until Flavor 2.
- During the coexistence period, `db verify` runs lenient (v7's `_prisma_migrations` table in `public` is an unclaimed element that fails `--strict`); the upgrade guide blesses lenient mode until cutover.

# Project DoD

- [ ] `prisma@8.0.0-rc.1` is published from the merged `prisma/prisma` repository under a non-`latest` dist-tag; `npm install prisma` still resolves to v7.
- [ ] The announcement is live, and every claim in it maps to a receipt (matrix, Bencher, fixture).
- [ ] The parallel-install recipe in the upgrade guide is backed by a green e2e fixture (both versions, one database, v7 owns DDL, adoption loop exercised after a v7 migration).
- [ ] The `v7` maintenance branch exists in `prisma/prisma` with working CI, and the 18-months-from-final support statement is published.
- [ ] User-facing error codes follow one consistent scheme, with a crosswalk for renamed codes; codes are frozen.
- [ ] `extensionPacks` → `extensions` rename (TML-2462) and the Pool error-listener fix (TML-2655) are merged.
- [ ] Migration contract snapshots are centralized under `migrations/snapshots/` (content-addressed); the reader accepts `.json.gz`.
- [ ] The supported-surface matrix (feature × target × stable/experimental/not-in-8.0) is published, with every "stable" cell backed by a named green suite.
- [ ] TS performance measurements (check time, type instantiations, memory; 10/100/500-model schemas; TS 5.9 and TS 7) are live on a public Bencher project, with instantiation-count regression checks on PRs.
- [ ] Open v7 issues/PRs are triaged per the merge policy (close all except v7 bugs, pinned explanation issue posted).

# Open questions

- **Error-code scheme** (due Jul 18, Will): dotted `NAMESPACE.SUBCODE` vs `PN-DOMAIN-NNNN`. Recommendation on the table: dotted wins; crosswalk the ~46 PN codes.
- **Postgres version floor** (due Jul 22, Will): keep 17 (EA-era convenience) or lower it for the migration audience. Every floor version is a CI matrix row forever. Blocks the supported-surface matrix.
- **Polymorphism/MTI in or out** (Jul 24 go/no-go): decided by Alexey's bug curve.
- **npm publish rights on `prisma`**: who grants them, and does v7's release automation assume exclusive ownership of the package?

# References

- Linear project: [Prisma 8 RC1](https://linear.app/prisma-company/project/prisma-8-rc1-7592265f700c)
- Design rationale and alternatives: [design-notes.md](design-notes.md)
- Plan: [plan.md](plan.md)
- ADR 021 — Contract Marker Storage & verification modes
- ADR 122 — Database Initialization & Adoption (the brownfield `infer → sign` path)
- ADR 123 — Drift Detection, Recovery & Reconciliation
- ADR 199 — Storage-only migration identity (why snapshot centralization is safe)
- ADR 211 — prisma-next bin-only distribution (the packaging end-state and Flavor 2)
- ADR 222 — Version support policy (Node ≥24, TS ≥5.9, ESM-only)
- ADR 027 / ADR 068 — Error envelope stable codes / error mapping (the error-consistency baseline)
- `docs/oss/versioning.md` — lockstep versioning, dist-tags, publish pipeline
