# Slice: mongodb-upgrade-skill

_(Parent project `projects/agent-native/`. Outcome: MongoDB users — the one cohort with no
road into Prisma 7 — get an agent-consumable migration path from v6 to Prisma Next, as a
`prisma-mongodb-upgrade` skill in prisma/skills. Adopted work TML-2973; counts toward
project-DoD condition 4.)_

## At a glance

A new skill in [prisma/skills](https://github.com/prisma/skills) that keeps agents from
recommending an impossible "upgrade to v7" to MongoDB users — or worse, silently rewriting an
app onto SQL. It frames the real decision (migrate to Prisma Next now vs stay on v6
deliberately), carries the migration mechanics, and cross-links from `prisma-upgrade-v7` and
`prisma-database-setup` so agents route correctly from either entry point. One PR against
prisma/skills `main` (WRITE access verified 2026-07-03).

## Chosen design

- **Probe first (retro rule):** the external unknown is prisma-next's current MongoDB
  support surface. Dispatch 1 grounds empirically in the prisma-next repo (does the contract
  support the mongodb provider? what query surface exists? what do its own skills say?) and
  that verdict sets the skill's lead: a real "migrate now" path, or stay-on-v6-first with the
  Next path framed as emerging. **If the probe finds no MongoDB support in Next at all, that
  is an I12 halt** — the slice's premise (operator-stated: "only v8/Next does") would be
  falsified and the operator decides.
- **Operator correction (2026-07-06, PR review):** the probe's POC verdict over-trusted a
  stale `ROADMAP.md` (~4 months old). Ground truth from the operator: **MongoDB in Prisma
  Next is Early Access, past POC, and planned for GA after Postgres** — and the product
  intent is to **encourage** MongoDB users to migrate and gather their feedback early, not
  to counsel waiting. The skill's lead is therefore: migrating to Next (EA) is the
  encouraged path; staying on v6 remains a legitimate choice where hard blockers apply
  (e.g. façade transactions), stated honestly without EA scare-framing. Decision questions
  the agent can answer from the codebase (e.g. `$transaction` usage) are phrased as agent
  checks, not questions to the user. Internal prisma-next file paths stay out of the
  user-facing skill body (they live in this project's verification record); the skill also
  notes that the underlying `mongodb` driver is directly accessible in Next (peer dep), so
  driver-level capabilities are available even where the façade lacks a wrapper.
- **Skill layout** (per the repo's AGENTS.md conventions — kebab-case dir prefixed
  `prisma-`, exact `SKILL.md` filename, frontmatter `name`/`description`/`license: MIT`/
  `metadata: {author: prisma, version}`, `references/{category}-{rule}.md`):
  - `SKILL.md` — router: the version landscape (v6 terminal for MongoDB on classic ORM; v7
    never ships the connector; Next is the future), the decision table, and pointers into
    references.
  - `references/` — decision framing (migrate-now vs stay-on-v6 with EA caveats and
    stay-hygiene); schema mapping (`mongodb` provider, `@db.ObjectId`, composite/embedded
    types, indexes → Next's contract); client API mapping incl. raw escape hatches
    (`$runCommandRaw`/`findRaw`/`aggregateRaw`); the migrations story (v6 Mongo = `db push`
    only; Next = contract-driven emit/verify/sign/migrate); a no-data-moves verification
    checklist (same DB; indexes match; staged round-trip before cutover).
  - Hand-off rule: after switching, run `prisma-next init`'s own skill installation; this
    skill is the discovery bridge, not a duplicate of prisma-next's upgrade cluster.
  - Verify-before-acting note: Next is Early Access; the skill states the Next version its
    content was verified against and instructs agents to check the installed surface.
- **Cross-links:** one short "MongoDB? This guide does not apply — see
  prisma-mongodb-upgrade" block in `prisma-upgrade-v7/SKILL.md`; a MongoDB routing note in
  `prisma-database-setup`; a row in the repo README's skill table (note: the README table
  currently omits `prisma-postgres-setup` — add only our row, do not tidy theirs).
- **Validation gate (self-serve):** install from the branch ref in a scratch dir —
  `npx --yes skills@1.5.14 add 'prisma/skills#<branch>' --skill prisma-mongodb-upgrade -y`
  (ref-sources verified working in S1) — and confirm placement + frontmatter parse.

## Coherence rationale

One reviewable unit: one new skill directory, two cross-link touches, one README row — a
single claim ("MongoDB users get routed correctly") a reviewer holds in one sitting.

## Scope

**In:** `prisma-mongodb-upgrade/` (SKILL.md + references), the two cross-link touches, the
README row — all in a prisma/skills clone; the PR there.

**Out:** restructuring `prisma-upgrade-v7` beyond the cross-link block; prisma-next's own
skills (authoritative for the Next side; we link, not duplicate); any prisma/prisma or
prisma-next code; v6 docs corrections.

## Pre-investigated edge cases

| Edge case                                                                                                                    | Disposition                                                                                                                                    | Notes                                                       |
| ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Skill `metadata.version` semantics: ORM skills carry the targeted ORM version (e.g. "7.6.0"), but this skill spans v6 → Next | Probe the repo's conventions; working position: version the skill itself (start `0.1.0`) and name the verified prisma-next version in the body | Maintainers may override in review — flag it in the PR body |
| v6 MongoDB facts must be verified, not recalled (e.g. transactions require replica sets; `db push` only)                     | Authoring dispatch cites v6 docs for each behavioral claim, mirroring the project's citation discipline                                        | Same rule as the pitfalls task (007)                        |

## Slice-specific done conditions

- [ ] PR open on prisma/skills: skill + cross-links + README row; every behavioral claim
      about v6 or Next carries a citation (docs page or repo file); the skill states the
      prisma-next version it was verified against.
- [ ] Branch-ref install capture: the skill lands via `skills add 'prisma/skills#<branch>'`
      in a scratch dir with intact frontmatter.
- [ ] The probe verdict (Next MongoDB surface) recorded in this slice's `verification.md`
      with the evidence trail.

## Open Questions

1. Lead recommendation (migrate-now vs stay-on-v6-first). Working position: resolved by the
   dispatch-1 probe, not by prior belief.

## References

- Parent project: `projects/agent-native/spec.md`; task draft
  `docs/plans/agent-native/011-skill-mongodb-upgrade.md`
- Linear: [TML-2973](https://linear.app/prisma-company/issue/TML-2973/skill-prisma-mongodb-upgrade-migrate-mongodb-users-from-v6-to-prisma)
- prisma/skills conventions: repo `AGENTS.md`; existing exemplar `prisma-upgrade-v7`
- prisma-next: repo README + `skills/` cluster (probe target)
