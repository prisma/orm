# Implementation details

Minimal implementation choices for [the spec](./spec.md) and [the plan](./plan.md). These paths are proposed, not yet implemented.

## Storage

```text
upgrade-instructions/
  pending/
    <name>/
      app/
        instructions.md
        scripts/...
      extension/
        instructions.md
        scripts/...
  releases/
    <from>-to-<to>/
      sources/<name>/<audience>/...

skills/prisma-8/upgrading/<audience>/upgrades/<from>-to-<to>/
  instructions.md
  scripts/<name>/...
```

Choose a descriptive fragment directory name that does not collide with existing pending work. No mandatory random suffix, shared counter, global registry, or uniqueness check against all historical releases. Reusing a name in a different released transition is harmless. Never overwrite another contribution at a pending, archive, or output destination; handle an actual collision when encountered.

A PR touching both substrates supplies both audience directories, including a no-op declaration where appropriate. Audience and contribution name come from the path, not duplicated metadata.

## Fragment format and narrow lint changes

Retain the existing YAML `changes[]` and Markdown prose format. `script` and `detection` remain optional; prose-only instructions still work. A no-op is `changes: []`.

The PR check requires that the PR itself adds a declaration for each affected audience, relative to its actual target branch. An inherited fragment does not satisfy a new PR's obligation. Preserve existing substrate exclusions and stacked-PR behavior.

Limit format checking to reading the change list, audience coverage, and resolving referenced scripts within the fragment or published guide. Do not introduce a new detection schema, prose-quality checks, a disposition schema, or a parser/schema overhaul. Authoring guidance and review retain responsibility for useful instructions and meaningful no-op judgments.

Namespace copied output scripts by fragment name to avoid unrelated scripts with the same basename colliding. Keep app and extension outputs self-contained, and do not permit references that escape into repository-only source archives.

## Agent-driven release assembly

Extend the existing release-preparation skill, not the command surface:

1. Determine the actual release transition using existing release conventions.
2. Read all pending fragments plus originals already archived for the current unmerged release. Do not replay older releases' archives.
3. Synthesize one guide per audience at the existing consumer path. Resolve duplication and order; retain explicit empty guides where needed for no-op transitions and chain continuity.
4. Copy required assets, update relative references, and move originals into that transition's repository-only archive without altering their content.
5. Review the guide against its source fragments and the release PR diff before drafting release notes.

No `upgrade:prepare`, `upgrade:finalize`, staging directory protocol, `assembly.json`, content hashes, or per-fragment disposition mappings are introduced. If preparation is interrupted, the agent inspects pending inputs, current-release archived inputs, and its Git diff before continuing. Git and normal working-copy inspection provide recovery; there is no new transaction manager.

If another fragment arrives before release, include it and refresh the guide. No-op fragments are archived without adding consumer prose. Human review checks that no obligation was lost; moving a file does not mechanically prove its content was incorporated.

## Release checking

Continue using `pnpm check:upgrade-coverage`:

- Ordinary PRs: require that PR's audience declarations.
- Release PRs / effective merged release trees: require no pending fragments and structurally usable guides with valid script references.
- Release publication: independently check the actual release tree before registry side effects.

Use event-pinned base/head revisions for PR and merge-group checks, preserving the actual target for stacked PRs. Put required checks in a job that runs for both event types; the existing integration job skips merge groups.

Use existing release classification to distinguish stable/RC releases and release-class dry runs from ordinary dev builds. Dev builds may retain pending work and do not consume fragments or create archives. Keep normal package-content checks applicable to both.

Do not inspect first-parent history, enforce a pending-file deletion policy across commits, or compare archives to a machine-generated consumption ledger. Late arrivals remain detectable because they leave pending fragments. Accidental deletion or incomplete synthesis is a review concern, not a guarantee made by the lint.

## Packaging and cutover

Keep pending and archived originals outside `skills/`, which is the tree copied into published packages. Reuse the existing [package skill tests](../../packages/0-shared/publish-surface/test/package-skills.test.ts) for presence of guides/assets and exclusion of repository-only content.

Leave published guides, consumer paths, and historical chain discovery intact. Carry forward existing unshipped guidance when adopting fragments, using its existing guide/assets as assembly input and preserving originals in the archive. This is a one-time migration handled in the change, not a versioned legacy-provenance mechanism or permanent exemption path.

Historical guides can still be corrected through normal review. No global ID reservation or release-receipt rules constrain those repairs.

## Explicitly excluded

- Audit manifests, hashes, disposition mappings, and historical deletion detection.
- Custom preparation/finalization commands and transactional staging.
- Broader content linting or globally unique historical IDs.
- Release-wide migration tests, candidate installation harnesses, validation receipts, and test-evidence freshness checks.
- Additional tracker/project setup, slice-spec deliverables, mandatory ADR, or formal project close-out as prerequisites of this fix.

Existing per-PR instruction testing, ordinary regression tests for the changed mechanism, and normal repository rules remain in force.
