---
name: record-gotchas
description: Capture surprises, workarounds, and rough edges hit while *consuming* the public surface of Prisma Next, Prisma Compute, or Prisma Postgres — anything a real user of these products would experience. Fires whenever an operator (or agent) writes a workaround, hits a surprising failure mode, or finds undocumented behaviour while using one of these three products from the outside (extension authoring, example apps, integration tests, customer reproductions, internal demos, manual repros). Does NOT fire on bugs in code the operator's own team maintains — those are normal product-backlog bugs. In product-team repos (e.g. `prisma-8-ws`), surfaces the gotcha and offers the operator three paths (capture-as-gotcha, file a normal bug, or note-and-move-on). Outside product-team repos (pet projects, hackathon entries, customer codebases), silent-captures into the project's gotchas log AND a Triage-state Linear ticket in the matching gotchas project — no operator escalation. Do not skip the recording step.
---

# Record a gotcha

A **gotcha** is friction that a *consumer* of Prisma Next, Prisma Compute, or Prisma Postgres would feel — something an external user of those products would also experience: a surprising failure mode, an undocumented behaviour, a workaround you wrote, a mental model mismatch with the CLI / runtime / docs. The signal is the consumer's perspective, not the project context — you can hit a gotcha while writing an extension, working in an example app, reproducing a customer report, running an integration test against the public surface, or building anything that consumes the product from the outside.

A gotcha is **not** a bug in code your team maintains. If you own the surface and you can fix it, that's a normal product bug, filed in the regular product backlog — not a gotcha.

This skill is the canonical workflow for capturing gotchas. When the trigger fires:

1. Determine whether you're in a product-team repo or somewhere else — the escalation mode depends on it (see § Escalation mode).
2. Write a short entry to the matching gotchas log (`gotchas.md` or a per-product file).
3. File a Triage-state ticket in the matching `*-gotchas` Linear project.
4. Cross-link the two so future readers can navigate either way.

When in doubt about whether something is gotcha-worthy, capture it. The cost of a near-duplicate entry is trivial; the cost of losing the learning is permanent.

> **This skill is not optional for qualifying gotchas.** If you wrote a workaround, consulted source code, or hit a behaviour that didn't match the docs while consuming the product, run this skill before the conversation ends.

---

## Consuming vs. maintaining — the boundary

The trigger depends on the *role* the operator is wearing in the moment, not on the repo they're sitting in.

| You're doing… | Role | Trigger fires? |
|---|---|---|
| Writing a new extension that uses PN's authoring API | Consuming | Yes |
| Working in an example app under `examples/` and hitting a CLI / runtime rough edge | Consuming | Yes |
| Reproducing a customer's bug report against the public surface | Consuming | Yes |
| Running an integration test that exercises the public CLI / runtime | Consuming | Yes |
| Building an internal demo with PN / Compute / PPg | Consuming | Yes |
| Fixing a bug in PN core | Maintaining | No — file a normal bug |
| Adding a feature to PN's runtime | Maintaining | No |
| Refactoring an internal package | Maintaining | No |

**Worked example.** You change `schema.prisma`, run `prisma migration plan`, and the CLI reports *"No changes detected"* — because the contract was stale and you hadn't run `contract emit`. The CLI's mental model didn't match yours; a real user would hit this. That's a gotcha, even though you're sitting in `prisma-8-ws` and could fix it: you were *consuming* the migration workflow, not maintaining it.

**Ambiguous cases default to capture.** If you can't tell which role you were in, capture the gotcha. The team filters at triage.

---

## Hard prerequisite: Linear MCP

This skill **requires** the Linear MCP plugin to be installed and authenticated. Without it, ticket filing is impossible and the workflow is incomplete.

**If the Linear MCP plugin is not available or not authenticated, halt and tell the operator** something like:

