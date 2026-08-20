---
name: create-pr
description: Creates a GitHub PR with a Linear-ticket-prefixed title and a decision-led, narrative description for prisma-next. Use when the user wants to create a pull request, open a PR, or submit changes for review.
---

# Create PR Skill

## Instructions

### Step 1: Gather Context

Detect the PR's base branch instead of hardcoding `main`. Set `BASE_BRANCH` once and reuse it in every diff/log command:

```bash
BASE_BRANCH=$(git rev-parse --abbrev-ref origin/HEAD 2>/dev/null | sed 's@^origin/@@')
BASE_BRANCH=${BASE_BRANCH:-main}
```

`git rev-parse --abbrev-ref origin/HEAD` returns the remote's default branch (e.g. `origin/main`); the `sed` strips the `origin/` prefix. The fallback to `main` covers repos where `origin/HEAD` is unset. If you know the PR was branched off a non-default branch, override `BASE_BRANCH` explicitly before running the commands below.

1. Run `git log "$BASE_BRANCH..HEAD" --oneline` to see all commits on the current branch (fallback: `git log "origin/$BASE_BRANCH..HEAD" --oneline`).
2. Run `git diff "$BASE_BRANCH...HEAD" --stat` to see which files changed (fallback: `git diff "origin/$BASE_BRANCH...HEAD" --stat`).
3. Run `git diff "$BASE_BRANCH...HEAD"` to read the full diff (fallback: `git diff "origin/$BASE_BRANCH...HEAD"`).
4. Check for local-only changes that won't be in the PR unless committed:
   - `git status -sb`
   - If there are uncommitted changes, explicitly call out that `gh pr create` can proceed but those changes will not be in the PR.

### Step 2: Resolve the Linear Ticket

Resolve the Linear ticket from context — **do not ask the user**. The ticket is almost always derivable from one of:

1. **The branch name.** Most branches are named `tml-NNNN-…` (lower-case form of the Linear identifier). The current ticket is whatever matches `(?i)\b(TML-\d+)\b` in `git rev-parse --abbrev-ref HEAD`. Use the trailing slug from the branch name verbatim as `$SLUG`.
2. **The conversation context.** If the user previously linked or named a ticket in this conversation, use that.
3. **The most recent commit messages on the branch.** Look for a `Refs: TML-NNNN` or `(TML-NNNN)` trailer / mention in `git log "$BASE_BRANCH..HEAD"`.

Extract:
- `$TICKET_ID` — the canonical upper-case identifier (e.g., `TML-1859`)
- `$SLUG` — the trailing slug used in Linear URLs (e.g., `pn-add-more-parameterized-types`); take it directly from the branch name's trailing portion when available

Only ask the user if **all three** sources fail to yield an identifier. In that case, ask once with a concrete proposal (e.g. "I couldn't infer a Linear ticket from the branch `xyz` or the recent commits — which ticket does this PR close?").

### Step 3: Compose the PR Title

Format:

```text
$TICKET_ID: <concise title in sentence case>
```

Rules:
- Always start with the Linear ticket ID followed by `:` then a single space.
- Sentence case after the colon (capital first letter; rest lowercase except proper nouns, package names, types, etc.).
- No period at the end.
- Aim for under 70 characters total. Optimise for **information density**, not raw character count — a slightly longer title that names the concrete deliverable is better than a short abstract one.
- The title must convey **what concrete thing changed**, not just an abstract scope. A teammate scanning a list of PR titles should be able to tell what this PR delivers without opening it.
  - Bad: `TML-2375: expand pgvector type and operator surface` (abstract)
  - Good: `TML-2375: 5 new pgvector operator descriptors + HNSW index support` (concrete)
- If the change spans multiple packages or layers, name the headline package or capability, not all of them. Secondary scopes belong in the body.

Examples:
- `TML-1859: add text codec support to sql-runtime`
- `TML-2104: handle null in jsonb columns (postgres adapter)`
- `TML-2375: 5 new pgvector operator descriptors + HNSW index support`
- `TML-2456: split contract emission into two phases`

### Step 4: Compose the PR Description

The PR description must follow a **decision-led, narrative** structure. A teammate without prior context on the work should be able to read it top-to-bottom and understand what we decided, why, and how it fits together — without being overwhelmed by file lists or alternatives we ultimately rejected.

