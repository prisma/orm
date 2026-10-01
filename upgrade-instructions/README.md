# Upgrade instruction lifecycle

Feature PRs contribute independent, unversioned fragments. Release preparation turns them into the existing published upgrade guides. Pending work and archived originals stay outside package tarballs.

## Contribute

```text
upgrade-instructions/pending/<descriptive-name>/<app|extension>/
  instructions.md
  scripts/...       (optional scripts/assets)
```

Choose a descriptive name that avoids collisions with other pending contributions; no random suffix, shared index, counter, or global registry is required. A name can recur in a different release. Never overwrite another contribution at a pending, archive, or output destination; resolve actual collisions when encountered.

Relevant changes to `examples/` require an `app` declaration; changes to `packages/3-extensions/` require an `extension` declaration, subject to the existing coverage-check exclusions. Each PR must **add its own declaration relative to its actual target branch**, including stacked PRs. Inherited fragments do not count. Both audiences need separate declarations when both are affected.

Keep the existing YAML frontmatter `changes[]` and Markdown prose, with optional `detection` and relative `script` references. A no-op declaration is `changes: []` with no consumer prose. Scripts/assets must stay within their audience directory. Follow [record-upgrade-instructions](../skills-contrib/record-upgrade-instructions/SKILL.md) for authoring and the unchanged per-PR validation by execution.

Do not predict a release number or edit shared transition guides on feature PRs. An intervening release does not require relocating an open PR's pending fragment.

## Prepare a release

The [release-preparation skill](../skills-contrib/publish-npm-version/SKILL.md) assembles guidance **before release notes**:

1. Resolve the actual previous published stable/RC release ref and target version. Use their transition label (stable versions use `major.minor`, RC versions their full version), not a predicted next release from a feature branch. An unpublished intermediate bump does not create a release boundary.
2. Read all pending fragments plus originals already archived for this **current unmerged release**, not older releases' archives. At cutover, existing unshipped guidance is carried into `pending/existing-unreleased/<audience>/` as assembly input, with obsolete transition headers removed; retain its change declarations, prose, and assets without dropping or duplicating guidance.
3. Synthesize a single guide for each audience at `skills/prisma-8/upgrading/<audience>/upgrades/<from>-to-<to>/instructions.md`. Resolve ordering, overlap, and duplicate IDs; retain the `changes[]`, prose, and relative script interface. Even an audience with no actionable changes gets `changes: []` and no prose, preserving chain continuity.
4. Copy required scripts/assets under each guide's `scripts/<fragment-name>/` namespace and update references, including script-local asset references. Each audience must be self-contained: no imports or links into pending work, archives, or the other audience.
5. Move originals, unchanged, to `upgrade-instructions/releases/<from>-to-<to>/sources/<name>/<audience>/...`. Archive no-op declarations too, but add no consumer prose for them.
6. Review the guides and assets against the originals and release PR diff, then draft notes linking the published guides.

Resume interrupted preparation by inspecting ordinary Git status/diffs, pending inputs, current-release archived inputs, and output files. No custom assembly commands, staging protocol, hashes, ledger, or historical deletion scan is needed. If new fragments arrive before merge, incorporate them, refresh the guides and review, then refresh notes as needed. Moving originals alone does not prove synthesis was correct; review owns omissions and semantic correctness. No release-wide migration rehearsal is added.

Published guides and historical chain discovery remain intact. Corrections to published guidance continue through normal reviewed PRs; they are not new feature declarations.

## Checks

`pnpm check:upgrade-coverage` checks committed Git trees. Explicit `--prev` and `--head` take committed refs; commit working changes before relying on these checks.

- `--mode pr --prev <target-base> --head <candidate>` requires the PR's new audience declarations. A release version bump automatically selects release completeness checks. CI uses event-pinned refs, including the effective merged tree for merge groups.
- `--mode publish --prev <actual-prior-release-ref> --head <candidate>` rejects **all pending fragments** and missing/malformed required guides or broken script references. The release script runs the relevant checks against the actual candidate commit before registry side effects, independently of PR CI.
- `--mode dev --prev <base> --head <candidate>` validates format and script references but permits pending work. Dev/beta publication uses this mode and neither consumes fragments nor creates archives. Stable/RC publication (including release-class dry runs) uses publish mode.

The checks establish coverage and structural usability, not that every source instruction was faithfully synthesized or that no fragment was accidentally deleted. Human review remains necessary.
