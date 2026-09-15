# Conflict-free upgrade instructions — Implementation plan

**Spec:** [spec.md](./spec.md)
**Implementation details:** [implementation-contracts.md](./implementation-contracts.md)

## Scope

One change: replace shared upcoming-guide edits with independent, unversioned fragments. The release-preparation agent combines them into one guide per audience and moves the originals into a repository-only archive.

No audit ledger, input/output hashes, Git-history scanning, custom assembly commands, staging protocol, global ID registry, expanded content linting, or release-wide migration testing. No additional project, slice-spec, ADR, or formal close-out deliverables are part of this plan.

## Implementation steps

### 1. Change contributor authoring and PR coverage

- Write regression tests first using the existing coverage script's temporary-Git-repository pattern.
- Accept declarations in `upgrade-instructions/pending/<name>/<audience>/instructions.md`, with optional colocated scripts/assets.
- Require a new declaration for each affected audience relative to the PR's actual target branch, preserving stacked-PR behavior and existing substrate exemptions.
- Retain explicit `changes: []` no-op declarations and the existing per-PR instruction-testing procedure.
- Update `record-upgrade-instructions` to write fragments instead of editing a shared transition guide or predicting a release number.
- Keep checks narrow: readable change lists, audience correspondence, valid relative script references, and avoiding destination collisions. Do not add detection-predicate or prose-quality linting.

### 2. Update the release-preparation skill

- Before drafting release notes, gather pending fragments and any originals already archived for this unmerged release.
- Have the agent synthesize one reviewed guide per audience in the existing published location, resolving ordering and duplicate instructions.
- Copy required scripts/assets into self-contained audience guides without overwriting another fragment's assets.
- Move original fragments into `upgrade-instructions/releases/<transition>/sources/`, preserving their contents. No-op fragments are archived but add no consumer prose.
- Use the release PR diff to review what was consumed and what the final guides say. No machine-readable disposition ledger or hashes.
- If preparation is interrupted, inspect the working diff and resume from pending plus current-release archived inputs. Do not add a transactional staging/finalization system.
- Preserve guidance already authored for the unshipped transition when adopting the new layout. Do not rewrite historical releases or create a legacy provenance subsystem.

### 3. Update release completeness checks

- On effective merged release trees and before release publication, reject unconsumed pending fragments and missing/malformed required guides or broken script references.
- A late-arriving fragment blocks the release until the guide is refreshed and that fragment is archived.
- Keep ordinary dev builds working: they may contain pending fragments and do not consume them.
- Do not scan past commits for deleted fragments, compare input/output hashes, or claim the check proves that synthesized prose covers every input. Human review owns that judgment.

### 4. Verify and switch together

- Land contributor acceptance and release handling together so fragments cannot be accepted while publication ignores them.
- Test independent PRs, stacked PRs, a release landing during an open PR, both audiences, no-ops, late arrivals, and script-name collisions through the actual mechanism.
- Check that the existing package skill tests still ship guides/assets and exclude repository-only fragments and archives; extend their assertions where needed rather than introducing another packaging harness.
- Update affected contributor/release documentation in the same change.
- Run the existing script tests, lint, skill/workflow checks, and affected package checks. Register new script tests in `pnpm test:scripts`.

## Boundaries

The archive is for human inspection, not a second executable guide or an audit database. Release checks establish that no pending work remains and that guides are structurally usable; they do not prove migration correctness or detect every possible accidental deletion.

Existing per-PR instruction testing and consumer post-upgrade checks remain unchanged. Release-wide migration rehearsal, candidate-package installation, validation receipts, and freshness checks on test evidence remain out of scope.

This is a local implementation plan, not an instruction to create tracker entities, open a PR, or publish. Normal repository requirements still apply when implementation begins; no new project ceremony is introduced by this change.