#### Consult the PR template

Read `.github/PULL_REQUEST_TEMPLATE.md` once before drafting. The template's required headers (today: `## Linked issue`, `## Summary`, `## Testing performed`, `## Skill update`, `## Checklist`, `## Notes for the reviewer`) must appear in the final body even when the skill's recommended structure below doesn't list them. Where the template and the skill overlap, use the template's richer header (e.g. `## Linked issue` — with a `Refs:` link and any prerequisite-PR / follow-up-PR context — replaces the bare close-line at the top).

#### Required structure (in this order)

1. **`## Linked issue`** — the template header, used instead of a bare close-line. The template asks for a GitHub issue here; a maintainer PR puts the Linear ticket in the same place: a single `Refs [$TICKET_ID](https://linear.app/...)` link, plus `Fixes #N` as well when a GitHub issue exists, plus links to any prerequisite or follow-up PRs and the Linear tickets they close. Keep it short — three lines max.

   **`## Skill update`** — name the agent skill the change teaches. Reserve `n/a — internal only` for changes that are purely internal or a refactor with no user-visible delta; a user-facing change that teaches no existing skill still needs a sentence saying why no update is required. The template checklist asks you to confirm this section, so a body without it cannot tick that box truthfully.

2. **`## At a glance`** — a copy-pasteable code sample from real code in the branch (not invented, not pseudocode) that demonstrates the change in user-observable terms. Below the code, one short sentence that grounds the "before" state if relevant.

   - The snippet must be small enough to absorb in 10 seconds but rich enough to convey what's new. Prefer a real call-site, contract emission, query, or output shape.
   - If the change is genuinely impossible to demonstrate in code (rare — even a refactor usually changes a signature), substitute a minimal representative diff or output sample. Do **not** open with abstract prose.
   - For PRs that ship a system rather than a behavior change (e.g. a new agent skill, a new CI gate, a new mechanism), the at-a-glance can show the artefact's *eventual* on-disk shape with a one-line note that the PR ships a placeholder. The point is grounding, not literal accuracy.

3. **`## Decision` (or `## The decision`)** — lead with what we decided. State the deliverable in one paragraph or a short numbered list. If the PR carries more than one substantive piece (e.g. a feature + an enabling framework change), enumerate them so the reader can't miss any. Link to ADRs inline at the points they matter.

4. **`## How it fits together`** — the narrative, built bit by bit. 3–6 numbered steps that walk the reader from substrate to delivery. Each step should have a clear job (e.g. "lift the substrate", "add the codecs", "widen the operator surface", "prove against live infra"). Inline ADR links where relevant.

   - **Multi-flow variant:** if the system has multiple semi-independent flows (e.g. a user flow + an author flow + an enforcement mechanic), use multiple `## How X works` subsections instead of one `## How it fits together`. One subsection per flow, in the order a reader would learn the system.

5. **`## Behavior changes & evidence`** — one bullet per observable change. Each bullet:
   - Leads with the change in plain, user-observable language.
   - Anchors to **1–3 implementation files** (not all of them) using GitHub-friendly relative links.
   - Cites **1–2 evidence files** (tests / fixtures / e2e).
   - Avoid dumping every file in the package. The change map should be distributed across these bullets, not pasted as a separate section.
   - **System-design variant:** if the PR ships a mechanism without yet shipping observable behavior (e.g. dormant CI gate, placeholder content), replace this section with `## What lands in this PR` and a short commit-by-commit table (commit subject + one-line "what it adds"). Mention the AC count + link to the spec for the scoreboard; do not paste raw AC-IDs.

6. **`## Reviewer notes`** (the gotchas) — strongly recommended. The 3–6 things you most expect a careful reviewer to push back on, surfaced proactively. Things that belong here:
   - Largest commit / largest diff and what to spot-check.
   - Decisions that look surprising on the diff but are deliberate (and why).
   - Pre-existing flakes / out-of-scope footnotes the reviewer will otherwise raise.
   - Pre-existing issues surfaced but not fixed in this PR; flagged as follow-up.
   - Project artefacts left on disk for review and their close-out plan.

   Place this near the top of the long-form sections — it's the most useful section to a skimming reviewer, so don't bury it after every other section.

