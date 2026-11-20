# Dispatch 4: fix what the final review and the final hands-on test found

**Spec:** `projects/migration-statements/slices/consent-text/spec.md` · **Review (read in full):** `projects/migration-statements/slices/consent-text/reviews/final-tip-review.md` (T01–T13) · **Hands-on test, round 3:** `wip/consent-text/qa3/` (transcripts, scripts, `brief.py`) · **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-5072cc` · **Branch:** `tml-3900-plan-stop-output`, pushed as draft pull request prisma/orm#31147 · **Ticket:** TML-3900

The constraints of dispatch 1 (`dispatches/01-build.md`, "Constraints, and why") hold; read them. Progress notes in `wip/consent-text/out/d4-progress.md`, updated as you go.

## Why

The purpose has not changed: a user whose change would lose data reads this output knowing their schema and nothing about this CLI, and every line it prints works when followed. The third hands-on round followed every printed line and found none that fails, so the main work is done. What is left is the edges a user reaches one step after a refusal: a second error in the old words, a line that names a candidate the other path would not, advice that does not fit the way the command was run. This is the last round before a human reviews the pull request, so prefer the smallest change that makes each text true, and do not restructure beyond what an item needs.

## Fix

1. **One answer to "which new names could it be"** (T01). The refusal and the `--rename` flag error decide separately which new models a removed model could have been renamed to, and disagree: the flag error lists variants and models that only moved with a renamed namespace, so a printed `--rename` can fail or rename the wrong model. One function decides, for every subject kind, and both use it. A test shows the two agree, and follows a printed line in the case that differed.
2. **"Add it to the contract and run `prisma contract emit`" when the plan is to a ref** (T02: `migration plan --to <ref>`, `db update --to <ref>`). Emitting does not change what a ref names, so the advice is false there. Say what is true for that case in all three places (the refusal line, the prompt sentence, the flag error), and test it.
3. **The CLI's own "flag was not needed" errors** (T03, T04, hands-on 2). `errorConsentUnused` in `cli-errors.ts` says "the question about User was already answered" and "Give one flag per question", and for a second `--allow User` it says the run asked something before anything was asked. Reword every text that function builds so it is true on each path and uses none of the slice's banned words: a second identical flag says one is enough and to remove one; a flag with the wrong verb beside the right one (`--delete Bug --allow Bug`) says the same as the `Remove …` line it would get alone. Put these texts under the vocabulary test. Then make the error reference and the spec say what the control API really does (it asks the other open questions before refusing a second flag), or make it refuse first if that is the smaller, safer change; say which you chose.
4. **A rename to a name the contract already had, given as a flag** (hands-on 3) gets the same plain words the prompt gives it, with the same code and `meta`.
5. **Texts at the prompt** (hands-on 1, 4, 5). A reason shown alone on a line starts with a capital letter. Where the prompt tells the user to do something the prompt cannot take (give a `--rename` of the model, or add to the contract and run again), it says to stop this command and run it again with that. "delete lets them go" has a noun in its own sentence.
6. **The suggested rename after a wrong `--rename`** (hands-on 6) says it goes in place of the flag that was given.
7. **Two `Remove` lines for one flag** when a namespace is removed (T08): one line, and it is true.
8. **Lists of several subjects** (T09, hands-on 9): an access change of a model reads `model "User"`, as a data change does.
9. **Structure** (T07): the ways to keep the data and their subject-naming forms are one list of pairs, not two arrays matched by position, and the merge compares what they are, not rebuilt strings. The type is newly exported, so change it now.
10. **`questionText` and `{bin}`** (T06): the exported function does not hand callers a literal `{bin}`; the upgrade note's example is right.
11. **Tests and files** (T10, T11): no test file this branch touches grows past 500 lines where it was under, and none that was already over grows; a test shows the dry run listing two access changes of one model under one `--allow`.
12. **Upgrade note** (T05): the reworded `MIGRATION.STATEMENT_UNRESOLVED`, the control API's changed code for a repeated `delete`, and `appliedStatements` holding one entry per flag with `operationIndexes` (including the changes a data protection policy allows without a flag).
13. **Spec** (T13): "Done when" numbered in order; the design matches the texts and behaviour as built after this round.

## Record as deferred, do not fix

In `projects/migration-statements/deferred.md`: on MongoDB, `--delete` of a field fills a new required top-level field with a temporary value and the refusal does not say so (update the existing entry if one covers it); the storage headline repeating "named by its storage name because the contract before this change is not known" once per table; anything above you had to leave.

Do not edit `wip/consent-text/pr-body.md`; list in your report every statement in it that this round makes false or newly true.

## Done when

Every check of dispatch 1 passes on the tip, with output saved under `wip/consent-text/out/d4-chk-*.txt`; every journey this round's changes can affect is re-run after the last source change (say which, and why the others cannot be affected); each item above is fixed or recorded with a reason; a test follows each printed line this round changed.

## Report

Final message, plain English, short sentences: one row per item with what is now true and the test; every text that changed, in full; the choice made under item 3; what in the pull request description is now false or newly true; anything left, with the reason; commits; checks and journeys with results; what you did not verify.
