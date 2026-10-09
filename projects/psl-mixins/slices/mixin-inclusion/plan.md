# Slice plan: mixin-inclusion

**Spec:** `projects/psl-mixins/slices/mixin-inclusion/spec.md`

## Dispatch plan

### Dispatch 1: mixin symbols and inclusion replacement in the symbol table

- **Outcome:** `buildSymbolTable` produces `MixinSymbol`s in `mixins` records, and every model, composite type and generic block with inclusions has `fields`, `entries` and `attributes` records containing the mixin's members at the inclusion's position. Every row of the spec's diagnostics table is reported as specified. The interim "not supported yet" diagnostic is gone. `psl-parser` typecheck, tests and lint pass; the package is rebuilt.
- **Builds on:** The spec's chosen design; `MixinDeclarationAst`, `MixinInclusionAst` and `inclusions()` from the previous slice.
- **Hands to:** Symbol records that already contain mixed-in members, and one exported lookup for a mixin name (unqualified and `ns.Name`) that the binder will also use.
- **Focus:** tests first, in a symbol-table test file: each record kind, each position, a namespace and a qualified name, two documents, every diagnostics row. Then `symbol-table.ts` and `scope.ts`.

  The binder is dispatch 2. After this dispatch the binder still walks mixed-in members once per including block; do not fix that here, and expect binder-level tests that include a mixin to be written in dispatch 2.

### Dispatch 2: the binder binds each member once

- **Outcome:** The binder section of the spec holds: a mixin body is bound once in its own namespace against its own fields, an including block binds only the members written in it, a block's own attributes resolve names against all of its fields, an inclusion's name and a mixin declaration are recorded for `symbolForNode` and `declaredSymbol`, and a mixin name in type position is rejected. `psl-parser` and `language-server` typecheck, tests and lint pass.
- **Builds on:** Dispatch 1's records and lookup.
- **Hands to:** A binder whose resolutions for mixed-in members are the ones interpreters will read.
- **Focus:** tests first, in binder tests: the cross-namespace case, the mixin attribute naming a field it does not declare, a model attribute naming a mixed-in field, one mixin included by three models reporting each diagnostic once, a mixin nothing includes still being bound. Then `binder.ts`.

### Dispatch 3: contract equivalence, the RLS example, README and skill

- **Outcome:** The slice's done conditions are met: equivalence tests for the four block kinds in SQL `contract-psl` and one in Mongo `contract-psl`, the field-order test, the cross-namespace relation test at contract level, the `policy_select` example, the README and the authoring skill. `pnpm typecheck`, `pnpm test:packages`, `pnpm lint:deps` and `pnpm fixtures:check` pass apart from the four known environment failures.
- **Builds on:** Dispatch 2's binder.
- **Hands to:** The branch ready for the PR.
- **Focus:** tests and docs only. If an equivalence test fails because an interpreter looks a name up again or reads a member's owner from the syntax tree, halt and report the site; do not change the interpreter.
