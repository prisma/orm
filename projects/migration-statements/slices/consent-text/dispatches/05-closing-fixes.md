# Dispatch 5: the closing fixes

**Spec:** `projects/migration-statements/slices/consent-text/spec.md` · **Review (read in full):** `projects/migration-statements/slices/consent-text/reviews/closing-review.md` (C01–C13) · **Hands-on test, round 4:** `wip/consent-text/qa4/` (184 transcripts; `new4.py`, `tty4.py`, `adhoc2.py` show how each case is set up) · **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-5072cc` · **Branch:** `tml-3900-plan-stop-output`, pushed as draft pull request prisma/orm#31147 · **Ticket:** TML-3900

The constraints of dispatch 1 (`dispatches/01-build.md`, "Constraints, and why") hold; read them. Progress notes in `wip/consent-text/out/d5-progress.md`, updated as you go.

## Why

Four hands-on rounds have now followed every line this output prints. In the last one, one printed line failed when followed and two texts were false; everything else is wording. This dispatch closes those and stops. Keep each change as small as makes the text true. Do not restructure, rename or move anything an item does not require: every further change needs another review before a human can look at the pull request.

## Fix

1. **A removed variant's rename line fails when followed with an unrelated model** (hands-on defect 1; `wip/consent-text/qa4/transcripts/new4-variant-*`, `adhoc2-variant-*`). `Bug` is a variant stored in its base's table; the line says to add the model under its new name and pass `--rename 'Bug:<new name>'`; with a new model that has its own table this fails with `MIGRATION.PLANNING_FAILED Cannot rename table "task" to "issue"`. The line must say what the new name has to be for the rename to work (a variant of the same base), and a test follows it. The failure text a user then gets from the SQL family (`statement-planning.ts`, the shared-storage refusal of a `--rename`) says a "question" about the model "offers this same rename again", which is false here: make that text true and free of the banned words. It is family text, not framework.
2. **The last line of the "had before" error states a guess as a fact** (C07, hands-on 2): `…takes the name of field "Shop.id", which this change renames or removes`. Say it only when it is so; otherwise say what is true. It names `prisma contract emit` where a contract edit is needed, and it does not say "migrations" or "plan" on `db update`, where the user runs the command twice. A test follows it to the end on both commands.
3. **The same reason typed at the prompt** (hands-on 3, C04) gives the next step the flag form gives.
4. **Following the `--to` advice changes what the command plans to** (C05). The line says so: the run without `--to` plans to the contract just emitted, not to what the ref names. Check `db update --to <ref> --permit-policy-change`, where the review says following the line fails; if so, make the line true for it or record it.
5. **The flag error's candidates depend on the order of the flags** (C02): `--rename Bug:Nope --rename Task:Ticket` offers `--rename Bug:Ticket`, which then fails. The candidates take every rename on the command line into account.
6. **A flag that names something real which this change leaves alone** (hands-on 8): `--delete Shop`, with `Shop` unchanged, gets `nothing in this change is called that`. Say that this change does not delete its data, as the wrong-verb line does.
7. **Small wording**: `use --rename Bug:Defect in place of --rename Bug:Nope` (hands-on 9: the colon after the old flag reads as part of it); `The contract that --to next names has no field …` (hands-on 10); the prompt rejection `The rename's old name is not "Store.legacy". Write it as …` reads as if that name were forbidden (hands-on 7): say what to type; the `--help` of both commands says "lists every question" (hands-on 12).
8. **A test for `db update --to`** with the new wording (C09): today removing the line that passes `to` breaks no test.
9. **Docs and spec** (C01, C06, C08, C12): the error reference shows `model "User"` and says on which paths a wrong-verb flag is refused before anything is asked; the upgrade note covers the CLI's reworded `CLI.CONSENT_UNUSED` texts and the removed `why`; the spec says who decides namespace candidates as the code has it.

## Record as deferred, do not fix

In `projects/migration-statements/deferred.md`, each with the scenario: namespace candidates decided in two places (C01); a program calling `dbUpdate` with a stored contract and `ref` but no `invocation.to` (C03); two functions that put the CLI's name in place of `{bin}`, one in the control API importing from the command layer (C13); the two MongoDB journey files over 500 lines that grew (C10, already recorded: check it is accurate); a swap given as two `--rename` flags in one run still printing `Cannot resolve statement … origin contract` (hands-on 4); `db update --dry-run --delete Nope` printing `Statement … answers no question of the plan` (hands-on 6); anything above you had to leave.

Do not edit `wip/consent-text/pr-body.md`; list in your report every statement in it that this round makes false or newly true.

## Done when

Every check of dispatch 1 passes on the tip, output saved under `wip/consent-text/out/d5-chk-*.txt`; every journey this round's changes can affect is re-run after the last source change; each item is fixed or recorded with a reason; a test follows each printed line this round changed.

## Report

Final message, plain English, short sentences: one row per item with what is now true and the test; every text that changed, in full, before and after; what the pull request description now gets wrong or right; anything left, with the reason; commits; checks and journeys with results; what you did not verify.
