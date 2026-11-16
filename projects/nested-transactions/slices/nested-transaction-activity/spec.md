# Slice: nested-transaction-activity

**Project:** `projects/nested-transactions/` (slice 2 of 6). **Linear:** skipped by the operator.

## Outcome

The framework runs a transaction activity beneath another transaction activity and finalizes it by project spec decision 6. A savepoint that is released hands its children and its statement failures to the enclosing transaction. A savepoint that rolls back finalizes its subtree right away as `rolled-back` and passes no failures up. No runtime starts a savepoint yet. Slice 3 is the first caller.

## Chosen design

All production changes are in `packages/1-framework/1-core/framework-components/src/execution/transaction-activity.ts`. The operator approved this file and its tests as the only framework change (project spec decision 6). `activity-lifecycle.ts` needs no change:

- `ActivityChildSlot.statementFailed()` already reports to the parent.
- A transaction parent that holds an ended child already calls that child's `finalize()` with its own outcome.
- `createActivityRecord.finalize` and `ActivityChildren.finalize` already do nothing when called a second time.

1. **A release settlement.** `TransactionSettlement` gains `{ readonly by: 'release'; readonly outcome: 'succeeded' | 'failed' }`. It settles a savepoint (`RELEASE SAVEPOINT`). The `activityEnded` result is `{ kind: 'transaction', outcome }`, as for the other settlements. A `commit` settlement on a savepoint, or a `release` on an outermost transaction, is outside the contract. The docstrings say so, and the code does not check it.
2. **What counts as a savepoint.** A transaction activity is a savepoint when its own context reports `ctx.inTransaction()`. Its parent is then a transaction, or a client activity inside one. This matches the test a middleware uses (decision 6): `activity.kind === 'transaction' && ctx.inTransaction()`. A top-level transaction keeps its current behaviour exactly.
3. **A savepoint that rolls back** finalizes its subtree at once. A `rollback` settlement counts here whatever its `outcome` and `commitAttempted`:
   - The children it holds are finalized in post-order, then the savepoint itself, all `rolled-back`.
   - It then reports its end to its parent. The parent's later `finalize()` call on it does nothing.
   - No statement failure beneath it reaches the parent.
   - `end()` resolves after these hooks have run.
   - Why every rollback counts:
     - A successful `ROLLBACK TO` undid the work.
     - A failed `ROLLBACK TO` invalidates every level up to the outermost transaction (decision 9), so the work never commits either.
     - After a failed `RELEASE` and a successful `ROLLBACK TO`, the savepoint was still in place, so the work was undone. `commitAttempted` makes an outermost transaction `unknown` because a `COMMIT` may have applied. That reason does not apply to a savepoint.
4. **A savepoint that is released**, with either outcome, hands its subtree up:
   - When a statement beneath it failed, it reports that through its slot's `statementFailed()`, so the enclosing transaction's existing `unknown` rule applies unchanged.
   - It then reports its end to its parent, which holds it.
   - When the enclosing transaction ends, it calls the savepoint's `finalize()` with its own outcome. The savepoint finalizes its children, then itself, in the existing post-order.
   - A statement failure beneath a savepoint is not reported up while the savepoint is open. It is reported only on release.
5. **A refused start.** When an `activityStarted` hook throws, `startTransactionActivity` keeps ending the run with `{ by: 'rollback', outcome: 'failed', commitAttempted: false }`. On a savepoint, rule 3 finalizes it `rolled-back` at once, and the enclosing transaction is not affected.
6. **`holdFinishedChildren: false`.** Nothing is held at any depth, as today. Rules 3 and 4 still decide whether statement failures reach the parent.

## Coherence rationale

