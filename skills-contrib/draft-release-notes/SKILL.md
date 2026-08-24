---
name: draft-release-notes
description: >-
  Author the committed release-notes file for a Prisma Next release
  (stable or `8.0.0-rc.N`) by enumerating the merged PRs since the previous
  release `v*` tag (stable or `-rc.N`), resolving opaque `TML-NNNN:` titles via Linear context
  (never copied verbatim), triaging public-worthiness, and writing categorized
  notes — breaking changes first — into `docs/releases/v<version>.md` plus a
  mirrored `CHANGELOG.md` entry. Use when cutting a release, when the
  `publish-npm-version` skill reaches its "draft the release notes" step, when
  asked to "draft the release notes", "write the changelog for this release",
  "author docs/releases/v<x>.md", or "summarize what shipped since the last
  release".
---

# Draft release notes

This skill fires inside a release cut (stable or RC-line, both published under `latest`). The release-cutting agent runs it from the `release/<version>` worktree that [`publish-npm-version`](../publish-npm-version/SKILL.md) created, with the target version already known, and produces the committed notes file that **is** the GitHub Release body (the publish workflow ships it verbatim via `gh release create --notes-file docs/releases/v<version>.md`). There is no `--generate-notes` fallback — the file you author here is what every consumer reads.

The skill is **prose-driven**: there is no codemod or script to run. You — the agent — do the enumeration, the Linear-context lookup, the triage, and the writing directly, the same way [`record-upgrade-instructions`](../record-upgrade-instructions/SKILL.md) walks you through authoring an upgrade entry rather than running one for you.

## When to use

Run this skill when **all** of the following hold:

- A release is being cut (stable or `8.0.0-rc.N`) — the target version `$NEXT` is known (computed by `publish-npm-version` step 1, e.g. `8.0.0-rc.2`).
- You are in the `release/<version>` worktree checked out at the bump commit (HEAD carries the bumped root `version`).
- `docs/releases/v$NEXT.md` does not exist yet (the PR-mode release-notes gate, `pnpm check:release-notes --mode pr`, fails the release PR until it does).

Do **not** run it for `-dev.N` or `-beta.N` builds: those create no GitHub Release and are not gated. Do not run it to backfill notes for an already-shipped release — the convention starts from the first release cut after it landed.

## The two hard rules

These are project requirements, not style preferences. A draft that violates either is wrong even if everything else is perfect.

### Rule 1 — Never copy Linear content verbatim

Linear is a **summarization-context input only**. You read a ticket to understand the user-facing outcome of an opaque PR title, then you write a fresh, public, user-facing sentence describing that outcome. You **never** paste ticket prose into the notes. Specifically, the following must never appear in `docs/releases/*.md` or `CHANGELOG.md`:

- Customer names, account names, or any identifying detail of who reported or requested the change.
- Internal rationale, sprint/standup chatter, estimate or priority talk, or links to internal docs.
- The raw `TML-NNNN:` issue prefix or issue title — link the **PR** (`#NNN`) instead.
- Quoted sentences from the ticket body.

If you cannot describe a change for a public audience without leaning on internal context, that is a signal the entry needs rethinking (or is internal-only and should be excluded — see the triage rubric), not a licence to paraphrase the ticket closely. When in doubt, describe only the externally-observable behaviour change.

### Rule 2 — Every line is verifiable

Every entry links its PR (`#NNN`) so the human reviewer can check your one-line summary against the actual diff during the release-PR review. The human review **is** the backstop for triage and summarization judgment calls — write for that reviewer.

## Procedure

### 1. Resolve the range lower bound — the previous *release* tag

