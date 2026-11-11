# Handover: MongoDB `prepare()` (TML-3792), slice 2

Written 2026-11-11 by raskolnikov-51, who stopped because of rate limits. Read this first, then `spec.md`, `plan.md` and `deferred.md` in this folder.

## What the project is

MongoDB clients get `prepare(declaration, callback)`, matching what SQL clients already have (ADR 210). MongoDB has no server-side prepared statements, so the saving is on the client. The callback, plan building and structural lowering run once. Each run fills in the values, runs `beforeEncode`, encodes each value with its declared codec and sends the command.

```ts
const db = mongo({ contract, url });
const byStatus = await db.prepare(
  { status: 'mongo/string@1', take: 'mongo/int32@1' },
  (p) => db.query.from('accounts').match((f) => f.status.eq(p.status)).limit(p.take).build(),
);
const rows = await byStatus.query(await db.runtime(), { status: 'active', take: 20 }).toArray();
```

- Linear: TML-3792 (In Progress). Earlier PRs said "Part of TML-3792". The slice 2 PR should close it.
- Design record: `docs/architecture docs/adrs/ADR 318 - MongoDB prepared statements.md` on main.
- Design sign-off: two Fable reviewers (an architect and a principal engineer) agreed to the design over three rounds. Will said: "If the architect and PE (run as Fable subagents) are satisfied, I'm satisfied." Do not take design questions about this project to Will. Settle them from the code, or with Fable reviewers.

## Where it stands

