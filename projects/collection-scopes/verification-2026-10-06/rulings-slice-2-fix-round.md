=== 2026-10-05T15:00:16.648Z SendMessage
Fix round on slice 2 (branch tml-3436-fragment-helpers, tip 3cb751a92d) from the formal two-pass review. Read both artifacts first: wip/review-slice-2-skill/code-review.md (F01–F10) and wip/review-slice-2-skill/system-design-review.md (SD01–SD16) in the worktree /Users/wmadden/Projects/prisma/orm/.claude/worktrees/prometheus-67-transcript-38822b. Probe files the code reviewer used are under wip/review-slice-2-skill/probes/. Rulings follow; where a finding is not listed, do what the artifact suggests.

Code review:
- F01: `allowed` becomes required on `orderByField`. Update README, skill reference, ADR 259, demo.
- F02: keep `limit` and `offset` in the scope body (ADR 259 stands). Fix at the collection: `deleteAll`, `updateAll` and `update` throw `ORM.ARGUMENT_INVALID` (why/fix/meta) when the collection's state carries a limit or an offset, because the mutation would ignore them. Order is ignored silently as before. Tests: `apply(scopeWithLimit).deleteAll()` throws; inline `.limit(10).deleteAll()` throws. Add an upgrade entry for the new refusal. Note it in ADR 259 where it says `update` is allowed after a filtering scope.
- F03: constrain declared codec ids to the contract's codecs so a typo errors at the declaration. Remeasure the unused and ten-use costs and update ADR 259.
- F04 and SD04: at run time, check that the value a body returns is a collection with the receiver's model name and namespace id and constructor; throw `ORM.ARGUMENT_INVALID` otherwise. Do the same model check in `Post.scope`. Tests for both.
- F05 and SD13: document in README, skill reference and ADR 259 that a collection whose type carries no namespace (custom classes) is checked at run time only.
- F06: `direction` is `string | undefined`; remove the duplicate check in the demo.
- F07, F08: as suggested, with the `it.each` rows and the namespace in the error.
- F09: point `collection-dispatch.ts` at `resolveColumn`; narrow the catch to the table-not-found case.
- F10: measure one definition and ten uses against a generated contract of about 200 models (an emitted fixture under the client's test fixtures is fine, built with the authoring API, not hand-patched). Put the number in ADR 259. If it is bad, report and stop; do not restructure the type without my ruling.
- WEAK acceptance criterion: add a run-time test for a field that only a variant has.

System-design review:
- SD01: rename `ScopeFieldSpec` to `DeclaredField`. Record the `Scope` name clash with the builder's `ScopeField` in projects/collection-scopes/deferred.md (that file is on bot/model-scopes-design; add the line there in a separate commit on that branch and push it).
- SD02: try to express the scope body's facts with ADR 258's state types (`StateType`, `HasState`, `Filtered`, `Ordered`) instead of `ScopeFacts`/`ScopeFactsType`/`WithFacts`. Keep it only if the soundness tests from the previous round still refuse everything they refuse now and the cost does not rise by more than 0.1% unused. Otherwise keep the current types and write one paragraph in ADR 259 explaining why the body's state is a separate type.
- SD03: document in ADR 259 that `Post.scope` always types its result against the plain collection, so a custom class and an earlier filter are not carried through, even when the body keeps the row. Add it to deferred.md as a possible later improvement. No code change.
- SD05: keep the `{ codecId, nullable }` form; slice 4 (packages building scopes from index definitions) is its consumer. Record in deferred.md that it has no consumer until then.
- SD06: declare the builder shape once beside `ColumnTypeDescriptor` in framework-components and have the client import that type, if `pnpm lint:deps` allows. If it does not, keep the client-side interface and say so in the report.
- SD07: keep "column type" in user-facing text (that is the authoring vocabulary); use "codec" only in internal names. Fix only the places where the text says column type but checks something that is not one.
- SD08: rename `ScopeRow` to `ScopeModelAccessor` and `ScopeQuery` to `ScopeCollection`.
- SD09: ADR 259 adopts the two phrases "a scope for any model with given fields" and "a scope for one model" as the names, and the code's identifiers may say field scope and model scope; add one sentence in the ADR tying the identifiers to the phrases.
- SD10: rename the module `query-fragments.ts` to `scopes.ts` and its tests accordingly; README and skill headings say "Scopes", not "Shared query fragments". The ADR title stays.
- SD11: `OrderableFieldName` becomes `OrderableFieldNames`.
- SD12 and SD14: add the three tests: namespace refusal on two models with the same fields (add a model to the namespaced fixture via its contract.prisma and re-emit), a contract with a namespace named `scope`, and a model scope whose body keeps the row. SD15: no change.
- SD16: I will update the slice spec myself; skip it.

Process: run sql-orm-client typecheck and tests, the postgres facade tests, the demo typecheck and tests, `lint:deps`, `lint:throws`, `check:upgrade-coverage`, and the namespaced-accessors-scopes integration file alone. Never the full integration suites. Commit with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"` through `mise exec --`, no AI attribution lines, never amend or force-push, push to the bot remote. Report the new tip, the remeasured costs, and anything you could not do.
