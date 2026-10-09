# Drive `pr` context

> Read by `drive-pr-description` and `drive-pr-walkthrough` before they start. Capture project-specific facts the generic skills can't know. Update when a drive run surfaces something the next run should inherit.

**Skills served:** `drive-pr-description`, `drive-pr-walkthrough`

## PR template

Use concise sections for overview, changes, rationale, scope, and verification. Close-out PRs additionally include project-DoD evidence, artifact classification, reference-scan results, and the merged implementation PR.

## Labels & metadata

Target the same base branch as the merged implementation project unless the operator says otherwise. Do not invent Linear references, labels, or milestones.

## CI gate context

Treat required GitHub checks as blocking. Distinguish optional/advisory checks explicitly, and investigate failures against the exact failing test before changing implementation.

## Known constraints & gaps

PR review comments are requirements input, not automatically a replacement for the accepted spec. Reconcile comments with the exact diff hunk and active spec before changing scope.

## References

- Repository agent guidance: [`AGENTS.md`](../../AGENTS.md)