- **Slice 1 is merged** ([prisma/orm#30967](https://github.com/prisma/orm/pull/30967)). It covered the runtime, the query builder, the `mongo()` client's `db.prepare` for query-builder plans, ADR 318 and the docs. It also added `RUNTIME.PREPARE_UNDECLARED_PARAM`: `prepare` refuses a placeholder whose name, codec id or nullability the declaration does not give.
- **Slice 2 is in progress.** It adds ORM reads, `.prepared.all()` and `.prepared.first()` (spec D9).
  - Branch: `tml-3792-mongo-prepare-orm-reads`, cut from main at e118f389f2 and pushed to the `bot` remote.
  - The tip has one commit marked WIP, holding the implementer's dispatch 5 work as it was when it was stopped. **That work is not verified.** No typecheck, test or review has been run on it. It was about to add a write-side regression test to `orm/test/collection.placeholders.test.ts`.
  - The files in that commit:
    - `query-ast`: `query-plan.ts` and `exports/execution.ts`.
    - `orm`: `collection.ts`, `collection-state.ts`, `orm-param.ts`, `types.ts`, the new `prepared-collection.ts`, and tests (`collection.prepared.test.ts`, `prepared-reads.test-d.ts`, `integration/prepared-reads.test.ts`, `fixtures/lists-contract.ts`, `collection.placeholders.test.ts`, `where-list-fields.test-d.ts`).
    - `query-builder`: `exports/index.ts`.

## What to do next

1. **Check out the branch** in a fresh worktree, then run `pnpm install` and `pnpm build`. Run every command through `mise exec --`.
2. **Finish dispatch 5** (`plan.md`, "Slice 2 dispatches").
   - Read the WIP diff: `git show HEAD~1`, or whichever commit is titled WIP.
   - Run the gate: `pnpm typecheck`, `pnpm test --coverage` and `pnpm lint` in each touched package, and `pnpm lint:deps`.
   - Fix what fails, and finish the missing write-side test.
   - Copy the Postgres pattern: the SQL ORM's `.prepared` reads, SQL's `Preparable`, and `prepareQuery` in the Postgres facade.
3. **Have a reviewer check dispatch 5.** Use an Opus subagent with a principal-engineer stance, and fix what it finds.
4. **Build dispatch 6:**
   - The facade's `mongo.ts` accepts a `MongoPreparable` and wraps the handle with its consumer.
   - Integration tests through `mongo()`.
   - Docs:
     - an ADR 318 section on ORM reads;
     - remove "ORM reads cannot be prepared yet" from `skills/prisma-8/references/queries-mongo.md`;
     - the READMEs;
     - a release-note fragment;
     - upgrade instructions if a public type changes.
5. **Run `/drive-code-review` without the walkthrough** on the whole branch. Fix the findings and re-review. Then do manual QA on the pushed tip, using only the public `@prisma/orm-mongo` entry points against an in-memory replica set. The last review and the QA must both cover the commit you push.
6. **Merge main and open the PR.**
   - Before pushing, run `pnpm test --coverage` in each touched package, because CI requires per-package thresholds, often 100%. Also run `lint:ratchets`, `check:upgrade-coverage --mode pr`, `fixtures:check`, `check:error-reference` and `lint:docs`. Those checks run only in CI, not in `lint:agent`.
   - Title: "TML-3792: …", a plain sentence saying what a user can now do, with no conventional prefix.
   - The description opens with a code example and gives the decision first. Alternatives go last.
   - End the description with the line `Agent: <name>` above the attribution line.
   - Turn on auto-merge. Auto-fix cannot be enabled, because the bot is the PR's author.
7. **Close out after the merge,** following the Drive close-out:
   - a retro;
   - the DoD evidence;
   - file the `deferred.md` items as tickets, after searching Linear first;
   - delete `projects/mongo-prepare/`;
   - set TML-3792 to Done.

## Decisions already made (do not reopen)

- **The runtime is the only target.** Handles run against `await db.runtime()`, as on Postgres. The client is not a prepared target. TML-3812 is filed to decide that for every client family.
- **Update and delete plans get `MongoPreparedExecution`,** with both `.query()` and `.execute()`. Read plans get `MongoPreparedStatement`, with `.query()` only.
- **A placeholder in an ORM write or a value-object literal is refused** with `ORM.ARGUMENT_INVALID`, through `ormParam` in `orm/src/orm-param.ts`.
- **Where a placeholder may go in ORM reads (spec D9).** The pass-through goes only in `#compileWhereObject` and `#encodeFieldFilter`. A placeholder is accepted:
  - as a top-level field value in an object-form `where`;
  - in a filter-expression `where` on a scalar field, including a scalar inside a value object, such as `address.city`;
  - in `limit` and `offset`.
- **A placeholder in a filter-expression `where` on a field that is not a scalar** is refused with `ORM.ARGUMENT_INVALID` (decided 2026-11-11).
- **Placeholder types.** On a list field, the placeholder's codec is the element codec, and it must not be nullable. A nullable placeholder is allowed only on a nullable field.
- **`first()` sets `limit` to 1.** A declared `limit` placeholder that this replaces fails as unused.

## Rules for this work

- Never change `packages/1-framework`. If a design needs that, stop and tell Will.
- Use Opus for every subagent. Never use Fable, except for design reviewers when Will asks for them.
- Never run `pnpm test:integration`, `test:e2e` or `test:all` in full. Run single files with `pnpm test <file>` inside `test/integration`.
- Push only to the `bot` remote. Commit with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`. Add no AI attribution lines, and never amend, rebase or force-push.
- Do not use /tmp. Keep scratch files under `wip/` in the worktree.
- Will wants to be interrupted only for real design decisions, and then with a recommendation. Write to him in short, plain sentences, never through the question UI. Do not mention review IDs or ticket numbers without saying what they are.

## Context sources

- Full transcript of the previous session, which covers slice 1 design, reviews and fixes: `/Users/wmadden/.claude/projects/-Users-wmadden-Projects-prisma-orm--claude-worktrees-hachiko-68-handoff-0b6e45/38d16481-14d0-43da-8989-9185a54ddc99.jsonl`. It is large, so search it, and do not read it whole.
- The memory file `project-client-surfaces.md` in the agent memory folder holds the history of the earlier client-surface work that led here.
- Slice 1 review records were gitignored and are lost with the old worktree. Their findings are fixed on main.
