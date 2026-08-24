
# Prisma Next — Feedback (Bug Reports, Feature Requests, Team Q&A)

> **Edit your data contract. Prisma handles the rest.**

This skill is the *terminal* of the capability-gap routing pattern. Every other Prisma Next skill's *What Prisma Next doesn't do yet* entries route here when the user wants the gap closed; the skill also fires directly on prompts like *"this is a bug"*, *"file an issue"*, *"feature request"*, *"can I ask the team about this?"*, *"how should I integrate X with Prisma Next?"*.

The skill's job is to pick the *right channel* — GitHub issue or Discord — and then either produce a **structured, public-safe** issue body (no secrets, no proprietary schema) the framework team can act on, or hand the user a direct link to the Prisma Discord for synchronous Q&A. Submission to GitHub never happens without explicit user confirmation.

Canonical channels:

- **GitHub Issues** (bugs + concrete feature requests): <https://github.com/prisma/prisma-next/issues/new/choose>
- **Prisma Discord** (Q&A, design feedback, direct team contact — including extension authors): <https://pris.ly/discord>

## When to Use

- A capability-gap entry from another `prisma-next-*` skill fired and the user said *"yes, file the feature request"*.
- User says *"this is a bug"*, *"file this"*, *"report this"*, *"file an issue against PN"*, *"send feedback"*, *"this should be a feature"*.
- User describes an unexpected behaviour — wrong exit code, error message that didn't match what happened, type signature that doesn't match runtime behaviour, planner refused a migration that looked safe — and wants it on the framework team's radar.
- User asks *"can I ask the Prisma team about this?"*, *"is there somewhere I can talk to the team?"*, *"is this the intended way to do X?"*, *"how should I integrate <my extension / my tool> with PN?"*, or any other open-ended Q&A or design-feedback prompt — including extension authors asking integration questions.

## When Not to Use

- User wants to fix the bug themselves in the user's own code. The fix lives in another workflow reference (debug / contract / migrations / queries / runtime / build). Open the right reference first; only fall back to feedback if the user explicitly wants the framework to do something differently.
- User wants to upgrade Prisma Next (the bug may already be fixed) → [`upgrade-app.md`](upgrade-app.md); this reference mentions it as a pre-flight check.
- The user's question is already covered by a workflow reference in this skill (*"how do I add a column?"* → `references/contract.md`; *"what's the right query interface?"* → `references/queries.md`). Route to the workflow reference, not to the team — open the reference, answer the question, and only escalate to Discord if the agent can't.

## Key Concepts

