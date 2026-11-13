## Dispatch plan

Slice spec: `projects/nested-mutations/slices/graph-nested/spec.md`. Four dispatches, sequential. Tests first in each. Tests assert effects and printed graphs, never SQL.

### Dispatch 1: table state, `Assert`, and the table collector

- **Outcome:** The AST table collector exists in `relational-core`; `changedBy` is derived from the contract; the graph creates `State` nodes and state edges on `add` and offers `sameState`; `Assert` exists. Unit tests for each, including a transitive cascade and a node that reads several tables. Existing graphs print as before by default, with state shown in the tests that are about it.
- **Builds on:** Slice `graph-creates`.
- **Hands to:** The pieces the translation uses.
- **Focus:** State edges are ordinary input edges resolved by the runner; no special case in the runner.

### Dispatch 2: nested operations in `create()`

- **Outcome:** `create()` with relation callbacks builds its graph through the translation for every operation and layout and runs it; the executor's create path is unused. Integration tests on both targets pass.
- **Builds on:** Dispatch 1.
- **Hands to:** The translation table, which dispatch 3 extends to `update()`.
- **Focus:** Phase order, recursion, the junction `connect` conflict-clause rule, rejections while building.

### Dispatch 3: nested operations in `update()`, and the executor removed

- **Outcome:** `update()` with relation callbacks runs through the graph; `mutation-executor.ts` and the branch on relation callbacks are removed; the contract validator rejects empty link-column lists; the decided behaviour changes hold with tests.
- **Builds on:** Dispatch 2.
- **Hands to:** Every write method on the graph.
- **Focus:** `disconnect`, `null` on no match, rejection timing, the non-callback rejection, the integration tests on main that assert the old behaviours (listed and changed only where a decided change applies).

### Dispatch 4: clean-up and the slice gates

- **Outcome:** The `compile…` functions without callers and `aliasTarget` are removed and the file renamed; the unread-`Find` step built or reported as not needed; pending upgrade entries as the coverage gate requires (report whether the contract-validation change needs anything other than `changes: []`, with the reason); every gate passes.
- **Builds on:** Dispatch 3.
- **Hands to:** The slice ready for its PR.
