# Dispatch 6: the two lines the last check found failing

**Review (read in full; it has the exact texts, locations and transcripts):** `projects/migration-statements/slices/consent-text/reviews/last-check.md` (L01–L08) · **Hands-on material:** `wip/consent-text/qa5/` (`q5.py`, 48 transcripts) · **Spec:** `projects/migration-statements/slices/consent-text/spec.md` · **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-5072cc` · **Branch:** `tml-3900-plan-stop-output`, pushed as draft pull request prisma/orm#31147 · **Ticket:** TML-3900

The constraints of dispatch 1 (`dispatches/01-build.md`, "Constraints, and why") hold; read them. Notes in `wip/consent-text/out/d6-progress.md`.

## Why

A check of the last fix round followed its new lines by hand and found two that fail, both in text that round wrote. A human is waiting to review this pull request, and each further round of changes delays that and risks new edges, as the last one did. So: fix exactly these, with the smallest change that makes each line true and followable, prove each by following it in a test, and touch nothing else.

## Fix

1. **L01.** On PostgreSQL the SQL family's shared-storage advice says `give --delete for model "public.Bug" in its place`, and `--delete public.Bug` is then refused with `Remove --delete public.Bug: this change does not delete the data of anything called that.`, which is also false. The advice must give the value the CLI accepts for that model (and for the fields form), on PostgreSQL and SQLite. Find why the namespace-qualified name is refused: if the advice names it wrongly, fix the advice; if the CLI should accept the qualified name of a model in the default namespace, say so in your report and fix the advice only. A test follows the advice on PostgreSQL to a run that succeeds, and reads the data back.
2. **L02.** The line for a removed variant says `as a variant of model "Task"`, naming the base as the contract had it before the change. When the same run renames the base (`--rename Task:Work`) or removes the whole hierarchy, following it fails (`PSL_UNRESOLVED_REFERENCE: Cannot find entity "Task"`). Name the base as the contract has it now; where the contract no longer has a base, do not tell the user to add a variant of it. Applies to the refusal line, the prompt sentence, the flag error and the typed reason. A test follows the line in the renamed-base case.
3. **L03.** At the prompt the shared-storage advice says "Leave out this --rename" and "the command then stops", when the user typed the rename and gave no flag. Make it true there, as the other prompt forms are.
4. **L07.** The `--help` text of both commands still says "Where nobody can answer".
5. **Docs** (L05, L06, L08): the error reference does not claim that offered namespace names leave out the names other `--rename` flags give; the upgrade note attributes `names nothing whose data this change deletes` to the command line, and says what the control API gives; the spec's reason for the variant line is true for a variant with its own table too.

## Record as deferred, do not fix

In `projects/migration-statements/deferred.md`, with the scenario from the review: L04, a namespace renamed to a namespace both contracts have still gets `Cannot resolve statement … origin contract` as a flag and an unrelated hint at the prompt. Also the item the review lists as outside this diff: `--rename Bug:Issue` for a variant that has its own table succeeds and leaves the base table's rows holding `type='bug'`, a value no variant claims any more. Give the full scenario, the transcript path, and the files that plan it; say plainly that it is a data defect in the planner and was not caused by this work.

Do not edit `wip/consent-text/pr-body.md`; list in your report every statement in it that this round makes false or newly true.

## Done when

Every check of dispatch 1 passes on the tip, output under `wip/consent-text/out/d6-chk-*.txt`; every journey that asserts a text you changed passes, run alone after the last source change; a test follows each of the two lines; nothing outside these items changed.

## Report

Final message, plain English, short sentences: each item with what is now true and the test; each text before and after, in full; what you found about why `--delete public.Bug` was refused; what the pull request description now gets wrong or right; commits; checks and journeys with results; what you did not verify.
