# Conflict-free upgrade instruction authoring

## Purpose

Stop unrelated PRs conflicting on shared upgrade instructions and avoid moving their contributions when a release lands. Preserve explicit per-PR declarations while consumers continue to receive one reviewed guide per release transition and audience.

## At a glance

Today, the coverage gate requires relevant PRs to touch a shared upcoming transition's `instructions.md`, even for no-op declarations.

Instead, each PR adds its own unversioned fragment. During release preparation, an agent combines pending fragments into the existing app/extension guides and moves originals into a repository-only archive. Contributors do not choose a release number or edit a shared index.

```text
Independent PR fragments
         │
         ▼
Release-preparation agent
         ├── single app guide + required scripts
         ├── single extension guide + required scripts
         └── repository-only source archive
```

A release cannot publish with pending fragments left over. If another PR lands after assembly, its fragment blocks the release until incorporated. Human review checks the guide against the originals; the lint does not attempt to prove synthesis correctness.

## Scope

### Independent contributions

- Keep existing routing: relevant changes to `examples/` require an app declaration; relevant changes to `packages/3-extensions/` require an extension declaration.
- Require the PR's own new declaration relative to its actual target branch, including stacked PRs. Preserve existing substrate exclusions.
- Store fragments outside the published skill tree, with distinct pending directory names and optional colocated scripts/assets. No shared index, predicted release number, or global ID registry.
- Retain explicit no-op declarations using `changes: []`. A PR affecting both audiences declares each separately, including mixed real-change/no-op cases.
- Retain the existing instruction format and per-PR instruction-testing procedure; only the contribution location changes.

### Release assembly and archive

- Extend the existing release-preparation skill to gather pending fragments and synthesize one guide per audience before drafting release notes.
- Keep published guides at `skills/prisma-8/upgrading/<audience>/upgrades/<from>-to-<to>/instructions.md`, with the existing `changes[]`, prose, and relative script interface.
- Resolve ordering and duplicated instructions through agent synthesis and human review. App and extension guides remain self-contained, and scripts must not overwrite another contribution's assets.
- Move original fragments and assets into a repository-only archive grouped by release. Preserve no-op originals but omit no-op prose from the consumer guide.
- Refresh an unmerged release using both newly pending fragments and originals already archived for that release, without replaying older releases.
- Use normal Git diffs and working-copy inspection to review and resume the work. No assembly ledger, hash tracking, disposition mapping, custom assembly commands, or transactional staging protocol.

### Narrow coverage and completeness checks

- Adapt the existing coverage check to the new declaration location. Limit additional format checks to readable change lists, audience coverage, and valid relative script references.
- Release checks reject pending fragments and missing/malformed required guides or broken script references.
- Run the completeness check on the effective merged release tree, including merge groups, and independently before release publication. A check against a stale release-branch snapshot is insufficient.
- Preserve ordinary dev publication: dev builds may contain pending work and do not consume fragments.
- Checks do not scan historical commits for deleted fragments or prove that every archived instruction was correctly synthesized. Human review owns omissions and semantic correctness.

### Safe cutover

- Switch contributor acceptance and release handling together so accepted fragments cannot be ignored by publication.
- Preserve existing published guides, paths, and historical chain discovery. Carry existing unreleased guidance into the first assembly without losing or duplicating it.
- Keep pending fragments and archives outside package tarballs. Reuse existing package-content tests to verify that boundary.
- Update affected contributor/release skills and diagnostics in the same change.

## Out of scope

- Release-wide migration execution tests, previous-release-to-candidate rehearsals, candidate-package installation infrastructure, validation receipts, or freshness checks on test evidence.
- Expanding existing per-PR instruction testing or changing consumer post-upgrade checks.
- Machine-readable assembly audit manifests, input/output digests, per-fragment disposition ledgers, and Git-history scanning for deleted declarations.
- Separate preparation/finalization commands, staging protocols, or a transactional assembly system.
- Global ID reservation across historical releases or mandatory random suffixes.
- Broader detection-schema or prose-quality linting, or a parser/schema overhaul unrelated to reading fragments.
- Reconstructing historical provenance or introducing a permanent legacy-adoption subsystem.
- Additional Linear Project setup, slice-spec deliverables, mandatory ADR, or formal project close-out as prerequisites introduced by this plan. Normal repository requirements still apply during implementation.
- Changing the substrate heuristic, replacing release notes, rewriting published history, automatically merging, or publishing as part of this task.

## Acceptance criteria

- [ ] Independent PRs touching the same audience add separate files, with no shared upgrade-file edits; an intervening release does not require relocating an open PR's fragment.
- [ ] Coverage requires the PR's own declarations for affected audiences, accepts explicit no-ops, preserves stacked-base behavior, and rejects missing/unreadable declarations.
- [ ] Agent-driven assembly produces the existing single-guide format for both audiences, bundles scripts without collisions, and preserves originals in repository-only archives.
- [ ] Late-arriving fragments block the effective merged release and release publication until incorporated; ordinary dev builds remain unaffected by pending work.
- [ ] Existing package-content checks demonstrate that guides/assets ship while pending fragments and archives do not.
- [ ] Existing released and unreleased guidance survives cutover; documentation reflects the new workflow and existing per-PR instruction testing remains unchanged.

These criteria need ordinary regression tests and review, not a new migration rehearsal or audit system.

## Accepted trade-offs

An empty pending directory does not prove that no fragment was accidentally deleted or that the guide faithfully represents every input. Source archives and the release PR diff support human review; eliminating that residual risk mechanically is outside this fix.

Agent synthesis is not deterministic. The release reviewer checks ordering, omissions, and combined transformations. Late arrivals may require another synthesis/review pass, but not a new execution-testing gate.

## References

- [Implementation plan](./plan.md), [implementation details](./implementation-contracts.md), and [decision history](./design-decisions.md).
- [Coverage gate](../../scripts/check-upgrade-coverage.mjs) and [existing tests](../../scripts/check-upgrade-coverage.test.mjs).
- [Contributor authoring](../../skills-contrib/record-upgrade-instructions/SKILL.md), [release preparation](../../skills-contrib/publish-npm-version/SKILL.md), and [release-note drafting](../../skills-contrib/draft-release-notes/SKILL.md).
- [App upgrade flow](../../skills/prisma-8/references/upgrade-app.md) and [extension upgrade flow](../../skills/prisma-8/references/upgrade-extension.md).
- [Skill packaging](../../scripts/sync-package-skills.ts), [CI](../../.github/workflows/ci.yml), and [publication](../../.github/workflows/publish.yml).
