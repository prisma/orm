# Handover: Database change policies

Written 2026-11-24 by the agent aslan-59, ahead of a rate limit. It replaces the 2026-11-11 handover by eratosthenes-31. Delete this file at project close-out.

## The project in one paragraph

On 2026-10-15 an agent proposed resetting a shared development database, because nothing in the system said which databases may be moved directly with `db update` and which may change only through reviewed migrations. This project (Linear project P-TML-1165) makes every database record two policies in its marker: a **change policy** (may it be changed by migrations, by `db update`/`db sign`, or both) and a **data protection policy** (are data loss and access changes forbidden, allowed with consent, or permitted). A ref file declares the policies its database should have. Every command that changes a database obeys them, and a database's policy changes only through a deploy given `--permit-policy-change`. Composer (`prisma deploy`) must show the ORM's errors and apply the policies too.

## Where things stand

| Piece | Repo | State |
| --- | --- | --- |
| The off-graph migration error explains its cause and gives working recoveries (TML-3725) | prisma/orm | Merged, [#30866](https://github.com/prisma/orm/pull/30866). Released in 8.0.0-rc.24. |
| Policies are recorded, compared and enforced for the change policy (TML-3727) | prisma/orm | Merged, [#30926](https://github.com/prisma/orm/pull/30926). Released in 8.0.0-rc.25. |
| Data protection is enforced in `db update`, `db migrate` and `migration plan --to <ref>` (TML-3728) | prisma/orm | Merged, [#31087](https://github.com/prisma/orm/pull/31087), plus the advice fix [#31131](https://github.com/prisma/orm/pull/31131). Released in 8.0.0-rc.25. |
| A failed Composer deploy shows the ORM's own migrate error (TML-3726) | prisma/composer | **In progress.** Branch `tml-3726-show-orm-migrate-errors`, pushed, 11 commits, no pull request. Design still being settled with Will; see below. |
| Composer applies and compares policies during a deploy (TML-3729) | prisma/composer | **Not started. Now unblocked:** 8.0.0-rc.25 was released on 2026-11-23 and Composer's main uses it. |
| A CLI command writes a ref's policies (no ticket yet) | prisma/orm | **Not started, not designed.** Added to `plan.md` as slice 6 on 2026-11-23. Bring the proposed command syntax to Will before building. |
| Close-out | prisma/orm | Not started. |

## Read these first

1. **This session's transcript** (aslan-59, 2026-11-11 to 2026-11-24): `/Users/wmadden/.claude/projects/-Users-wmadden-Projects-prisma-orm--claude-worktrees-database-change-policies-handover-c36337/c895892d-37fa-4593-b23b-46261481329a.jsonl`. The last part, from "what's next for this project?", holds the whole Composer design discussion. Read Will's messages in it in full.
2. The previous session's transcript (eratosthenes-31): `/Users/wmadden/.claude/projects/-Users-wmadden-Projects-prisma-orm--claude-worktrees-database-change-policies-59f270/92b3ef91-3ae3-42f6-b183-fdb935e8a31c.jsonl`.
3. `projects/database-change-policies/spec.md`, `design.md` and `plan.md`, and the decision record `docs/architecture docs/adrs/ADR 320 - Databases record a change policy and a data protection policy.md`.
4. In prisma/composer: `CLAUDE.md`, `docs/design/01-principles/`, `docs/design/90-decisions/ADR-0022-data-deps-carry-a-prisma-orm-contract.md` and `ADR-0044-errors-are-structural-envelopes-with-dotted-namespace-codes.md`. Composer requires you to read its design docs before any design reply.
5. For the Composer error work: `slices/2-composer-shows-orm-errors/spec.md` and the two reviews in `slices/2-composer-shows-orm-errors/reviews/` (copied from the Composer clone; the reviews cover an earlier commit than the branch tip).
6. The memory file `project-database-change-policies.md` and the feedback memories it links.

## The work in flight: a failed Composer deploy shows the ORM's migrate error

**What is built.** In prisma/composer, branch `tml-3726-show-orm-migrate-errors` (tip `4903db89`, 5 commits behind Composer's main on 2026-11-24). `packages/1-prisma-cloud/1-extensions/target/src/orm-migrate.ts` calls the ORM control client's `migrate`. When it fails, Composer now raises `PrismaOrmError` (a subclass of Composer's `CliStructuredError`) carrying the ORM's code, message, why, recovery steps and docs link. `OrmMigrationError` remains only for the four checks Composer makes itself before the ORM runs. The deploy summary's cause limit went from 1000 to 4000 characters. Docs, the skill, ADR-0022 and ADR-0044 are amended. Last full verification, before the final design change below: target package 726 tests pass, framework CLI 546 pass, typecheck and lint pass.

**The design question Will and I were settling.** The ORM writes its recovery steps for a person who ran `prisma db migrate`. A Composer user ran `prisma deploy`. What Will decided, in order:

- He rejected a table in Composer that maps ORM error codes to Composer's own advice. "I don't want this mapping table. I want a generic method that lets us pass ORM errors through and have users address them themselves. They know better than Composer does, how to deal with ORM failures."
- "But for this to work, Composer needs a very simple policy for how it manages the ORM on your behalf." I proposed the policy ADR-0022 already records: for each database, a deploy compares the marker with the target (the ref named by `targetRef`, else the emitted contract); if they differ it runs the equivalent of `prisma db migrate --to <target>`; it never plans, and never runs `db update`, `db init` or `db sign`. Will: "That's the policy idea I had in mind. I think the specifics need some more polish though."
- He found a line printed on every error cumbersome, and the phrase "It runs nothing else" pointless. So: at most one short line naming the command Composer ran, and consider putting it on the failed deploy step instead of in every error. Show Will the exact output before opening the pull request.

**Unanswered when the session ended.** The ORM's advice contains `--db <url>`. Will asked why, since the command asks for the flag when the config has no connection. My answer, which he has not replied to: my branch tells the ORM to print it (`dbGiven: true` in the invocation), because in a Composer app `prisma.config.ts` usually names the local development database. Without the flag, a copied `prisma db update` runs against the local database, reports success, and leaves the deployed database untouched. I suggested keeping the flag and having the one Composer line say which database was migrated, for example "(not the one in prisma.config.ts)". Wait for his answer; do not assume it.

**Known gap.** For a deployed database Composer has no command that prints the connection string (the deploy output never prints it, because it is a secret); the user copies it from the Console. Locally, `prisma dev url <address>` prints it. I told Will I would add one sentence to the deploy guide saying where to find it.

**Left to do on this branch.** Settle the output with Will; implement it; merge Composer's main in; run `/drive-code-review` without the walkthrough on the tip and fix findings; manual QA; open the pull request as a draft until review and QA cover the pushed tip; turn on Auto-fix; start a background watch; turn on auto-merge when approved. The earlier system-design review also suggested moving the error renderer into Composer's framework CLI; that is undecided.

**Test obstacle.** On 2026-11-23 the migrate integration tests could not start Postgres: 32 Postgres servers from other sessions had used up shared memory. Do not kill other sessions' servers. Retry, and tell Will if it persists.

## Decisions by Will to respect

- `migration plan --to <ref>` keeps refusing a plan the ref's policy forbids ("no keep it"). Do not raise it again.
- Never start a release unasked. I opened release pull requests on 2026-11-20 without being asked and Will had me close them ([prisma/orm#31140](https://github.com/prisma/orm/pull/31140), prisma/web#8877). The branch `release/8.0.0-rc.25` on the bot remote is now obsolete; the real release was [prisma/orm#31180](https://github.com/prisma/orm/pull/31180).
- The policy concept is exempt from the rule against changing the framework domain (Will, 2026-10-30). Text-building code still stays out of the framework.
- A `db policy set` command that changes a database directly stays rejected. The planned ref command only writes the ref file, which does not reverse that.
- A pull request with review, QA or fixes still in progress is a draft. A known defect that missed a merge gets its own pull request at once.

## Known gaps in the released ORM work

Filed as tickets on 2026-11-18; I have not rechecked their state:

- Adding or changing a row-level security policy is not counted as an access change (TML-3843).
- `db update --to <ref>` can fail with an unexpected-error code (TML-3844).
- The advice for `--allow` is printed twice (TML-3845).

## Where the code is

- prisma/orm: everything is on `main`. The only unmerged branch is `aslan-59/policy-ref-command-plan` on the bot remote (`git@github-wmadden-electric:prisma/orm.git`), which holds the slice 6 plan entry, this handover and the Composer slice's spec and reviews. It has no pull request; it rides along with the next real ORM pull request of the project.
- prisma/composer: branch `tml-3726-show-orm-migrate-errors` on `git@github-wmadden-electric:prisma/composer.git`. The old clone is at `wip/composer` inside the worktree `database-change-policies-handover-c36337`; a fresh worktree should clone again under its own `wip/`.

## Next steps, in order

1. Get Will's answer on `--db <url>` and the exact deploy output, then finish and open the Composer error pull request.
2. Build the Composer policy piece (TML-3729): the deployment resource accepts `permitPolicyChange` (default `false`) and passes it to the control API, and the "already at target" check also compares the ref's declared policies. Settle any open design with Will first.
3. Propose the syntax of the CLI command that writes a ref's policies, then build it.
4. Close out the project, following Drive's `close-project.md` and the repo's `drive/` overlays.
