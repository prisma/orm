# Dispatch 3: fix what the second review and the second hands-on test found

**Spec:** `projects/migration-statements/slices/consent-text/spec.md` · **Review (read in full):** `projects/migration-statements/slices/consent-text/reviews/follow-up-review.md` (R01–R14) · **Hands-on test, round 2:** transcripts and scripts in `wip/consent-text/qa2/` · **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-5072cc` · **Branch:** `tml-3900-plan-stop-output` (main is merged in) · **Ticket:** TML-3900

The constraints of dispatch 1 (`dispatches/01-build.md`, "Constraints, and why") hold; read them. Progress notes in `wip/consent-text/out/d3-progress.md`.

## Why

Same purpose as before: a user whose change would lose data reads this output knowing their schema and nothing about this CLI, and every line it prints must work when followed. The second round found fewer and smaller problems. The ones that matter most are where following a printed line leads straight into an error written in the old words, and where a line promises more than it does.

Fix the class, not the instance.

## Decisions already made (apply them; update the spec to match)

1. **A rename to a name the contract does not have** (R05, hands-on 1, 3, 4). Three places must speak in this slice's words and tell the user what to do: the line that says to add the subject first also says to run `prisma contract emit`; the rejection shown at the prompt and in the rebuilt `CLI.PROMPT_INVALID`; and the error a user gets when they pass such a `--rename` as a flag (`MIGRATION.STATEMENT_UNRESOLVED` for a rename whose new name the contract lacks). Each says the contract has no such field, model or member, names the ones it could be if any, and says to add it and emit. No "statement", "origin contract", "destination contract" or "resolve". The rebuilt error does not name a flag the user did not give. The error code and `meta` stay.
2. **The line for a field whose model is missing** (hands-on 2) promises only what it does: `If model "Shop" was renamed to "Store", say so first: --rename Shop:Store`.
3. **Access headline** (R01): `would widen` when any of the listed changes widens access.
4. **Summaries** (R09): when only type changes are open, the summary says `would change or lose data`; the `--yes` line covers every kind that is open.
5. **A flag with the right subject and the wrong verb** (R06) gets a `Remove …` line that says why, and a test follows the refusal to a successful run.
6. **Several things open** (R03): each way to keep the data names its subject.
7. **One `--allow` for several changes** (R02, R10, R11): the success output and `appliedStatements` show one entry for the one flag given, listing what it allowed, if the record of allowed access changes still gets each change; the control API and the CLI give the same, true error for a second flag; tests cover the dry run, the control API flag path and the whole error in the PostgreSQL journey.
8. **The prompt** (R08, R12, hands-on 7 and 8): no literal `{bin}`; it lists the possible new names as the refusal does; a removed namespace's parts come in the same order as in the refusal; blank lines in `why` separate subjects only (the namespace fact stays with its operation line; the `--yes` and `Remove` material may keep its own paragraph).
9. **Names** (R04): a field's name says what the string means, and the doc on `keepDataWays` matches what it holds.

## Check, then fix or record

- Hands-on 13: the real `prisma` binary printed no `docs:` line and no `docsUrl` for `CLI.CONSENT_REQUIRED`, while journeys assert one. Find out why by running the built CLI as the scripts in `wip/consent-text/qa2/` do. If this branch dropped it, restore it; if `main` behaves the same, record it.
- Hands-on 11: on MongoDB, `--delete` of a field filled a new required field with `""` in every document and the refusal carried no line about a value for it. Compare with `main`. If this branch lost the line, restore it; if not, record it.
- R13: the three doc errors. R14: run every check of dispatch 1 on the tip and save the output.
- The vocabulary test (first-round S16 and F05, still partly open): it must meet the texts of decision 1 and the rebuilt `CLI.PROMPT_INVALID`, and call `validate` with more than one wrong value.

## Record as deferred, do not fix

In `projects/migration-statements/deferred.md`: target advice that says "the destination" and "the origin"; the `--advance-ref <name>` step of the snapshot recovery not saying what a ref is; `Access … would change` not saying which way when nothing widens; anything above you had to leave.

## Done when

Every check of dispatch 1 passes on the tip with saved output; each item above is fixed or recorded with a reason; the spec matches the texts as built; a test follows each printed line this dispatch changed.

## Report

Final message, plain English, short sentences: one row per item with what is now true and the test; every text that changed, in full; what the two "check" items turned out to be; anything left, with the reason; commits; checks with results; what you did not verify.
