# Slice plan: mongodb-upgrade-skill

**Spec:** `projects/agent-native/slices/mongodb-upgrade-skill/spec.md`
**Repo:** prisma/skills (clone to a scratch path; branch `prisma-mongodb-upgrade-skill`);
PR against its `main`.

## Dispatch plan

### Dispatch 1: probe prisma-next's MongoDB surface

- **Outcome:** An evidenced verdict on prisma-next's current MongoDB support (contract
  provider support, query surface, migrations behavior for Mongo, what its own skills say),
  with citations to repo files/READMEs at a named commit — enough to set the skill's lead
  recommendation. No authoring yet. If Next has no MongoDB support at all: I12 HALT.
- **Builds on:** The spec's chosen design.
- **Hands to:** The lead-recommendation verdict + a fact table (claim → citation) the
  authoring dispatch consumes verbatim.
- **Focus:** Read-only investigation of prisma/prisma-next (clone or gh API) + v6 MongoDB
  doc facts the skill will cite. No prisma/skills changes.

### Dispatch 2: author the skill and open the PR

- **Outcome:** The `prisma-mongodb-upgrade` skill authored per the spec's layout in a
  prisma/skills clone (frontmatter per repo conventions), cross-links added in
  `prisma-upgrade-v7` and `prisma-database-setup`, README row added; branch-ref install
  capture taken; branch pushed and PR opened with a body for cold maintainers (incl. the
  version-metadata question flagged).
- **Builds on:** Dispatch 1's fact table and verdict.
- **Hands to:** Slice at DoD pending review — PR URL + captures for `verification.md`.
- **Focus:** prisma/skills only; content grounded exclusively in cited facts.

## Sizing

| Dispatch | Size | dispatch-INVEST note                                              |
| -------- | ---- | ----------------------------------------------------------------- |
| 1        | M    | One outcome: evidenced verdict. Research-shaped, bounded surface. |
| 2        | M    | One outcome: the PR. Authoring against a fixed fact table.        |

## Handoff completeness

DoD condition 1 (PR + citations) ← D2; condition 2 (install capture) ← D2; condition 3
(probe verdict recorded) ← D1 (orchestrator appends to verification.md).