7. **`## Compatibility / migration / risk`** — SPI / API / behavioral compatibility notes. For small PRs, fold this into `## Reviewer notes` instead of carrying it as its own section.

8. **`## Verification`** (or `## Testing performed` per the template) — list the suites you ran on the final HEAD, one per line, with the count of cases / tasks where useful. Note any flakes that reproduced and were ruled pre-existing.

9. **`## Follow-ups`** — Linear tickets or doc notes for deferred work. Skip if there are none; don't pad.

10. **`## Alternatives considered`** — final section. Each bullet names an alternative we genuinely weighed and why we didn't take it. Pull alternatives forward from any ADRs or design discussions so the reader doesn't have to click through. Frame as alternatives (decisions we made), not as "non-goals" (scope statements).

11. **`## Checklist`** — the template's checklist, with each item marked `[x]` only if true. Common items: DCO sign-off, CONTRIBUTING.md read, tests updated, title in the prevailing convention.

#### Forbidden / discouraged patterns

- **Don't open with abstract prose.** The body opens with the Linear close line, immediately followed by `## At a glance` and its concrete code sample. No "Intent" paragraph in between.
- **Don't paste a "Change map" section near the top** that lists every file. File links belong distributed across the narrative steps and behavior bullets where they have context.
- **Don't dump file paths in behavior bullets.** Each bullet gets at most ~3 implementation anchors and ~2 evidence anchors. If a section needs more, it's two changes — split the bullet.
- **Don't bury major decisions inside other sections.** If the PR carries a substantive framework change alongside a feature, the framework change must be enumerated in `## Decision` so a reader can't skim past it.
- **Don't conflate "non-goals" with "alternatives considered".** Non-goals are scope statements ("we didn't ship X"); alternatives are decisions ("we considered X and chose Y because Z"). The PR ends with the latter.
- **Don't include reviewer-coaching phrases** ("anchor", "read this first", "tl;dr"). Write like a normal narrative.
- **Don't paste auto-generated review-tool comments** in the body you author. They're appended automatically by bots after creation.

#### Drafting workflow

