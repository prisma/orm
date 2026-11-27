# Dispatch 65 (MongoDB): fixes from review round 46

**Input:** `projects/migration-statements/slices/stored-name-renames/reviews/pr2-round-46/`. Fix A109 and A110 in `system-design-review.md`, and F01 to F03 in `code-review.md`.

**Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-494725`. **Branch:** `gandhi-65/tml-3840-mongo-stored-name-renames`. **Tier:** Opus, medium effort.

Keep notes in `wip/mongo-stored-names/d38-progress.md` under "Dispatch 65". The rules of dispatch 28 hold:
- run only the test files you change, one per command;
- change nothing under `packages/1-framework` beyond `3-tooling/cli`;
- no AI attribution in commits;
- do not push;
- you may build.

The machine is heavily loaded. Run every heavy command through `lockf -t 3600 /Users/Shared/claude-shared/heavy-command.lock <command>`, and run each one as few times as you can.

## Fix

1. **The `MongoPrepareMember` break (A110).** My record's reason is probably wrong. Find the real cause:
   - Run `pnpm api:compat --only @prisma/orm-mongo` once at the tip, after `pnpm build` and `pnpm api:update`. Read the exact message.
   - Work out which change on this branch makes `MongoPreparedFrom` compare as a break. The likely suspects are the new optional properties on `RawAggregateCommand` or `RawDeleteManyCommand`, which `MongoPreparedFrom` infers through.
   - If a small change to our own declarations avoids the break without losing what we need, make it. One example would be a different place for the option, if the inference is what breaks.
   - Otherwise keep the record, and rewrite its reason to state the true cause in plain words, naming this PR (prisma/orm#31192).
   - Say whether the break is a real one for a user. That means: does code written against 8.0.0-rc.25 stop compiling?
2. **The `buildMongoContractFromDefinition` fingerprint (A109).** Set it to the value the tip gives. Take it from the same `api:compat` run, or from `scripts/public-api/fingerprint.mjs`.
3. **A test that cannot fail (F01).** The different-collations test must fail only the copy, not the count reads, so that it fails when `isCollation` always returns false. Check that with that mutation.
4. **A false message (F02).** The advice for an interrupted copy the runner does not recognise says that a re-run would copy the documents again. That is untrue for the planner's own `$merge` move, where a re-run is safe because `$merge` matches by `_id`. It is also untrue for a transform with a check. Either:
   - recognise the planner's `$merge` move shape and give it no such advice, as before; or
   - word the risk so that it is true in every case that reaches it, for example "may copy … again unless the copy matches by `_id` or has a check".

   Prefer the first. Fix the matching sentence in the error reference. Add a test for the `$merge` move.
5. **The misplaced doc comment (F03).** Put `stripCollationFields`'s doc comment back above it, in `canonicalize-introspection.ts`.

## Done when

- `mise exec -- pnpm build` is clean.
- `pnpm api:check` passes.
- `pnpm api:compat --only @prisma/orm-mongo` and `pnpm api:compat --only @prisma/orm-family-mongo` pass. Run each once, at the end.
- Typecheck and lint pass in the packages you change.
- `lint:deps`, `lint:ratchets`, `lint:docs` and `check:error-reference` pass.
- Every test file you change passes, each run on its own.

## Report

Plain English, short:
- for item 1, the real cause, whether users are affected, and what you did;
- for each other item, what changed and which test failed first;
- the commits;
- each check, with its result;
- the lines of `wip/mongo-stored-names/pr-body.md` to change, including the `@prisma/orm-mongo` line in its "API changes" section.
