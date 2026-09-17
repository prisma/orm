# Drive `code-review` context

> Read by `drive-code-review` before it starts. Capture project-specific facts the generic skill can't know. Update when a drive run surfaces something the next run should inherit.

**Skills served:** `drive-code-review`

## Review focus areas

Check Prisma 7 behavior against the repository's current code and accepted project spec rather than historical Prisma assumptions. For config discovery changes, separate runtime c12 behavior from non-executing bootstrap detection and verify the exact supported extension set.

## Anti-patterns

- **2026-08-14 — Review-comment scope substitution:** Do not interpret a review comment from its prose alone and then rewrite the accepted spec to match that interpretation. Inspect the exact commented diff lines, reconcile the request with the active spec, and ask the reviewer when they appear inconsistent. In PR #30020, a comment on newly added legacy JSON/JSONC/JSON5/YAML/YML/TOML candidates was incorrectly applied to the separately required Prisma 7 JavaScript/TypeScript extension family.

## Ownership map

Use package ownership and requested reviewers from the affected Prisma areas; no additional Drive-specific ownership map is maintained.

## Known constraints & gaps

Automated review summaries can describe a larger diff region than the exact human concern. Anchor resolution to the line-level thread and final requested behavior.

## References

- Repository agent guidance: [`AGENTS.md`](../../AGENTS.md)
- Incident reference: Prisma PR #30020
