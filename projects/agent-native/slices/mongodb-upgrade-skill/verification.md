# Verification record — mongodb-upgrade-skill

## Linear ticket — FILED 2026-07-06: [TML-2975](https://linear.app/prisma-company/issue/TML-2975/update-prisma-mongodb-upgrade-skill-once-mongodb-transactions-land)

Target project: [SQLite and MongoDB transactions](https://linear.app/prisma-company/project/sqlite-and-mongodb-transactions-860f63d3d786/overview)
(operator-provided, PR #20 thread). Title: **Update prisma-mongodb-upgrade skill once
MongoDB transactions land**. Body: when façade transactions (`db.transaction(...)`) merge
for MongoDB, refresh prisma/skills `prisma-mongodb-upgrade`: the SKILL.md decision-table
transactions row + "expected to change soon" note, the blocker-check in
`references/decision-stay-or-migrate.md`, the transactions row/example in
`references/client-api-mapping.md` (raw-driver session workaround → façade API), and
cutover-checklist item 7. Origin: skills#20 review (aqrln), agent-native project TML-2973.

## Probe verdict (S5-D1, 2026-07-06)

**Prisma Next MongoDB support: present but partial** (option b — no I12 halt; the slice
premise holds). Citations pin to prisma/prisma-next @ `a2791c5dd59d579b4b3052942ae7f8fe5e2ee852`;
v6 docs URLs fetched live with anchors verified.

- **Deeply implemented:** 18-package mongo family + mongo target + `@prisma-next/mongo`
  façade; full ORM CRUD; typed aggregation-pipeline builder; raw lane; **first-class
  contract-driven migrations** (plan → migrate → verify → sign — _not_ push-only, unlike
  v6 Mongo); ~144 unit + ~26 integration test files against real in-memory MongoDB
  (incl. replica sets); two worked examples; dedicated Mongo coverage in Next's own skills.
- **The gaps that set the skill's lead:** no `db.transaction(...)` on the Mongo façade
  (raw driver session API required — while v6 supports transactions on replica sets); no
  ORM `.aggregate()`/`.groupBy()` (query-builder lane instead); filter helpers not
  re-exported (upstream TML-2526); **ROADMAP classifies MongoDB as a POC**, outside both
  the EA target set (Postgres + one SQL DB) and GA (Postgres); pre-1.0 churn is real
  (validator semantics changed v0.11→0.12; `mongodb@^7` became a user-supplied peer dep;
  MongoDB 8.0 floor).
- **Naming trap for the API-mapping reference:** v6's `$runCommandRaw`/`findRaw`/
  `aggregateRaw` have no same-name equivalents — Next's raw lane is `mongoRaw(...)` →
  `RawMongoCollection`. Map names; never assume parity. Also: Mongo ORM keys are collection
  _storage names_ (`db.orm.users`); no schema-layer polymorphism on Mongo.

**Lead recommendation adopted:** stay-on-v6-first (deliberate, supported choice for
production MongoDB today), with a mechanically-detailed migrate-now branch for greenfield /
EA-tolerant teams; explicit no-go signals (façade transactions required; pre-1.0 aversion)
and stay-hygiene guidance. Full fact table with per-claim citations in the S5-D1 dispatch
report (authoring input).

## Delivery (S5-D2, 2026-07-06)

- **PR:** https://github.com/prisma/skills/pull/20 (open, base `main`) — commit `8932c0e`,
  9 files +445: `prisma-mongodb-upgrade/` (SKILL.md router + five references:
  `decision-stay-or-migrate`, `schema-contract-mapping`, `client-api-mapping`,
  `migrations-mapping`, `verify-cutover-checklist`), cross-link blocks in
  `prisma-upgrade-v7` and `prisma-database-setup`, README section + install line.
- **Branch-ref install capture:** `npx --yes skills@1.5.14 add
'prisma/skills#prisma-mongodb-upgrade-skill' --skill prisma-mongodb-upgrade -y` in a clean
  scratch dir → exit 0; lands at `./.agents/skills/prisma-mongodb-upgrade/` with SKILL.md +
  all five references, frontmatter intact.
- Repo-convention note: skills live at the repo root in practice; the repo's AGENTS.md
  describes a `skills/{name}/` nesting that no skill follows — practice followed, doc
  divergence noted (possible upstream tidy, out of scope).
- Observation: the skills CLI's agent roster has grown well past S1-era four (universal
  install now lists "Codex, OpenCode, Zed, Amp, Antigravity +12 more") — no action, but
  S1's `SKILL_AGENTS` list is a candidate for periodic review.
