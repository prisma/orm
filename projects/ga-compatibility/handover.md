# Handover: the compatibility policy for Prisma 8 (stream 7 of the GA plan)

Written 2026-11-23 for an agent starting in a fresh session and a fresh worktree. Read this file first, then `spec.md`, `maturity-levels.md` and `plan.md` beside it.

## Update, 2026-11-24

This handover was taken up on 2026-11-24. Two things changed that day, and where this file disagrees with them, they are right:

- These files moved from `planning/ga-readiness/` on the branch `planning/prisma-8-ga` to `projects/ga-compatibility/` on the branch `ga-compatibility`. The planning branch keeps the GA plan, whose stream 7 lists the projects and points here.
- [plan.md](plan.md) is organised as 12 projects, not 23 unordered tasks, and records which projects GA requires. Each project names the old task numbers it covers, which the research reports still use.
- The statements below that only one row is marked Must, and that the next step is to wait for Will's instruction, are out of date. [plan.md](plan.md) has the current placements and order.

## What this work is

Will Madden is preparing Prisma 8 (repository prisma/orm, at `8.0.0-rc.24` on 2026-11-23) for general availability. He asked for the policies, the contract with users, and the supporting work that GA needs, apart from the date. The wanted result is a design, a plan and documentation that an implementer and reviewer team can pick up and that stand on their own.

The subject is one promise: a user who upgrades within Prisma 8 is not broken. "User" means an application developer or an extension author; both get identical rules. The work decided what that promise covers, how a user tells what is covered, and what must be built to make it true.

This session was a design discussion with Will. Nothing was built. The design discussion is finished. On 2026-11-23 Will said the remaining items are project tasks, not design.

## Where everything is

Everything is on the branch `planning/prisma-8-ga` of prisma/orm, under `planning/ga-readiness/`. It is pushed. Stream 7 in `planning/plan.md` on that branch lists the tasks as rows 1 to 23.

To read it from any checkout:

```bash
git fetch bot planning/prisma-8-ga
```

```bash
git show FETCH_HEAD:planning/ga-readiness/handover.md
```

Rules for that branch (from `planning/for-agents.md`): fetch from and push to the `bot` remote; other sessions push to it too, so fetch before every push and confirm with `git ls-remote`; never open a pull request from it; never merge it into `main`. This session added commits without checking the branch out, by building each commit from a temporary index (`git read-tree`, `git update-index --add --cacheinfo`, `git write-tree`, `git commit-tree`, then `git push bot "${C}:refs/heads/planning/prisma-8-ga"`). In zsh write `"${C}:refs/..."` with braces; `$C:refs` is misread. Each commit carries two sign-offs, the bot's and `Signed-off-by: Will Madden <madden@prisma.io>`, and no AI attribution lines.

| File under `planning/ga-readiness/` | What it holds |
| --- | --- |
| `spec.md` | The policy. It holds only decisions Will agreed. |
| `maturity-levels.md` | Early Access, Preview and GA, for packages and single APIs. Section 6 lists what is not decided. |
| `plan.md` | 23 tasks. Not ordered. |
| `open-questions.md` | Nothing open for discussion. It keeps five proposals of the author's that were never discussed, and one wording point. |
| `analysis.md` | Facts gathered from the code and the sibling products during the discussion. |
| `research/stored-data-and-upgrades.md`, `public-api-compatibility.md`, `additions-that-break.md` | How other projects handle each topic, with sources. |
| `research/gap-packages-and-api.md`, `gap-stored-data.md`, `gap-docs-releases-tooling.md` | Each sentence of the policy checked against the code on 2026-11-23 at commit `f1712a228a`: true today or not, the evidence, and the work needed. Tasks 10 to 22 came from these. |

The earlier session's worktree, `.claude/worktrees/prisma-8-ga-readiness-d9c93c`, has the same files untracked under `projects/ga-readiness/`. The planning branch is the copy to use.

The full transcript of the session that produced this, as JSON lines: `/Users/wmadden/.claude/projects/-Users-wmadden-Projects-prisma-orm--claude-worktrees-prisma-8-ga-readiness-d9c93c/23d0914c-3347-40ac-a6c5-ba35545d23a0.jsonl`. It is large. Search it for a topic; do not read it whole.

The wider GA plan, of which this is stream 7, is described in `planning/handover.md`, `planning/for-agents.md` and `planning/plan.md` on the same branch.

## What was decided

`spec.md` is the record. In short:

- **Goal.** Upgrading within the major is routine. Each rule is judged by one question: would it make a user hesitate before upgrading?
- **What is covered.** Everything that is GA: the TypeScript API, runtime behaviour, CLI commands, config, error codes, file formats, stored data. A user tells from two things in their own code: a package's version number and an API's name.
- **Maturity.** One scale, Early Access, Preview and GA, for packages and for single APIs. A package below GA has a pre-release version (`8.1.0-preview.3`, `8.1.0-ea.1`). An API below GA inside a GA package has a name that starts with `preview_` or `ea_`. An entrypoint carries no level. Will rejected a separate word such as `unstable_`.
- **Audiences.** Application developers depend on one facade, extension packages and the `prisma` tool. Extension authors build on the platform packages. "Extension" includes a target and a family. The audience is information only; no rule depends on it. Every package exports as little as possible. Nothing published is named "internal".
- **Additions.** A release may add at any time, and an addition must not affect code that does not use it. A new member on an interface that users implement is optional (Rust's rule for traits).
- **Changes to behaviour** have classes (spec 5.2); a security fix may change specified behaviour with a published notice.
- **Deprecation.** A GA API that is replaced keeps working until the next major. This does not apply below GA.
- **Supported versions.** Support for Node.js, TypeScript, databases and drivers follows each maker's own lifetime. A minimum rises only in a major, unless the maker ends support.
- **Stored data.** A later release reads what an earlier one wrote. Files carry a format version. A hash never changes while its content has not. No upgrade fails because Prisma's own tables (marker, ledger, contract) are missing or in an older form; the ORM brings them up to date itself.
- **No feature flags.**
- **Releases.** We aim for one major a year. Fixes go to the latest minor. The previous major gets critical and security fixes for 12 months.
- **Applying the policy.** The author of a change states its class and the reviewer checks it. A check compares each package's exported API with the last release, fails on a removal or incompatible change to anything GA, and reports every addition.
- **Upgrades.** Where an upgrade needs a change, a deterministic tool makes it. A guide applied by an agent does not count.

## The state of the plan

`plan.md` has 23 tasks. Tasks 1 to 9 came from the discussion. Tasks 10 to 22 came from checking the policy against the code. Task 23, a docs page that states the policy for users, is written last, once the others are complete.

What Will has said about the tasks:

- They are not ordered. "We can order them later when we want to begin implementation."
- The design for each task is written when the task starts, by whoever takes it. Do not write those designs ahead.
- Reducing each package's exports and renaming the `internal` paths happen before `8.0.0`. That is the only row marked Must on the planning branch.
- The ORM keeping its own tables up to date "possibly can be implemented after GA".

Points the next agent should know are unresolved. None needs Will until the plan is ordered or a task starts:

- Which tasks must land before `8.0.0`. The author's view: tasks 10 and 11 change a stored format and a hash, so they are far cheaper before `8.0.0` than after. Will has not decided.
- Task 7: what the Supabase extension's relationship to the PostgreSQL facade should be. Today it imports the facade's `internal` paths.
- Task 18: applications import `definePrismaConfig` from `@prisma/cli-engine`, a package the policy does not list.
- Task 6: the recorded decision on version support (`docs/architecture docs/adrs/ADR 222 - Version support policy.md`) says "We raise floors freely", which contradicts what Will decided. The task revises it.
- `maturity-levels.md` section 6: version numbers while packages are at different levels, what happens to the name `preview_foo` when the API reaches GA, and how a level is written where the name is not a TypeScript identifier. Will called these details and assigned them to plan task 1.

## What to do next

Wait for Will to say what he wants. Likely requests: order the plan and mark what GA requires; start a task through the Drive process; turn tasks into tickets (search Linear first; he has not asked for tickets). Do not start building on your own initiative.

## How to work with Will on this

These are corrections he gave during this session, some several times. Each one cost him an interruption.

- **He decides intent, not detail.** He stopped a run of one-question-at-a-time decisions with "can we try to do a first pass over all the other topics together instead of you grilling me on minutiae". For anything small, decide it yourself, record it, and move on. For a batch of open points, propose one answer for each in a single message and let him object to the ones he disagrees with.
- **Do not start a large piece of work he did not ask for.** The check of the policy against the code was announced in one line and he did not register it; when the results arrived he asked what it was. Before doing something of that size, say in plain words what it is and why, and make sure he has answered.
- **Verify facts; do not ask him.** "THIS IS NOT A MATTER OF OPINION, IT'S A VERIFIABLE FACT." Read the code, the docs and the recorded decisions before stating or asking anything.
- **Read the recorded decisions for a topic before discussing it.** The version-support discussion happened without reading the decision record on that topic, and the contradiction was found only afterwards.
- **Ask what a thing is for before designing it.** The maturity discussion went wrong until he pointed out that levels apply to products and convey reliability.
- **Present what established projects do, checked against their own pages,** and say which claims are from memory. Do not invent mechanisms or terms.
- **`spec.md` holds only what he agreed.** Make small, targeted edits. After every edit, give the result to a separate reviewer agent (Opus, high effort) told to hold the author to account, and fix what it finds. It found real defects every time.
- **Plain English, short messages, one question at most, no question box, no floating cards.** Explain each term the first time. He does not carry the session's shorthand in his head.

## Practical notes for this repository

- A hook rejects any shell command that contains the three letters of the other Node package manager's name, including inside a file path. Resolve such paths with `ls` and `grep`, and edit files with inline Python.
- Clones of the docs site and the sibling products were kept, gitignored, under `wip/repos/` in the earlier worktree: `web`, `composer`, `prisma-cli`, `pdp-control-plane`. A fresh worktree does not have them.
- Do not run the full integration suites locally.