1. Run the `drive-pr-walkthrough` skill for the current branch vs base (default: `origin/main...HEAD`) and write `walkthrough.md` to disk. That skill lives in [prisma/ignite](https://github.com/prisma/ignite), not in this repo. If it is not installed, either install it with `npx skills add prisma/ignite/skills/.pilot --skill '*'` (the command the root `CLAUDE.md` documents) or derive the walkthrough from the diff yourself. The walkthrough provides raw material — narrative steps, behavior changes, evidence links — but its default section order is **not** the PR shape. You will restructure it.
2. Write the PR body to disk as a working file (e.g. `wip/pr-<num>-body.md`) following the **Required structure** above. Reuse the walkthrough's narrative, behavior bullets, and evidence links where they fit; restructure to lead with the code sample and the decision, and to end with alternatives.
3. **Adjust links for GitHub**:
   - Keep helpful link text (file paths, optionally line ranges).
   - Use GitHub-friendly relative paths (e.g. `path/to/file.ts`); strip local-editor suffixes like `:12-34`.
4. Apply the **forbidden / discouraged patterns** check above to the draft.
5. Run the **fresh-eyes self-review** (Step 5) as a separate pass — it catches structural problems the forbidden-patterns check doesn't (buried lead, ungrounded jargon, alternatives-up-front).

### Step 5: Fresh-eyes self-review

Before pushing, do a fresh-eyes pass on the draft body. Imagine you're a teammate without context on the design discussion. The skill's "decision-led, narrative" structure is a target shape; this step is the gate that catches cases where the first draft missed it.

For each check, if it fails, **rewrite the draft** before pushing — don't ship and rely on review feedback to catch it.

- **Grounding first.** Does the body open with a concrete artefact (code sample, real on-disk shape, CLI invocation) within the first screenful, after `## Linked issue`? If a fresh reader would have to read 3+ paragraphs of decision-prose before seeing a real example, the grounding is missing.
- **Lead with the decision.** Is the headline sentence — *"this PR ships X"* — present and unmissable in `## Decision`? If the deliverables are diffused across bullets and a reader can't pin down "what's being shipped" on first scan, the lead is buried.
- **Alternatives at the end, not the start.** Each "we did X, which avoids Y" sentence is rationale relative to a thing the reader has now seen. If the rationale appears *before* the reader sees what we built, it adds cognitive load (now they have rejected alternatives to model alongside the actual deliverable). Move all such content to `## Alternatives considered`.
- **Jargon grounded by example.** Project-internal terminology (e.g. "co-shipping discipline", "in-flight minor", "transition-label split") is fine *iff* the at-a-glance / how-it-works sections have introduced the underlying mechanic first. Otherwise it's noise to a fresh reader.
- **Reviewer notes near the top.** If you have "the gotchas" content, is `## Reviewer notes` placed before the long-form sections (e.g. `## What lands in this PR`, `## Verification`)? It's the most useful section to a skimming reviewer.
- **Don't presuppose the spec.** Phrasings like "the decisions that shape this PR", raw AC-IDs (`AC22, AC23, AC28`) or FR-IDs (`FR21`), or "the spec calls out" presuppose the reader has read the spec. Either rephrase ("we built X because Y") or summarise as a count + link to the spec.
- **No duplicate content with the commits.** A `## What lands in this PR` commit table is fine, but don't *also* paste a "Change map" listing every file. Pick one summary surface; let the diff carry the rest.

### Step 6: Push and Create

Open the PR directly — **do not ask the user to confirm the title or body first**. The skill's quality bar is the structure, the forbidden-patterns checklist, and the fresh-eyes pass; running through those in your own head is the gate, not a confirmation prompt. (If the user wants changes after the fact, they will tell you and you can edit the PR via `gh pr edit`.)

1. **DCO sign-off check.** Before pushing, verify every commit has a `Signed-off-by:` trailer — the prisma-next PR template's checklist requires it and the DCO status check will block merge:

   ```bash
   git log "$BASE_BRANCH..HEAD" --format='%h %s%n  %(trailers:key=Signed-off-by,valueonly)'
   ```

   If any commit shows an empty `Signed-off-by` line, retroactively sign every commit:

   ```bash
   git rebase --signoff "$BASE_BRANCH"
   ```

   This rewrites SHAs, which is safe pre-push. After the rebase, push as normal.

2. Ensure the branch is pushed to remote (`git push -u origin HEAD` if needed).
3. Create the PR using the body file:

   ```bash
   gh pr create --title "$TICKET_ID: <title>" --body-file wip/pr-<num>-body.md
   ```

   (Use `--body-file` rather than a heredoc to avoid quoting/escaping pitfalls with backticks and code samples. Stage the body file under `wip/` — gitignored — so the live PR matches what the user reviewed.)

4. Return the PR URL to the user.

## Don't Do

1. Don't paste diff stats or long file lists — focus on intention and semantics.
2. Don't write reviewer-coaching phrases ("anchor", "read this first", etc.). Prefer a normal narrative.
3. Don't open the description with prose — after `## Linked issue`, the body must move straight into `## At a glance` and its real code sample.
4. Don't bury substantive secondary changes (e.g. framework reorders alongside a feature) — enumerate them in `## Decision`.
5. Don't end the description with "non-goals" — end with `## Alternatives considered`, framed as decisions you weighed.
6. Don't ask the user to confirm the PR title or body — open the PR. They can ask you to edit it after.
7. Don't ask the user for the Linear ticket — infer it from the branch name, conversation, or recent commits per Step 2. Only ask if all three sources genuinely fail.
8. Don't use the conventional-commit `type(scope):` title format — that's the old format. The current format is `$TICKET_ID: <title>`.
9. Don't presuppose the spec. Avoid raw `AC-NN` / `FR-NN` IDs, "the spec calls out", "as the spec promises", and similar phrasings — a fresh reader doesn't have the spec to hand. Either rephrase to plain language or link to the spec the first time the term appears.
10. Don't put alternatives anywhere but `## Alternatives considered`. "We did X to avoid Y" rationale is alternatives content; it adds cognitive load when it appears before the reader has seen what we built.
11. Don't push without checking DCO sign-off (Step 6.1). Catching it after the PR is open creates a noisy force-push and a churn cycle on the DCO check.
