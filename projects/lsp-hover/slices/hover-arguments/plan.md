## Dispatch plan

Slice spec: `projects/lsp-hover/slices/hover-arguments/spec.md`

### Dispatch 1: binder resolutions

- **Outcome:** `symbolForNode` returns:
  - `parameter` on named attribute-argument keys, named function-call keys and struct-block entry keys;
  - `function` on function-call names;
  - `constant` on fixed-identifier values;
  - `attribute` with `level: 'block'` on block attribute names.

  Failed `oneOf` trials leave none of these behind. psl-parser binder tests cover each kind and the `oneOf` case. The SQL and Mongo enumeration tests are updated, and every other consumer test passes unchanged, semantic tokens included.
- **Builds on:** slice 1's binder, which records declarations on their name nodes.
- **Hands to:** a binder whose `Resolution` union has `parameter`, `function` and `constant`, with exported `ParameterSymbol`, `FunctionSymbol` and `ConstantSymbol` types.
- **Focus:** `binder.ts` and tests only. The language server stays untouched except where it must compile against the widened union.

### Dispatch 2: hover for the new resolutions

- **Outcome:** `providePslHover` renders `parameter`, `function`, `constant` and block-level `attribute` as the slice spec describes, with tests for each. The README Hover section mentions argument keys, functions and constants.
- **Builds on:** Dispatch 1's resolutions.
- **Hands to:** hover complete for the project spec's table.
- **Focus:** `hover.ts`, `hover.test.ts` and the README.

### Dispatch 3: manual QA

- **Outcome:** a `drive-qa-plan` script covers every row of the project spec's At-a-glance table, and a `drive-qa-run` report records the results, driving the language server over stdio or through the server test harness.
- **Builds on:** Dispatch 2.
- **Hands to:** Slice DoD.
- **Focus:** QA artefacts under `projects/lsp-hover/`. Code changes only if QA finds a defect, routed back through review.
