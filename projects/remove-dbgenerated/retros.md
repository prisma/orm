# Retros — remove-dbgenerated

## 2026-09-23 — Mandatory final retro (project close)

**Trigger.** Project close; all three slices merged (#30325, #30350, #30380).

**What went well.** Three slices, each one PR, each reviewed by one persistent implementer and one persistent reviewer. Slice C ran five dispatches with two rework rounds, both closed in one round. The halt conditions written into the slice C spec (Supabase regeneration diff limited to the known lines; old contract must load) were checked and held. Every removed form was swept from docs by a grep that is part of the Definition of done.

**What surprised us.**
1. Slice B's first PR implemented a design (`encodePsl`/`decodePsl` on codecs) before the operator settled it, and was withdrawn. The rework brief named one blocked decision and asked before building it; that worked. Lesson landed in `drive/retro/README.md`.
2. `fixtures:check` builds the Supabase contract space, so the dispatch that deleted `dbgenerated` could not be green on that gate until the regeneration dispatch two steps later. Landed as F30 in `drive/calibration/failure-modes.md`.
3. A stale `dist` made a journey look red on `main`; the reviewer accepted the claim in one round and corrected it later. Landed as F31.
4. Two CodeRabbit threads kept an approved, green PR out of the merge queue until they were resolved. Landed in `drive/pr/README.md`.
5. The shipped Supabase contract had drifted about 490 lines from its generator before slice A found it (deferred item 7); fixed on `main` in #30346 before slice C.

**Deferred scope.** TML-3282 (tagged literals for index expressions, check bodies, RLS predicates; carries the 2026-09-16 decision that raw-default verification stays as is), TML-3283 (`encodeDdl`/`decodeDdl`), TML-3284 (quote-aware SQL default body check). `.defaultSql()` is deleted at 8.0.0 GA (spec D7); array-returning function defaults on list columns through a named function stay rejected; editor tooling is a hand-off in `docs/reference/psl-editor-tooling-tagged-literals.md`.

**ADR-worthy decision.** Already recorded: ADR 254 (data types and casts), the ADR 129 amendments (two fences, tag registration), the ADR 167 note.

**One-sentence summary.** `@default(dbgenerated("..."))` is gone from Prisma 8; raw SQL defaults are `sql` tagged literals, typed defaults go through data types and casts, `contract infer` prints both, and the Supabase contract carries none.