One framework file, its tests, and the two documents that describe its rules (the subsystem doc's finalization sections and ADR 271). A reviewer can check the code against the doc text in one sitting. Nothing outside the framework calls the new behaviour, so the slice cannot change a runtime's behaviour (transitional-shape constraint: the framework change lands before any runtime uses it).

## Scope

**In:**
- `packages/1-framework/1-core/framework-components/src/execution/transaction-activity.ts`: the settlement type and the savepoint rules above. Existing comments stay unchanged and no new comments are added.
- `packages/1-framework/1-core/framework-components/test/transaction-activity.test.ts`: new tests. Existing fixtures from `test/client-activity-fixtures.ts` may be used. Adding fixtures there is allowed if it keeps the tests short.
- `docs/architecture docs/subsystems/4. Runtime & Middleware Framework.md`: "When an activity is finalized" (savepoint rules) and the `startTransactionActivity` paragraph (release settlement, transaction parent).
- `docs/architecture docs/adrs/ADR 271 - …md`: amend the finalization section and the "Nested transactions, when built, …" consequence bullet to record decision 6: released savepoints wait for the outermost transaction, rolled-back savepoints finalize at once, failure forwarding by settlement, and how a middleware recognizes a savepoint.

**Out:**
- Any other file under `packages/1-framework`, including `activity-lifecycle.ts` and `runtime-middleware.ts`. If the design needs one, stop and surface it.
- `packages/2-sql-family/**`, drivers, facades, ORM.
- The statements that a handle opened under a transaction has no `transaction()`, so transactions do not nest (subsystem doc § activity handles, ADR 271's handle paragraph). They stay true until slice 3 adds `savepoint()` to the handle, and slice 3 changes them.
- The error reference: slice 3.

## Slice done conditions

Beyond CI, review and the project DoD:

- [ ] Framework tests show finalize outcomes and order for:
  - A released savepoint: its children and itself are finalized with the outer transaction's outcome, in post-order, when the outer transaction ends. The outer transaction's earlier and later children keep their start order around it.
  - A rolled-back savepoint: finalized `rolled-back`, children first, before its `end()` resolves and before the outer transaction ends. The outer transaction does not finalize them again.
  - Doubly nested savepoints: an inner released savepoint inside a middle one that rolls back (all `rolled-back` when the middle one ends), and an inner rolled-back savepoint inside a middle one that is released (inner at once, middle with the outer outcome).
- [ ] Framework tests show failure forwarding:
  - A failed statement beneath a released savepoint makes the outer resolved `commit` `unknown`.
  - Beneath a rolled-back savepoint, it leaves the outer commit `committed`.
  - Both also hold with `holdFinishedChildren: false`.
- [ ] Tests also show:
  - A rollback after an attempted release (`commitAttempted: true`) on a savepoint finalizes it `rolled-back`.
  - A savepoint whose `activityStarted` throws is finalized `rolled-back` and leaves the outer transaction committing `committed`.
  - A savepoint started beneath a client activity inside a transaction follows the same rules.
  - `activity.kind === 'transaction' && ctx.inTransaction()` is true for a savepoint and false for an outermost transaction.
- [ ] Existing `transaction-activity`, `activity-context` and SQL runtime transaction tests pass unchanged.

## Edge cases investigated

- `startTransactionActivity` already accepts any `ActivityParent`, and a transaction's `adopt` accepts a transaction child. No parent-kind check needs to be relaxed.
- With `holdFinishedChildren: true`, the parent's held entry for a rolled-back savepoint is marked ended. When the parent finalizes, it calls `finalize()` on the savepoint again, and that call does nothing because finalize runs only once.

## Plan (one dispatch)

**D1: savepoint finalization in the framework, with docs.**
- **Outcome:** everything in § Chosen design and § Slice done conditions.
- **Builds on:** `main` at `5350a29f3ae29`.
- **Hands to:** slice 3 (`runtime-savepoints`): `startTransactionActivity` with a transaction parent and the `release` settlement.
- **Focus:** tests first, then the implementation, then the docs. Suggested commits:
  1. Tests and implementation.
  2. Docs.
  3. Project and slice artifacts. The orchestrator commits these.
- **Validation gate:**
  - `pnpm build`, then `pnpm typecheck`: the settlement type is exported and the SQL runtime uses it.
  - `pnpm --filter @internal/framework-components test`
  - `pnpm --filter @internal/framework-components lint`
  - `pnpm --filter @internal/sql-runtime test`: an unchanged-behaviour check for the only production caller.
  - `pnpm lint:deps`
- **Size:** about 430 changed lines. The cap is about 500.

## Notes for slice 3

- A savepoint's `acceptsChildren()` and its children's `transactionAcceptsChildren()` check only the savepoint's own state, not the enclosing transaction's. The framework therefore accepts work beneath a savepoint that is still open after the outer `commit()` or `rollback()` has been called. The runtime guards of decision 3 and the invalidation of decision 9 (`TRANSACTION_SUSPENDED`, `TRANSACTION_CLOSED`) must refuse that work. Slice 3 adds a test for it. Raised by the D1 reviewer.
