---
name: review-implement-phase
description: Implements triaged review actions, commits focused fixes, and posts Done plus resolves threads. Use when the user wants only the implementation phase of the review-framework workflow.
argument-hint: "[pr-url] [output-dir]"
---

# Review Implement Phase

Run only the implementation phase of the review-framework loop:

take triaged `will_address` actions, make code changes, commit in logical steps, post GitHub status updates, and update action status.

Run commands from this skill directory. All script paths below are relative to it.

## Inputs

- Required:
  - PR URL
  - existing `review-actions.json` in output dir
- Optional:
  - output directory
  - scope constraints (specific action IDs or files)

If output directory is omitted, derive:

`wip/reviews/<owner>_<repo>_pr-<number>/`

## Preconditions

`<output-dir>/review-actions.json` must exist and be valid v2.

System dependencies required on PATH:

- `gh` (GitHub CLI)

If `gh` is missing, halt immediately and ask the user to install it. The implement-phase scripts require only `gh`.

GitHub admin capability must be available before starting implementation:

```bash
node ./scripts/check-github-admin-ready.mjs --pr <PR_URL>
```

If missing, instruct user to run:

- `/review-fetch-phase <PR_URL> [output-dir]`
- `/review-triage-phase <PR_URL> [output-dir]`

## Behavior

1. Read actions JSON and select actionable rows:
   - `decision: will_address`
   - `status: pending | in_progress`
2. Preflight GitHub admin capability:
   - run `check-github-admin-ready.mjs` and fail fast if unavailable
3. Always post standalone comments (**never pending PR reviews**):
   - When posting progress updates, do **not** create a PR review (draft/pending or otherwise).
   - Forbidden flows:
     - `gh pr review --comment ...`
     - GraphQL `addPullRequestReview`, `addPullRequestReviewComment`, `addPullRequestReviewThread` (this workflow never uses pending reviews)
   - Allowed flows:
     - thread replies via `addPullRequestReviewThreadReply` (or wrapper script)
     - issue comments via `addComment` (or wrapper script)
   - Before starting implementation:
     - **Detect pending reviews authored by the acting user** on this PR:
       `gh api graphql -f query='query($owner:String!,$repo:String!,$pr:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$pr){reviews(last:20,states:PENDING){nodes{id author{login}}}}}}' -F owner=<owner> -F repo=<repo> -F pr=<number>`
     - If any exist, **halt** and clean them up (submit or dismiss) before continuing.
   - After posting any "On it" / "Done" comment:
     - **Re-check for pending reviews authored by the acting user**.
     - If any exist, the workflow is **blocked** until they are cleaned up.
   - Implementation requirement:
     - For `review_thread` targets, always reply using **thread replies** (never inline PR review comments).
       - If you only have the thread node id, first fetch the thread’s primary comment node id, then call `addPullRequestReviewThreadReply`.
     - For `pull_request_review` targets (review-body findings, `PRR_…` node ids), inline replies are not possible. `post-review-thread-reply.mjs` auto-detects this and posts a top-level PR issue comment instead (response `kind: "issue_comment"`); there is no thread to resolve, so the implementer skips `resolve-review-thread.mjs` for these and records the issue-comment id in the action's `done` record.
4. Delegate implementation to:
  - `./agents/review-implementer.md`
5. Require implementer responsibilities:
   - make code changes
   - run relevant checks
   - create focused commits
   - post "On it" when starting each action
   - post "Done" when finished (universal); resolve the thread **only when `target.kind === "review_thread"`** and a `threadNodeId` is available. `pull_request_review` targets have no inline thread, so the implementer skips the resolve step for them and records the issue-comment id in the action's `done` record (per behavior step 3).
   - use encoded helper scripts for thread admin operations:
     - `node ./scripts/post-review-thread-reply.mjs --repo <owner>/<repo> --pr <number> --comment-node-id <primaryCommentNodeId> --body "<text>"` (works for both `review_thread` and `pull_request_review` — auto-detects node kind)
     - `node ./scripts/resolve-review-thread.mjs --thread-node-id <threadNodeId>` (only for `review_thread` targets)
   - comments must be posted as individual standalone comments/replies, never as part of a pending review
   - after each action completion (Done + resolve when applicable), verify no new pending review was created by the acting user
   - never use inline parser snippets (for example: `python -c`, `node -e`, `ruby -e`, ad-hoc awk/sed JSON parsing)
   - only set `status: done` after Done (and, for `review_thread` targets, resolve) succeeds
   - update `review-actions.json` (`status`, `done.doneAt`, `done.summary`, `done.commits`) in the same completion step
6. Render latest action markdown:

```bash
node ../review-triage-phase/scripts/render-review-actions.mjs --in <output-dir>/review-actions.json --out <output-dir>/review-actions.md
```

## Ownership

- This phase owns actual fixes plus posting Done and resolving completed threads.
- If GitHub thread reply/resolve cannot be performed, the phase is blocked and must not report completion.
- If comments were accidentally posted as a pending review, the phase is blocked until the pending review is explicitly submitted or dismissed and the action comments are re-posted as standalone comments.

## Output to user

Return:

- commits created
- actions transitioned to done
- written artifacts (`review-actions.json`, `review-actions.md`)

Suggest next steps:

- `/review-fetch-phase <PR_URL> [output-dir]`
- `/review-triage-phase <PR_URL> [output-dir]`