The range is "everything since the last release", so the lower bound is the most recent release `v*` tag — stable or `-rc.N` — excluding `-dev.*` / `-beta.*` build tags (an `-rc.N` tag is a release and deliberately **not** excluded, so an RC respin's notes cover exactly what changed since the previous RC):

```bash
PREV_TAG=$(git describe --abbrev=0 --tags --match 'v[0-9]*' --exclude '*-dev.*' --exclude '*-beta.*')
echo "$PREV_TAG"   # e.g. v0.11.0
```

Equivalently, list and filter explicitly (useful when `describe` can't find an ancestor tag):

```bash
git tag --list 'v*' --sort=-v:refname | grep -Ev -- '-(dev|beta)\.' | head
```

The dev/beta exclusion matters: a `-dev.N` tag is cut on most merges, so an unfiltered "previous tag" would scope the range to a single PR. Filtering to release tags gives the full set of changes since consumers last saw a release.

### 2. Enumerate the commit set, then resolve PR metadata

Take the commit set from `git log` and resolve each commit to its PR via `gh`:

```bash
git log --first-parent --oneline "$PREV_TAG"..HEAD
```

For each merged PR in the range, resolve the metadata you need with `gh` / `gh api` — PR number, title, author (login), labels, and whether the author is a first-time contributor:

```bash
# PRs merged in the range (adjust the search window to the range you enumerated)
gh pr list --state merged --base main --limit 200 \
  --json number,title,author,labels,mergeCommit,mergedAt

# Or resolve a single PR by its merge commit:
gh api "repos/prisma/prisma/commits/<sha>/pulls" \
  --jq '.[] | {number, title, author: .user.login, labels: [.labels[].name]}'
```

Use `--first-parent` so squash-merged PRs each show up as one commit; cross-check against `gh pr list` so you do not miss a PR or double-count.

### 3. Resolve opaque titles via Linear context

When a PR title is an internal shorthand (`TML-NNNN: <terse handle>`), read the referenced Linear issue (via the Linear MCP) to understand **what changed for the user**. This is enrichment only — re-read Rule 1 before writing anything. Summarize the outcome in your own public words; cite the PR, never the ticket.

### 4. Triage public-worthiness

Decide, per PR, whether it earns a line in the public notes. The rubric biases toward a clean, user-facing changelog over exhaustiveness — the human PR review is the backstop for judgment calls.

**Always include:**

- Anything flagged **breaking**.
- Anything touching the **public surface**: package exports (`@internal/*` public API), CLI commands/flags, `prisma.config.ts` fields, the contract format (`contract.json` / `contract.d.ts` shape), on-disk migration shape, or error codes.

**Default-exclude unless user-relevant:**

- Pure-internal refactors with no observable behaviour change.
- CI / workflow / tooling changes.
- Test-only PRs.
- Chore / dependency bumps (include only if a bump changes user-observable behaviour or a peer requirement).
- Doc-only changes (include only if they document a user-facing behaviour change worth surfacing).

Excluded PRs are dropped silently — no "internal changes" catch-all section. If a default-exclude PR has a genuine user-facing consequence, include it and describe that consequence.

### 5. Categorize into the fixed section order

Write the entries under the fixed section order from [`docs/releases/README.md`](../../docs/releases/README.md), **omitting any section with no entries**:

1. **Breaking changes** — API removals/renames, semantic changes to existing APIs, contract-format changes. Say what the reader must *do*, not just what changed.
2. **Features** — new capabilities.
3. **Fixes** — bug fixes.
4. **New contributors** — first-time contributors, with the PR that welcomed them.

Breaking changes lead because they are what a reader scanning the notes most needs to see. Every line links its PR as an **absolute markdown link** — `[#NNN](https://github.com/prisma/prisma-next/pull/NNN)`, never bare `#NNN`. Bare references only autolink inside the GitHub Release body; they render as plain text when the committed `docs/releases/v<version>.md` is read as a repo file or in PR review, so the explicit link form is what makes every reference work in every context.

### 6. Anchor breaking-change entries to their migration recipe

A breaking change shipping in this release has a matching upgrade-instructions directory keyed to the minor transition, following the convention enforced by [`scripts/check-upgrade-coverage.mjs`](../../scripts/check-upgrade-coverage.mjs) and authored via [`record-upgrade-instructions`](../record-upgrade-instructions/SKILL.md). The transition label is `<prev.major>.<prev.minor>-to-<head.major>.<head.minor>` — computed from the **previous stable tag's** minor and `$NEXT`'s minor (e.g. `v0.11.0` → `0.12.0` gives `0.11-to-0.12`). Point the breaking note at the recipe directory rather than restating the migration.

**Recipe links must be absolute, tag-pinned URLs** — `https://github.com/prisma/prisma/blob/v$NEXT/...`. The notes file becomes the GitHub Release body via `--notes-file`, and the Release page does **not** reliably resolve repo-relative links, so a relative recipe path would publish as a dead migration link. Pinning to the release tag (`/blob/v$NEXT/`) means the link always resolves and never rots as the recipe tree evolves on `main`:

- User-facing migrations: `https://github.com/prisma/prisma/blob/v$NEXT/skills/prisma-8/upgrading/app/upgrades/<prev.minor>-to-<head.minor>/`
- Extension-author migrations: `https://github.com/prisma/prisma/blob/v$NEXT/skills/prisma-8/upgrading/extension/upgrades/<prev.minor>-to-<head.minor>/`

A breaking change can affect one or both audiences — link whichever recipe directories exist.

**If the recipe directory is absent**, do not fail authoring: still list the breaking change and describe the required action inline. The missing recipe is `check:upgrade-coverage`'s concern to enforce, not this skill's.

For a **skipped-publish range** (more than one minor in this release — see graceful degradation below), the recipe is a *chain* of consecutive transition directories (e.g. `0.11-to-0.12` + `0.12-to-0.13` for a `v0.11.0` → `0.13.0` publish), mirroring how `check-upgrade-coverage` aggregates the chain. Anchor each breaking entry to the step that introduced it.

### 7. Show the impact of code-visible breaking changes with a before/after example

Prose tells a reader *that* something changed; a short before/after snippet shows them *what it looks like*, which is what they actually need to act. For the most code-visible breaking changes — contract-shape changes, authoring-surface changes, runtime-option or builder-API changes — nest a compact `before` / `after` example under the prose bullet.

- **Source it from the recipe, don't invent it.** The matching `<prev.minor>-to-<head.minor>` upgrade recipe (authored via [`record-upgrade-instructions`](../record-upgrade-instructions/SKILL.md)) already contains authoritative before/after migration code — lift the snippet from there so it stays accurate. If the change is only visible in the emitted `contract.json` / `contract.d.ts`, a minimal shape diff from the recipe or the PR diff is fine.
- **Keep it tight.** A few lines before, a few lines after — enough to show the shape, not the whole file.
- **Lead with PSL.** When the change is on the authoring surface, write the example in PSL (```` ```prisma ````, never ```` ```psl ````), per the repo's authoring-surface convention. Use TS or JSON only when the change is genuinely a TS-surface change (a builder/runtime option, a consumer reading the emitted `.d.ts`) or an emitted-shape change with no PSL form.
- **Skip operational-only breaks.** Version-floor bumps, peer-dependency changes, and package removals/extractions have no illuminating code diff — prose suffices for those.

The format is the prose bullet, then the nested example:

````md
- **<title>** — <what changed and what the reader must do; recipe link>. ([#<pr>](https://github.com/prisma/prisma-next/pull/<pr>))

  Before:

  ```ts
  …
  ```

  After:

  ```ts
  …
  ```
````

### 8. Attribute contributors

Preserve the "New contributors" credit that `--generate-notes` gave for free. Each first-time contributor gets a line naming the PR that welcomed them, with both the handle and the PR as absolute links:

```md
- [@<handle>](https://github.com/<handle>) made their first contribution in [#<pr>](https://github.com/prisma/prisma-next/pull/<pr>)
```

Resolve first-time status from PR author metadata (e.g. `gh api` `author_association` of `FIRST_TIME_CONTRIBUTOR` / `FIRST_TIMER`, or by checking whether the author appears in the range before this PR).

### 9. Write the notes file and prepend the CHANGELOG

Fill the [`docs/releases/README.md`](../../docs/releases/README.md) template into `docs/releases/v$NEXT.md`:

````md
# v<version>

<optional one- or two-sentence summary of the release's theme>

## Breaking changes

- **<short title>** — <what changed and what the reader must do; link the upgrade recipe>. ([#<pr>](https://github.com/prisma/prisma-next/pull/<pr>))

  Before:

  ```ts
  <old shape>
  ```

  After:

  ```ts
  <new shape>
  ```

## Features

- <new capability>. ([#<pr>](https://github.com/prisma/prisma-next/pull/<pr>))

## Fixes

- <bug fix>. ([#<pr>](https://github.com/prisma/prisma-next/pull/<pr>))

## New contributors

- [@<handle>](https://github.com/<handle>) made their first contribution in [#<pr>](https://github.com/prisma/prisma-next/pull/<pr>)
````

Then **prepend** a `## v$NEXT` entry to [`CHANGELOG.md`](../../CHANGELOG.md), mirroring the notes-file body (newest-first). The CHANGELOG is a plain newest-first mirror — no second authoring format, no "Keep a Changelog" headers; copy the section bodies under the `## v$NEXT` header at the top of the entry list (below the file's intro and the `<!-- New release entries go here … -->` marker).

### 10. Commit on the release branch

Commit the notes file + CHANGELOG as their **own** commit on the `release/<version>` branch (keeping `publish-npm-version`'s `chore(release): bump` commit clean), so the notes ride in the bump PR diff and satisfy the `check:release-notes` PR-mode gate. Use explicit staging and sign off:

```bash
git add docs/releases/v$NEXT.md CHANGELOG.md
git commit -s -m "docs(release): add release notes for v$NEXT"
```

Control then returns to `publish-npm-version` for the push + PR-open steps.

## Graceful degradation

- **Linear unavailable, or a PR has no Linear ticket.** Linear is enrichment, not a hard dependency. Summarize the change from the PR title + diff alone. Never block authoring on Linear.
- **No prior stable tag (first release under this convention).** If `git describe` finds no stable `v*` tag, fall back to the earliest tag or the repo root and note in the summary that this is the first curated release; enumerate the whole range.
- **Skipped-publish multi-minor range.** If the previous stable tag is more than one minor behind `$NEXT` (a minor was bumped in-tree but never shipped), enumerate across the *whole* range and treat breaking-change anchoring as a chain of consecutive transition directories, mirroring `check-upgrade-coverage`'s skipped-publish handling.
- **Symlink trees may be absent in the release worktree.** `publish-npm-version` runs `pnpm install --frozen-lockfile --ignore-scripts`, so the `.claude/` / `.agents/` skill mirrors may not be materialized there. This skill is invoked by reading its canonical path, `skills-contrib/draft-release-notes/SKILL.md`, which exists in the checkout regardless.

## Out of scope

- **The publish-time presence gate and `--notes-file` wiring** (`scripts/check-release-notes.mjs`, `.github/workflows/`). This skill *produces* the file; the gate and workflow *consume* it.
- **Wiring this skill into `publish-npm-version`** and updating `docs/oss/versioning.md` — handled separately; this file is the authoring logic only.
- **Dev/beta release notes.** Those builds create no GitHub Release.
- **Backfilling notes for already-shipped releases.**
- **A `.github/release.yml` label config or any third-party release-notes tool.** Categorization is done here, by reasoning over the diff + Linear context — not from PR labels or an external generator.

## Worked example

Cutting `v0.12.0` from `origin/main` (previous stable tag `v0.11.0`).

1. `PREV_TAG=$(git describe --abbrev=0 --tags --match 'v[0-9]*' --exclude '*-dev.*' --exclude '*-beta.*')` → `v0.11.0`.
2. `git log --first-parent --oneline v0.11.0..HEAD` lists 14 merged PRs. `gh pr list --state merged --base main --json number,title,author,labels,mergedAt` resolves their metadata.
3. PR #1240's title is `TML-2536: contract deserializer seam`. Read TML-2536 in Linear → the user-facing outcome is "contract deserialization now goes through an explicit adapter seam". Write that outcome in public words; cite #1240, not TML-2536.
4. Triage: #1240 changes the contract format → **always-include, breaking**. A CI-cache tweak (#1237) and a test-only refactor (#1239) → **default-exclude**, dropped silently. A new `includeMany` capability (#1234) → feature. A null-handling bug fix (#1242) → fix. First-time contributor @somebody on #1238.
5. Categorize: Breaking changes (#1240) → Features (#1234) → Fixes (#1242) → New contributors (@somebody, #1238).
6. The breaking change's transition is `0.11-to-0.12`. The recipe dir `skills/prisma-8/upgrading/app/upgrades/0.11-to-0.12/` exists in the checkout → the breaking note links it as a tag-pinned URL, `https://github.com/prisma/prisma/blob/v0.12.0/skills/prisma-8/upgrading/app/upgrades/0.11-to-0.12/`. (If it were absent, the note would describe the required adapter migration inline instead.)
7. #1240 is a code-visible contract-shape/runtime change, so it earns a before/after example — lifted from the `0.11-to-0.12` recipe (a TS runtime change, so a `ts` fence). @somebody's contributor line, with absolute links: `- [@somebody](https://github.com/somebody) made their first contribution in [#1238](https://github.com/prisma/prisma-next/pull/1238)`.
8. Write `docs/releases/v0.12.0.md` (every PR ref + handle an absolute link; the breaking entry carries a before/after):

````md
# v0.12.0

Contract deserialization gains an explicit adapter seam, and queries can now eager-load related records.

## Breaking changes

- **Contract deserialization requires an adapter seam** — deserialization now goes through an explicit seam adapter; existing code must register one. See the [0.11-to-0.12 upgrade recipe](https://github.com/prisma/prisma-next/blob/v0.12.0/skills/prisma-8/upgrading/app/upgrades/0.11-to-0.12/). ([#1240](https://github.com/prisma/prisma-next/pull/1240))

  Before:

  ```ts
  const contract = deserializeContract(json);
  ```

  After:

  ```ts
  const contract = deserializeContract(json, { adapter: postgresAdapter });
  ```

## Features

- `includeMany` eager-loads related records in a single query. ([#1234](https://github.com/prisma/prisma-next/pull/1234))

## Fixes

- Null values in `returning()` projections no longer throw. ([#1242](https://github.com/prisma/prisma-next/pull/1242))

## New contributors

- [@somebody](https://github.com/somebody) made their first contribution in [#1238](https://github.com/prisma/prisma-next/pull/1238)
````

   Then prepend the same body under `## v0.12.0` to `CHANGELOG.md`.

9. `git add docs/releases/v0.12.0.md CHANGELOG.md && git commit -s -m "docs(release): add release notes for v0.12.0"`.

## Reference

- [`docs/releases/README.md`](../../docs/releases/README.md) — the committed-notes-file convention, the no-fallback design, the section order, and the template this skill fills.
- [`CHANGELOG.md`](../../CHANGELOG.md) — the rolling newest-first mirror this skill prepends.
- [`publish-npm-version`](../publish-npm-version/SKILL.md) — the release-cut skill that invokes this one from the `release/<version>` worktree.
- [`record-upgrade-instructions`](../record-upgrade-instructions/SKILL.md) — the breaking-change upgrade-recipe authoring flow whose `upgrades/<prev.minor>-to-<head.minor>/` directories the breaking-change section anchors to.
- [`scripts/check-upgrade-coverage.mjs`](../../scripts/check-upgrade-coverage.mjs) — the transition-label convention (`<major>.<minor>-to-<major>.<minor>`) and skipped-publish chain handling.
- [`docs/oss/versioning.md`](../../docs/oss/versioning.md) — the version contract and release procedure these notes are part of.
- Linear ticket: [TML-2758](https://linear.app/prisma-company/issue/TML-2758).