- **Three channels, one decision.** GitHub Issues (bugs + concrete feature requests), Prisma Discord (Q&A, design feedback, direct team contact), or another workflow reference in this skill (when the question turns out to be a workflow question, not a hand-off-to-team question). The first move is the channel decision; everything else follows.
- **Public artifact.** GitHub issues *and* Discord messages are world-readable and archived. The body / message must not contain `DATABASE_URL` strings, internal company schema fragments, customer data in sample rows, or any other content the user wouldn't share publicly. The agent redacts before either kind of submission.
- **Bug vs feature vs question.** A *bug* is "documented surface behaved unexpectedly". A *feature request* is "I want a capability that doesn't exist". A *question* is "I want to discuss X with someone, or I'm not sure this is a bug at all". Many capability-gap routes are feature requests; many extension-author prompts are questions.
- **The framework team needs to reproduce (issues only).** A bug report without a reproduction is much harder to act on. Where possible, the agent produces a minimal repro the team can re-run locally — ideally a small change against [`examples/prisma-8-demo`](https://github.com/prisma/prisma/tree/main/examples/prisma-8-demo), which the team already has checked out. Discord Q&A doesn't require a full repro — a short code snippet plus the question is usually enough.

## Workflow

### 1. Pick the channel

The user wants to hand something off to the team. Which channel?

**GitHub Issue** if any of:

- The user describes a concrete bug (see *Classify* below for the bug-vs-feature split).
- The user has a concrete feature request — a named capability, a specific API shape, a specific CLI flag — that they want on the backlog.
- A capability-gap entry from another `prisma-next-*` skill routed them here for a feature request.

**Prisma Discord** (<https://pris.ly/discord>) if any of:

- The user is asking an open-ended question — *"is this the intended way to do X?"*, *"how would you approach Y?"*, *"I'm seeing weird behaviour but I'm not sure if it's a bug."*
- The user wants design feedback before committing to a feature request — *"we're thinking of building a custom middleware that does X, does this fit the framework's direction?"*
- The user is an extension author with an integration question that needs back-and-forth with the team (peer-dependency coordination, breaking-change timing, a new extension surface).
- The user explicitly asks for the team — *"can I ask the team about this?"*, *"is there somewhere I can talk to Prisma?"*, *"where do extension authors discuss things with the team?"*

**Both, in sequence**, if any of:

- The user has a bug *and* a related feature request — file two separate GitHub issues, do not mix them in one issue.
- The user wants to discuss a design before filing the feature request — start in Discord, file the issue once the shape is settled.

### 2. Classify (issue path only)

The user is filing a GitHub issue. Is it a bug or a feature request?

**Bug** if any of:

- A documented CLI command exited with the wrong code.
- The `fix` field of an error envelope was misleading or wrong.
- A published TypeScript signature doesn't match runtime behaviour.
- The planner refused a migration that should have been valid (or accepted one that shouldn't have been).
- The contract emit produced an artifact that doesn't load at runtime.
- Any other case where the documented surface did the wrong thing.

**Feature request** if any of:

- The user wants a capability that doesn't exist yet (most of the *What PN doesn't do yet* entries land here).
- The user wants a better error message, an additional CLI flag, a new middleware, an additional bundler plugin, etc.

If both — a bug *and* the user wants a related feature — file two separate issues. Mixing them makes the framework team's triage harder.

### 3. Collect the minimum body (issue path only)

For **either** kind:

- **Prisma Next version**: `pnpm ls @internal/postgres` (or `@internal/mongo`). If the project uses a target package, that version is canonical.
- **Node version**: `node -v`.
- **Package manager**: `pnpm` / `npm` / `yarn` / `bun` / `deno`.
- **OS**: `darwin` / `linux` / `win32` and the version string is enough.

For **bug reports**, additionally:

- **The exact command** that misbehaved (e.g. `prisma migration plan --name add-email`).
- **The full output**, with `-v` if a structured error envelope is involved. Redact `DATABASE_URL` and any other secrets.
- **A minimal `src/prisma/contract.prisma` / `src/prisma/contract.ts` excerpt** that reproduces the issue. Strip unrelated models. Keep the original model and field names from the user's contract when they don't expose anything compromising — a faithful excerpt is much easier for the framework team (and future readers of the issue) to reason about than a re-themed one. Only rename to neutral placeholders (`User`, `Post`, `Tag`) when the original names would leak confidential domain detail (product names, internal codenames, customer identifiers, regulated-data field names).
- **Steps to reproduce**, as a numbered list.
- **Expected behaviour** — one sentence.
- **Actual behaviour** — one sentence plus the relevant output line.
- **Workaround**, if any — one sentence.

For **feature requests**, additionally:

- **Desired API or behaviour** — one paragraph. Concrete shape (CLI flag, config field, middleware export, plugin API) where possible.
- **Where the gap surfaces today** — which skill's *What PN doesn't do yet* entry triggered the request, or the workflow the user was trying to complete.
- **Current workaround**, if any — one sentence (and the skill body the user is following may already say this).

### 4. Render the body

The repository ships GitHub Issue Forms (`.github/ISSUE_TEMPLATE/bug_report.yml` and `feature_request.yml`). When the user lands on <https://github.com/prisma/prisma-next/issues/new/choose> they pick the matching template and fill in the form fields; the skill produces the body in the same structured shape so it maps onto the form one-to-one (and so `gh issue create --body-file` produces a parseable artifact even when the form isn't in play).

Bug-report body shape (fields named to match `.github/ISSUE_TEMPLATE/bug_report.yml`):

~~~markdown
## Package and version

<e.g. @internal/postgres@0.5.2>

## What happened?

<one-sentence summary plus the relevant output line, secrets redacted>

## What did you expect to happen?

<one sentence>

## Minimal reproduction

1. <step one>
2. <step two>
3. <step three>

```ts
// schema.psl excerpt + the query / command that fails
```

## Environment

- Node: <version>
- OS: <darwin/linux/win32> <version>
- Package manager: <pnpm/npm/yarn/bun/deno> <version>
- Database: <Postgres / Mongo> <version>

## Additional context

<optional — link to source skill's capability-gap entry, related
issue number, partner extension involved>
~~~

Feature-request body shape (fields named to match `.github/ISSUE_TEMPLATE/feature_request.yml`):

~~~markdown
## What problem are you trying to solve?

<paragraph — the use case or pain point this would address>

## Proposed solution

```ts
// imagined usage of the API / behaviour you'd want
```

## Alternatives considered

<sentence or two — what you tried with the current API and why it didn't work>

## Scope and impact

<which package(s) this would touch; target-specific implications>
~~~

### 5. Title (issue path only)

- **Bug**: `bug(<area>): <one-line summary>` — e.g. `bug(cli): migration plan exits 0 when there is no diff`.
- **Feature request**: `feat(<area>): <one-line summary>` — e.g. `feat(build): first-party Next.js plugin for contract emit`.

Areas mirror the cluster of skills: `cli`, `contract`, `migration`, `query`, `runtime`, `build`, `error`, `docs`.

### 6. Surface for confirmation (issue path only)

**Never auto-submit.** The agent shows the rendered title and body to the user and asks: *"This looks good to file. Shall I submit it to GitHub?"*. Submission only happens after explicit user approval.

### 7. Submit (issue path only)

Preferred. Two steps:

1. **Write the rendered body to a temporary file.** Use your file-write tool (the same tool you'd use to create any other file on disk) to write the body to e.g. `wip/pn-issue-body.md` or `/tmp/pn-issue-body.md`. The body content is just the markdown produced in step 4 of this workflow — no surrounding shell quoting, no heredoc.
2. **Reference that file from `gh`.** Run:

   ~~~bash
   gh issue create \
     --repo prisma/prisma \
     --title "<title>" \
     --body-file <path-from-step-1>
   ~~~

**Anti-pattern (do not do this):** inlining the body via `--body "$(cat <<EOF …)"` or `--body-file <(cat <<EOF …)`. Those one-liners reliably leak literal `cat <<'EOF'` / `EOF` markers into the issue body when the agent reuses the template verbatim with the body interpolated. Always write the body to a real file first and pass the path.

If `gh` is not installed: open the prefilled new-issue URL in the browser:

~~~text
https://github.com/prisma/prisma-next/issues/new/choose
~~~

…and instruct the user to paste the rendered body. The agent can copy the body to the clipboard via `pbcopy` (macOS), `xclip` (Linux), or by simply printing it in the chat for the user to copy.

### 8. Route to Discord (Q&A / design-feedback / direct-team-contact path)

When step 1 picked the Discord channel (steps 2–7 do not apply):

1. **Surface the link.** Give the user the canonical invite: <https://pris.ly/discord>. Suggest the channel that fits the question:
   - General usage / Q&A → the public `#help` or `#prisma-next` channel (channel naming evolves; the invite landing page lists current channels).
   - Extension-author / partner-integration / breaking-change-coordination questions → the public extension-authors channel, or the user can ping a maintainer directly once they're in the server.
2. **Help draft the opening message.** Prisma's Discord is searchable; a well-framed opening message gets a faster, more useful answer. The agent drafts a short message with:
   - One-sentence summary of what the user is trying to do.
   - The Prisma Next version (`pnpm ls @internal/postgres` or equivalent).
   - A short code snippet (PSL excerpt, query, config file) where relevant — redacted the same way as a GitHub issue body (no `DATABASE_URL`, no customer schema names).
   - The specific question the user wants answered.
3. **Do not auto-post.** The agent surfaces the drafted message to the user — *"here's an opening message you can paste into Discord; want to adjust before sending?"* — and lets the user decide whether to paste it as-is, edit it, or pick a different framing.
4. **Set expectations honestly.** Discord is synchronous and best-effort. Bugs and concrete feature requests should land in GitHub regardless (use the issue path); Discord is for the conversation that gets you to *"yes, this is a bug, file it"* or *"yes, this should be a feature, file it"*.

### 9. Follow up

- **Issue path**: record the issue URL in the user's project notes (or in the project's `wip/` if there is one) so a later upgrade or related work can reference it. If the bug is the symptom of an old version of Prisma Next, suggest an upgrade following [`upgrade-app.md`](upgrade-app.md) — many bugs are fixed in newer releases.
- **Discord path**: once the conversation on Discord settles into a concrete bug or a concrete feature request, return to step 1 of this skill and file the issue (the Discord thread becomes the *Notes* / *Where the gap surfaces* reference in the issue body).

## Common Pitfalls

1. **Auto-submitting without confirmation.** Always show the body first. The user owns the public-facing artifact, not the agent.
2. **Pasting `DATABASE_URL` or other secrets into the body.** `redact` aggressively. Replace with `postgresql://USER:PASS@HOST/DB` placeholders.
3. **Pasting a customer's confidential domain schema.** When original model and field names would leak confidential information (product codenames, customer identifiers, regulated-data fields), rename to neutral placeholders before the body goes into a public issue. Otherwise, keep the original names — a faithful excerpt is easier for the framework team to reason about than a re-themed one. Over-renaming is its own readability cost.
4. **Filing a documentation question as a bug.** Documentation questions belong in another skill or in a GitHub Discussion (if the repo enables them). Bugs are about the surface misbehaving.
5. **Conflating bug + feature in one issue.** File two. Mixed issues are hard to triage and hard to close.
6. **Filing without a version.** "I'm using Prisma Next, it's broken" without the version makes triage hopeless. The version is the cheapest piece of context to capture; always include it.

## What Prisma Next doesn't do yet

- **In-product feedback channel.** No `prisma-next feedback` CLI command. The GitHub Issues page is the canonical surface. If you want a CLI-side feedback command, file a feature request via this skill.

## Reference Files

- <https://github.com/prisma/prisma-next/issues/new/choose> — the canonical submission surface.
- <https://cli.github.com/manual/gh_issue_create> — the `gh` command reference.

## Checklist

- [ ] Classified as bug or feature request (not both in one issue).
- [ ] Environment block present: PN version, Node, package manager, OS.
- [ ] Reproduction is minimal, public-safe, secret-free.
- [ ] Schema fragments use original names where safe; renamed to neutral placeholders only where original names would leak confidential domain detail.
- [ ] Title in conventional-commit form (`bug(area): …` / `feat(area): …`).
- [ ] Body shown to the user for confirmation before submission.
- [ ] Submitted via `gh issue create` (preferred) or via the prefilled new-issue URL.
- [ ] Issue URL captured for future reference.
- [ ] Suggested an upgrade ([`upgrade-app.md`](upgrade-app.md)) if the bug may already be fixed in a newer release.
