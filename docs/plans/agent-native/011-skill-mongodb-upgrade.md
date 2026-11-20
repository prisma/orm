# Task: Skill — MongoDB Upgrade Path (v6 → Prisma Next)

## Overview

A `prisma-mongodb-upgrade` skill in prisma/skills for the one user cohort with no road into
Prisma 7 at all: MongoDB users. Prisma 7 does not ship a MongoDB connector and never will —
v6 is the last classic-ORM major that supports MongoDB, and the supported future is Prisma
Next (the v8 lineage, currently Early Access). An agent that does not know this will either
recommend an upgrade that cannot work or silently rewrite an app onto a SQL database. The
skill gives agents the correct decision framing and the concrete migration mechanics.

## Content outline

### Decision framing first

- The version landscape: v6 = terminal major for MongoDB on the classic ORM; v7+ = no MongoDB;
  Prisma Next = the MongoDB future. `prisma-upgrade-v7` explicitly does not apply to MongoDB
  projects — cross-link both ways so agents route correctly from either entry point.
- Migrate now vs stay on v6 for the time being: Early Access maturity, feature-parity check
  against the app's actual usage, production risk appetite. Staying is a legitimate outcome —
  include stay-on-v6 hygiene (pin versions, track advisories, revisit cadence).

### Migration mechanics (v6 → Next)

- **Schema**: `schema.prisma` with the `mongodb` provider (`@db.ObjectId`, composite/embedded
  types, `@@index` on collections) → Prisma Next's type-safe contract; a mapping table for
  models, embedded documents, indexes, and defaults.
- **Config**: v6 datasource URL / env loading → Next's config surface
  (`prisma-next.config.ts`).
- **Client API**: query-surface mapping for CRUD, filters, relation-style queries over
  references, and the raw escape hatches (`$runCommandRaw`, `findRaw`, `aggregateRaw`) — what
  the Next equivalents are, or how to bridge where none exists yet.
- **Migrations story**: v6 MongoDB never had `prisma migrate` (only `db push` and index sync);
  Next has a real contract-driven flow (emit / verify / sign / migrate). What that changes
  operationally.
- **Data**: none moves — same database, same collections; the ORM layer changes. Verification
  checklist: indexes match, reads/writes round-trip on a staging copy before cutover.

### Hand-off and freshness discipline

- After the switch, the project should run `prisma-next init`'s own skill installation; this
  skill is the discovery bridge that lives where v6 users look (prisma/skills), not a
  duplicate of prisma-next's upgrade cluster — link to it as the authoritative, always-latest
  continuation.
- Verify-before-acting: Next is Early Access and its surface moves; the skill instructs
  agents to check the installed `prisma-next` version and its shipped skills before composing
  commands from memory, and states which Next version the skill's own content was verified
  against.

## Scope

- prisma/skills: new `prisma-mongodb-upgrade` skill directory (SKILL.md + `references/` per
  repo conventions). Cross-links added in `prisma-upgrade-v7` ("MongoDB? This guide does not
  apply — see prisma-mongodb-upgrade") and `prisma-database-setup`.
- Content must be authored against the then-current prisma-next MongoDB support surface —
  grounding in the prisma-next repo is a prerequisite step, not an afterthought.

## Acceptance criteria

- An agent asked to "upgrade this Prisma + MongoDB app to the latest Prisma" correctly rules
  out v7, presents the v6-stay vs Next-migrate decision with honest Early Access caveats, and
  can execute the Next path end-to-end from the skill.
- `prisma-upgrade-v7` no longer leaves MongoDB users without a route (cross-link in place).
- The skill states the prisma-next version its content was verified against.

## Open questions

- Deduplication boundary with prisma-next's own upgrade skill cluster (which always tracks
  `main`): proposed split — this skill owns discovery + decision framing + v6-side
  preparation; the prisma-next cluster owns the Next-side specifics. Confirm with the
  prisma-next maintainers.
- Whether MongoDB support in Next is complete enough today for a "migrate now"
  recommendation, or the skill should initially lead with stay-on-v6 guidance — resolve by
  grounding against prisma-next's current state when authoring.
