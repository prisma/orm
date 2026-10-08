# Slice sql-where-unique — Dispatch plan

**Spec:** `projects/where-unique/slices/sql-where-unique/spec.md`

### Dispatch 1: uniquely filtered collection

- **Outcome:** In `packages/3-extensions/sql-orm-client`, `whereUnique(criterion)` exists and returns `UniquelyFiltered<Self>`; the twelve many-record methods refuse a uniquely filtered collection at compile time; `whereUnique` is absent from the `include` refinement collection; `HasUniqueFilter` and `UniquelyFiltered` are exported. Type tests written first cover every accepted and rejected call and argument shape, including a user subclass whose methods call many-record methods on `this`.
- **Builds on:** The spec's chosen design and its edge-case table. The spike patch is reference only and does not apply to current `main`.
- **Hands to:** A package whose own typecheck and tests pass, with every package that depends on it type-checking (`prisma7-adoption` excluded). `UniqueConstraintCriterion` still admits `null`.
- **Focus:** The type-state fact and requirement, the method and its runtime compilation, the overload changes, exports, package type tests and unit tests. Stop and report if the encoding cannot be made to pass on the current code. The `null` exclusion, integration tests, the demo's declaration tests and the README belong to later dispatches.

### Dispatch 2: criterion without null

- **Outcome:** `UniqueConstraintCriterion` rejects `null` for a nullable unique column, so `whereUnique`, `conflictOn` and `connect` all reject it. Type tests written first show the rejection at each of the three call sites and that non-null values still type-check. An `extension` upgrade-instruction declaration describes the change for callers of `conflictOn` and `connect`.
- **Builds on:** Dispatch 1's `whereUnique`.
- **Hands to:** The final argument type. Any caller in the workspace that passed `null` is fixed, and the dependents' typecheck passes.
- **Focus:** The type in `types.ts`, its type tests, workspace callers, the upgrade declaration under `upgrade-instructions/pending/`. No runtime change.

### Dispatch 3: evidence and documentation

- **Outcome:** Integration tests run `first`, `update` and `delete` after `whereUnique` against a database, for a single-column key, a compound key, a following `where`, and with an `include`. `examples/prisma-8-demo/test/collection-chaining.types.test-d.ts` exports uniquely filtered chains from a plain collection and from a user class, and the demo's `declaration-emit` test passes. The package README has a `whereUnique` section. An `app` upgrade-instruction declaration with `changes: []` covers the `examples/` test change.
- **Builds on:** Dispatches 1 and 2.
- **Hands to:** The slice's done conditions: the dependents' typecheck, the demo's declaration-emit test and `pnpm check:upgrade-coverage --mode pr` all pass.
- **Focus:** Tests under `test/integration/test/sql-orm-client/`, the demo's type test, `packages/3-extensions/sql-orm-client/README.md`, the `app` declaration. No source change in the package; a defect found here is reported, not patched in place.
