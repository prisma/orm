# Drive `spec` context

> Read by `drive-specify-project`, `drive-specify-slice`, and `drive-reverse-spec` before they start. Capture project-specific facts the generic skills can't know. Update when a drive run surfaces something the next run should inherit.

**Skills served:** `drive-specify-project`, `drive-specify-slice`, `drive-reverse-spec`

## Spec conventions

<!-- Project-specific deviations from the canonical spec skeleton: required sections beyond Summary/Requirements/Non-goals, ticket-link conventions, where specs live on disk, etc. -->

## Stakeholders & reviewers

<!-- Who routinely reviews specs here (Product, Senior Maker, etc.). Any per-lane variations. -->

## Domain primer

<!-- The minimum domain context an agent needs to draft a spec for this codebase. Glossary of in-house terms, links to architecture docs, common surfaces touched. -->

## Known constraints & gaps

<!-- Things specs in this project have historically gotten wrong. -->

- **2026-07-03 (agent-native S1 retro):** when a slice's chosen design or DoD depends on an
  external tool's on-disk behavior, probe that behavior empirically at spec time (one live
  invocation in a scratch directory) instead of trusting the tool's documentation or its own
  progress output — or explicitly mark the assumption unverified and make the probe the
  slice's first dispatch. Trigger: the skills CLI (skills@1.5.14) promised per-agent
  symlinks in its plan output but never created them; the slice spec pinned a layout that
  was false on disk, costing an I12 stop and an extra round in the final dispatch.

## References

<!-- Links to canonical specs the agent should pattern-match against. -->
