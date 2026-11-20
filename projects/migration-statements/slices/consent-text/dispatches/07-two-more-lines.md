# Dispatch 7: two more lines that fail when followed

**Review (read the section "Verification of the fixes"; it has the exact texts and transcripts):** `projects/migration-statements/slices/consent-text/reviews/last-check.md` (L09, L10, L11) · **Hands-on material:** `wip/consent-text/qa6/` (`q6.py`, `common.py`, 26 transcripts) · **Spec:** `projects/migration-statements/slices/consent-text/spec.md` · **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-5072cc` · **Branch:** `tml-3900-plan-stop-output`, pushed as draft pull request prisma/orm#31147 · **Ticket:** TML-3900

The constraints of dispatch 1 (`dispatches/01-build.md`, "Constraints, and why") hold; read them. Notes in `wip/consent-text/out/d7-progress.md`.

## Why

The verification of the last round followed its lines by hand and found two more that fail, both in advice for rare variant cases. A human is waiting to review this pull request. The aim now is narrow: in these two cases the output must not tell the user to do something that fails or that moves data they were not told about. Where the text cannot give advice that works, it says less. Change only these texts and their tests.

## Fix

1. **L09: the field form of the shared-storage refusal.** `Bug.label` shares column `title` with `Task.title`; `--rename Bug.label:Bug.heading` is refused. The refusal then says the run without the rename "says what the change would delete" and to give `--delete Bug.label`. Neither is true for a field: the run without the rename stops for nothing, the values stay in `title`, `Bug.heading` starts empty, and `--delete Bug.label` is refused as a flag that did nothing. Run the case first (the transcripts show it) and write what is true for the field form on PostgreSQL and SQLite, both commands: no `--delete`, and what happens to the values. The model form, which the last round fixed and which works when followed, stays as it is. A test follows the field form's advice and reads the data back.
2. **L10: a variant whose whole hierarchy is removed.** `Task`, `Bug` and `Epic` are removed; `--rename Bug:Nope` says to add model `Nope` to the contract, emit, and run again. Followed with a plain model `Nope`, the next run renames table `task` to `nope`, and the rows of `Epic` become rows of `Nope`; nothing said so. For a variant whose base the contract no longer has, the output does not advise adding a model for the variant. It says what is true: the variant's rows are rows of its base, which this change removes too, so what happens to them is decided by the base (rename the base, or delete it). Applies to the refusal line, the prompt sentence, the flag error and the typed reason. A test asserts each text in full, and follows the advice it now gives.

## Record as deferred, do not fix

In `projects/migration-statements/deferred.md`:
- The planner defect behind L10, with the full scenario from the review and the transcript path: with `Task`, `Bug` and `Epic` removed and a plain model `Nope` added, `--rename Bug:Nope` plus the deletes the next run asks for renames table `task` to `nope`, and the rows of `Epic` become rows of `Nope`. Say which code plans it, and that this work did not cause it. Put it beside the entry "A variant with a table of its own renamed to a model that is no variant…"; both are filed as TML-3906.
- L11: with the base renamed and the new variant already added, the texts still say to add it and do not offer the rename, because the names offered read the base from the contract before the change. Typing the rename works.

Update the spec to match the two texts. Do not edit `wip/consent-text/pr-body.md`; list in your report every statement in it that this round makes false or newly true.

## Done when

Every check of dispatch 1 passes on the tip, output under `wip/consent-text/out/d7-chk-*.txt`; every journey that asserts a text you changed passes, run alone after the last source change; a test follows each of the two pieces of advice; nothing outside these items changed.

## Report

Final message, plain English, short sentences: each item with what is now true and the test; each text before and after, in full; what you saw when you ran each case; what the pull request description now gets wrong or right; commits; checks and journeys with results; what you did not verify.
