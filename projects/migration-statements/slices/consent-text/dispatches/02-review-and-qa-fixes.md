# Dispatch 2: fix what the two reviews and the hands-on test found

**Spec:** `projects/migration-statements/slices/consent-text/spec.md` · **Reviews (read both in full; they carry the evidence and locations):** `projects/migration-statements/slices/consent-text/reviews/system-design-review.md` (S01–S16), `reviews/code-review.md` (F01–F12) · **Hands-on test transcripts:** `wip/consent-text/qa/transcripts/` and scripts beside them · **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-5072cc` · **Branch:** `tml-3900-plan-stop-output` · **Ticket:** TML-3900

The constraints of dispatch 1 (`dispatches/01-build.md`, "Constraints, and why") hold; read them. Progress notes in `wip/consent-text/out/d2-progress.md`.

## Why

The purpose is unchanged: a user whose change would lose data reads this output knowing their schema and nothing about this CLI. The first build got the main case right. The reviews and the hands-on test found places where the text is still about the tool, where a printed flag does not work when followed, and where one fact is decided in more than one place. A printed line that fails when the user follows it is the worst of these: fix every one and prove it by following the line in a test.

Fix the class, not the instance: each item names one example; find the others.

## Decisions already made (apply them; update the spec to match)

1. **Several things open.** The summary says what would happen, not that "answers" are needed: all data loss → `This change would lose data: model "Bug", model "Task".`; all access → `This change would change who can read and write data: "User".`; mixed → `This change would lose data and change access: …`. In `why`, a blank line separates each paragraph if the engine renders it cleanly; check the rendered output.
2. **A rename line the user cannot follow as printed.** When exactly one new name is possible, keep the line. When several are possible, the line says to put the new name in and lists them. When none is possible (the contract has no new model, field or member it could be), the line says the contract must first have it under its new name. In every case, following the line as a careful reader would must work; a test follows each.
3. **Flags that did nothing.** `Remove --delete Nope: nothing in this change is called that.` and the same idea for `--confirm` and `--yes` (`--yes does not allow this: it would delete data.`). A test shows that removing the flag and adding the printed one works.
4. **Words.** The built texts do not use "statement", "question", "answer", "asks about" or "needs N answers". Extend the vocabulary test to these words and to every note and advice string the commands add (S16, F05). Where a target's advice string reaches the refusal with such a word (F04, `mongo-enum-value-planning.ts`), reword it in the target: that is target text, not framework.
5. **One name per contract.** In this slice's texts the contract the user is planning to is "the contract" and the other is "the contract before this change". Not "origin", "destination" or "the contract the database is at" (S08). The snapshot recovery steps may explain once what "before this change" means for `db update`.
6. **Access wording.** One verb, "change": `Access to the data of "User" would widen.` / `Access to the data of "User" would change.` (S15, F10).
7. **What the plan would run.** The line lists only the operations that cause this loss, so it must not read as the whole plan: `The operation of the plan that does this: <label>.` / `The operations of the plan that do this:` with one `- <label>` line each.
8. **"Removing …" only when known.** When only the subject's model or namespace is missing from the contract, the CLI does not know the subject was removed; use `This change would delete …` (F03). A change that is not a removal says what changed, with the values the CLI knows (S09).
9. **Two access changes on one model (F02, TML-3845).** First look at whether the access changes of one subject can be one question that lists every operation, as data-loss operations of one subject already are, so that one `--allow User` allows them all, on the refusal, the prompt and the dry run. Do it if it is local to how questions are built and each change is still recorded as allowed where the access-change record expects it (another team's recent work: read `upgrade-instructions/pending/recorded-access-changes/` and the code it describes before touching this). If it is not local, keep one flag per change, make the printed line work when followed on every path (including when one flag was already given), and report what stands in the way.
10. **`CLI.PROMPT_INVALID` (S01).** The multi-line prompt text now lands inside this engine error. Rebuild it in the CLI as the refusal is rebuilt: the headline and the CLI's own reason. Assert it in full.

## The rest, each to be fixed as the review describes

S02 (derive `verbs`, `forms` and the prompt text from the answers where questions go to the engine), S03 (advice that names a flag is an answer line, not a `why` line), S04 (two lines give `--delete` opposite meanings), S05 (a removed namespace is its own group, before its models), S10 (names say what a thing means), S11 (decide "type change" once; an internal error for a combination the CLI has no words for), S12 (an internal error, not the engine's old text, when nothing matches), S13 and F08 (delete the "text after the last `: `" sentence from the upgrade note), F01 (match the engine's open entries to questions by subject and verbs), F06 and F07 (whole-text assertions), F09 (error reference: the `--yes` line for a type change), F12 (export the types `PlanQuestion` now needs; one sentence in the upgrade note about `question.question`).

From the hands-on test, also: the prompt sentence for a type change reads `convert writes a conversion for you to fill in; delete lets the database cast the values, which can change or lose some.`

## Record as deferred, do not fix

Add to `projects/migration-statements/deferred.md`, each with the scenario and where the text is built (S14, F11 — also correct the two existing entries the reviews name): the engine requests (a description beside each choice in the prompt; a `meta` field for why nobody could answer, which would remove the `--yes` text read; `CLI.PROMPT_CANCELLED` quoting the whole prompt; the engine's own `CLI.CONSENT_UNUSED`); "statement" in `MIGRATION.STATEMENT_*` texts, the `Statements applied` heading of success output, the SQL and MongoDB advice strings and the docs; the dry-run list that renders the same subjects another way; an operation label that shows a policy's stored name, not its contract name; the enum delete line not saying what the rows then hold; whatever you could not do under decision 9.

## Done when

Dispatch 1's checks all pass again on the tip, every item above is fixed or recorded with a reason, the spec matches the texts as built, and for each refusal in the hands-on test's list (`wip/consent-text/qa/`) a test follows each printed line and checks the result.

## Report

Final message, plain English, short sentences: one row per item (S, F, decision number or hands-on defect) with what is now true and the test; every text that changed, in full; what you decided under 9 and why; anything left, with the reason; commits; checks with results; what you did not verify.