> I just hit a gotcha I'd like to record, but the Linear MCP plugin isn't available. Please install and authenticate the Linear MCP plugin (`plugin:linear:linear` in Claude Code; the [Linear plugin for Cursor](https://cursor.com/plugins/linear)), then re-run the request. The skill needs to file a Triage-state ticket in the matching Prisma gotchas project.

Do not proceed. Do not write the file entry without the ticket. The two halves are intentionally coupled — the file is the local record; the ticket is the team's signal. Both must exist for the pipeline to work.

---

## The three products and their Linear projects

Each product has a single Linear project for *all* tickets — both gotchas and normal bugs. Gotchas and normal bugs are distinguished by **status / labels**, not by which project they're filed in.

| Product | Linear project |
|---------|----------------|
| **Prisma Next** ORM (`@internal/*`, schema, generated client, migration tooling) | [`pn-gotchas`](https://linear.app/prisma-company/project/pn-gotchas-a6f6f5157a5c/overview) |
| **Prisma Compute** (`@prisma/compute-cli`, deploy, runtime, env management) | [`compute-gotchas`](https://linear.app/prisma-company/project/compute-gotchas-dd3ac34b5ad4/overview) |
| **Prisma Postgres** (PPg, `@prisma/dev`, dialect behaviour) | [`ppg-gotchas`](https://linear.app/prisma-company/project/ppg-gotchas-afe77336f696/overview) |

**Filing convention.**
- **Gotcha:** status `Triage`, no priority, no labels — the project itself is the dogfood filter.
- **Normal bug:** filed in the same project, but follow the product team's regular conventions (status, priority, labels). Used when the operator's team owns the issue and wants it in the regular triage flow rather than the dogfood lens.

The project names retain the `-gotchas` suffix for historical reasons; treat them as the canonical Linear project for each product regardless.

If a gotcha straddles two products, pick the surface where you were when it bit, file there once, and mention the second product in the body.

If you find yourself wanting to file a gotcha for a fourth product (Eclipse, Slack, Bun, Next.js, etc.), **stop**. This skill is scoped to the three Prisma products. Other tools' bugs go in those tools' own issue trackers. Exception: if a third-party bug only surfaces *because of* how a Prisma product is structured, record it on the Prisma side and link the third-party tracker.

**Where to record locally**, in priority order:

1. If `docs/prisma-8-gotchas.md`, `docs/compute-gotchas.md`, or `docs/ppg-gotchas.md` exist — append to the matching one.
2. Otherwise, append to `gotchas.md` at the repo root. Create it (using the bootstrap template below) if missing.

---

## Escalation mode (product-team repo vs. elsewhere)

How the agent behaves when the trigger fires depends on **which repo it's in**:

- **Product-team repo** (e.g. `prisma-8-ws`, the Compute workspace, the PPg workspace) → **surface the gotcha and offer three paths.** The operator is likely on the affected product's team and is in a position to decide whether this is gotcha-worthy, a regular bug, or already known. Don't capture silently — ask.
- **Any other repo** (customer pet projects, hackathon entries, internal demos, sandbox repos) → **silent capture.** Run the gotcha workflow without escalating. The operator is consuming the product as an outsider; the dogfood signal is exactly the friction they would otherwise not formalize.

If you can't tell which kind of repo you're in, treat it as "other" — silent capture is the safer default for a dogfood pipeline.

### The three paths (product-team repos only)

Surface the gotcha to the operator in one short message — symptom, hypothesis on cause, the workaround you used or are about to use — then offer:

1. **Capture as gotcha** — run the full gotcha workflow below (file entry + ticket filed in `Triage` status, no priority, no labels). The default when the operator wants the team to see this through a dogfood lens.
2. **File a normal bug** — the agent files a regular ticket in the same product Linear project on the operator's behalf, but following the team's normal-bug conventions rather than the gotcha filing convention. Used when the operator's team owns the issue and wants it in the regular triage flow.
3. **Note-and-move-on** — do nothing further. Used when the operator already knows about the issue or it's not worth recording. The agent acknowledges and drops it.

The operator picks. Default to capture-as-gotcha if the operator doesn't choose.

---

## When NOT to use

Skip this skill for:

- **Bugs in code the operator's own team maintains.** This is the consuming-vs-maintaining boundary. File a normal bug in the product's Linear project (using the team's normal-bug filing convention, not the gotcha-Triage one) instead.
- **Subjective preferences** ("I'd prefer the CLI used `--service` instead of positional"). File feature requests in Linear directly, not as gotchas.
- **Bugs in third-party tools** (Bun, Next.js, `pg`, Slack, etc.) — those go in the relevant tool's tracker. Exception: if the third-party bug only surfaces *because of* how a Prisma product is structured, record it on the Prisma side and link the third-party tracker.
- **Misunderstandings on your end that the docs already cover.** Re-read the docs first. Honest self-test: if the answer is in the docs and you missed it, that's not a gotcha.

---

## Workflow

Numbered, in order. Don't skip steps; the value comes from doing all of them.

### 1. Verify Linear MCP is available

If the Linear MCP plugin isn't installed or isn't authenticated, halt per § Hard prerequisite.

### 2. Identify the product

Use the table in § The three products. If the gotcha straddles two, pick the surface you were on when it bit and mention the second in the body.

### 3. Resolve the escalation mode

Determine whether you're in a product-team repo (see § Escalation mode). If yes, surface the gotcha to the operator and offer the three paths; resume the workflow only if they pick "capture as gotcha." If they pick "file a normal bug," skip to § Filing a normal bug below; if they pick "note-and-move-on," exit the skill.

If you're not in a product-team repo, proceed with silent capture.

### 4. Search the matching Linear project for duplicates

Before filing, search the matching `*-gotchas` project for an open ticket with similar symptoms. Use the symptom keyword(s) — error message text, API name, CLI flag, package version, etc.

- If you find a match (read the top 1–3 results to be sure): **do not file a duplicate.** Link to the existing ticket from your gotcha file entry instead. Optionally, add a comment to the existing ticket with new repro evidence if your environment differs from the original report.
- If no match: continue to step 5.

### 5. Decide where to record locally

Per § The three products. Use the existing per-product file if present; otherwise create `gotchas.md` at repo root with the bootstrap template below.

### 6. Draft the entry

Use the file-entry template below verbatim. Keep entries 10–25 lines. If you need more, you're either explaining a generic concept (write a runbook instead) or describing two gotchas (split them).

### 7. File the Linear ticket

In the matching `*-gotchas` project:

- **Status:** `Triage`. Do not set priority — let the team triage.
- **Title:** the file entry's heading, verbatim.
- **Description:** see the Linear-ticket template below. Mirror the file entry's body and link back to the file (commit SHA + path + line range once committed; if you haven't committed yet, link to the file path in the working tree and update after).

Capture the Linear ticket id (e.g. `TML-1234`) and URL — you'll need both for the file entry's `**Filed upstream:**` line.

### 8. Append the entry to the file

- Insert in the file's existing order; don't reorder existing entries (treat the file as append-mostly).
- Add the entry's title to the `## Contents` list at the top, with a working anchor link.
- Replace the placeholder `**Filed upstream:**` line with the real Linear ticket id and URL from step 7.

### 9. Commit

One commit per gotcha (or per closely-related group). Conventional shape:

```text
docs(gotcha): record <one-line title>

<2–4 line summary: what was surprising, workaround in one sentence,
ticket id.>

Filed as <TML-XXXX> in <gotchas project name>.
```

The commit lands alongside the workaround in the same PR. Don't gate the operator's primary work on this — record inline as you finish the workaround.

If you cited a `working tree` path in the Linear ticket because you hadn't committed yet, update the ticket description after the commit lands (replace with a permalink to the committed line range).

---

## Filing a normal bug (path 2 in product-team repos)

When the operator picks "file a normal bug" instead of capturing as a gotcha:

1. **Search the product's Linear project for duplicates.** Use the same symptom keywords. If a match exists, link the operator to it and ask whether to add a comment with the new repro evidence or drop it.
2. **File the ticket on the operator's behalf** in the matching product project (per § The three products table).
   - **Title:** symptom-led, same shape as a gotcha entry heading.
   - **Description:** symptom / cause / workaround / repro from the conversation, formatted like the Linear-ticket template below but minus the `Source:` line (there's no local gotcha file).
   - **Status / priority / labels:** follow the team's normal-bug conventions, not the `Triage` / no-labels gotcha convention. Ask the operator if you don't know the team's defaults.
3. **Confirm with the operator** by pasting the ticket URL into the conversation. No local file entry, no commit — the ticket is the record.

If the operator wants to file the ticket themselves rather than have the agent do it, draft the body and hand off — they paste.

---

## Templates

### File entry

Used in `gotchas.md` (or the matching per-product file).

```markdown
## <One-line title — start with the symptom or the constraint, not the solution>

**Filed upstream:** [TML-XXXX](https://linear.app/prisma-company/issue/TML-XXXX) — *"<ticket title>"*
**Product:** Prisma Next | Prisma Compute | Prisma Postgres
**Version:** <package version, CLI version, or commit SHA>
**First hit:** <one-line context, e.g. "authoring a new extension pack", or "examples/prisma-8-demo migration plan">
**Cost:** <only if material — "20 minutes of brownout", "3 hours debugging", etc. Skip if <30 min.>

**Symptom.** <quoted error / log line / observed behaviour, verbatim where possible>

**Cause.** <what's actually happening underneath; cite source files, package versions, CLI versions where you have them>

**Workaround.** <concrete commands, code snippets, config changes; if the workaround has a revert criterion (e.g. "remove when TML-XXXX ships in vX.Y"), name it>

**Reproduction.**
1. <minimal steps>
2. ...

**References.**
- Upstream: [TML-XXXX](https://linear.app/prisma-company/issue/TML-XXXX)
- Workaround source: [`path/to/file.ts`](path/to/file.ts) (link to where the fix actually lives)
- Related: <ADR / commit / docs link if any>
```

**Naming the heading.** Lead with the symptom (`OG image URLs fall back to localhost:8080`) or the constraint (`pg/timestamptz codec types output as string | Date`), not the solution (`Set metadataBase`). Future-you searches by what they saw, not what they did about it.

### Linear ticket (gotchas project)

- **Project:** the matching gotchas project (PN / Compute / PPg).
- **Status:** `Triage`. No priority, no labels — the project itself is the dogfood filter.
- **Title:** the file-entry heading, verbatim.
- **Description (Markdown):**

```markdown
**Source:** <link to the gotchas.md commit (or working-tree path if uncommitted), including file path and line range>
**Product:** Prisma Next | Prisma Compute | Prisma Postgres
**Version:** <as in the file entry>

## Symptom

<as in the file entry>

## Cause

<as in the file entry>

## Workaround

<as in the file entry>

## Reproduction

1. <minimal steps>
2. ...

## Notes

<anything that didn't fit the file entry — environment specifics, near-misses, workarounds you tried that failed, etc.>
```

After the gotcha-recording commit lands, update the ticket's `**Source:**` line to point at the permalink for the committed line range (Linear MCP supports issue editing).

### `gotchas.md` (bootstrap, for fresh repos)

Use this when creating `gotchas.md` for the first time in a repo that has no per-product files:

```markdown
# Gotchas

A running log of surprises, workarounds, and undocumented behaviour hit while *consuming* **Prisma Next**, **Prisma Compute**, or **Prisma Postgres** in this project. Each entry captures friction a real user of these products would also experience.

Each entry is also filed as a Triage-state Linear ticket in the matching gotchas project so the team can pick them up:

- Prisma Next → [`pn-gotchas`](https://linear.app/prisma-company/project/pn-gotchas-a6f6f5157a5c/overview)
- Prisma Compute → [`compute-gotchas`](https://linear.app/prisma-company/project/compute-gotchas-dd3ac34b5ad4/overview)
- Prisma Postgres → [`ppg-gotchas`](https://linear.app/prisma-company/project/ppg-gotchas-afe77336f696/overview)

The capture workflow is documented in [`.agents/skills/record-gotchas/SKILL.md`](.agents/skills/record-gotchas/SKILL.md).

---

## Contents

<!-- entries get appended below; add a link here in the same commit -->

---

<!-- new entries appended below this line -->
```

---

## Examples

### Good entry — shape to copy

> ## `migration plan` reports "No changes detected" when contract is stale
>
> **Filed upstream:** [TML-XXXX](https://linear.app/prisma-company/issue/TML-XXXX)
> **Product:** Prisma Next
> **Version:** `@internal/cli@<version>`
> **First hit:** `examples/prisma-8-demo`, changing the schema while iterating on a demo
> **Cost:** ~15 minutes
>
> **Symptom.** Edited `schema.prisma`, ran `pnpm prisma migration plan`, got `✔ No changes detected` with `from` and `to` hashes equal. No warning, no indication that the contract was out of date.
>
> **Cause.** `migration plan` compares the *emitted* contract hash (`src/prisma/contract.json`) against the last applied migration's hash. Editing `schema.prisma` doesn't update the contract — `contract emit` does. The CLI doesn't detect the staleness or warn about it.
>
> **Workaround.** Run `pnpm prisma contract emit` before `migration plan` whenever the schema has changed. Or wire `emit` into your dev script.
>
> **Reproduction.** Edit `schema.prisma` in `examples/prisma-8-demo`, run `pnpm prisma migration plan` without re-emitting. Observe the spurious "No changes detected".

Why it's good: symptom-led title, version captured, cost surfaced, cause cites the underlying mechanism, workaround is concrete, repro steps are minimal.

### Bad entry — don't do this

> ## Migrations don't work
>
> **Symptom.** I ran a migration and it failed.
>
> **Workaround.** I figured it out after a while.

Why it's bad: title doesn't tell future-you what to search for; no version, no cause, no concrete workaround, no upstream link. The team can't act on this and the next operator won't recognise it as relevant when they hit the same issue.

---

## Resolved gotchas

When a Prisma release fixes a gotcha, **do not delete the entry.** Append a `**Resolved**` line at the bottom of the entry, citing the release that closed it. The history of what we knew when matters; deleting it loses signal about how long the issue lived.

```markdown
**Resolved in `@internal/orm@0.5.1`** — see [release notes](...). Workaround removed in [commit abc123](...).
```

If the entry was wrong (rather than fixed), mark it `**Superseded — see <new-entry-link>**` and add a corrected entry below. Don't edit the original body.

---

## Anti-patterns

- **Filing a gotcha about code your team maintains.** That's a bug. File it in the same product Linear project, but with the team's normal-bug conventions (not `Triage` / no-labels). The gotcha filing convention exists to surface the *consumer perspective*; tagging maintenance-side bugs as gotchas dilutes the signal.
- **Skipping the Linear ticket** because "I'll file it later." You won't. File now or not at all; "not at all" only if you decided it's not gotcha-worthy.
- **Filing without searching for duplicates first.** The gotchas projects fill up fast; duplicate tickets dilute the signal.
- **Recording your own misunderstanding as a product gotcha.** If the docs already cover it, skip. (Honest self-test: would you file a public ticket about this? If no, don't write a gotcha either.)
- **Burying the workaround in a deeply-nested code comment** instead of the gotcha file. Code comments are for readers of that file. The gotcha file is for the next operator who hits the same trap from a different code path.
- **Silent-capturing in a product-team repo.** In `prisma-8-ws` (and the Compute / PPg equivalents), surface the gotcha and let the operator pick the path. They may be about to file it as a normal bug or fix it directly.
- **Editing existing entries to "improve" them.** Append-mostly. If an entry is wrong, mark it `**Superseded**` and add a new entry; don't rewrite the original.
- **Filing in the wrong project.** PN bugs go to PN, Compute bugs to Compute, PPg bugs to PPg. If straddling, pick one and mention the second in the body — don't file in two.
- **Skipping the version field.** The team uses `Version` to know which release to test against when triaging. Without it, the ticket sits.
- **Setting priority on the ticket yourself.** That's the team's call during triage. Leave it alone.

---

## Optional: promote operational lessons into skills

If your repo has operational skills that prescribe how to use one of the three products (e.g. `compute-deploy-nextjs`, `prisma-8-nextjs-app`, or anything similar), and your gotcha changes how someone *should* do the underlying task, also fold the prescriptive lesson into the matching skill — the gotcha is the *forensic* record (what bit us); the skill is the *prescriptive* record (how to avoid it).

In product-team repos like `prisma-8-ws`, prescriptive skills for the team's own product often live elsewhere (developer docs, contributing guides, IDE rules). The principle is the same: where there's a durable prescriptive home for the lesson, cross-link from it back to the gotcha entry.
