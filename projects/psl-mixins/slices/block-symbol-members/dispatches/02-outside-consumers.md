# Brief: block-symbol-members D2 — consumers outside psl-parser

## Task

Apply the substitution from D1 to the remaining production call sites: wherever code outside `psl-parser` reads a block's, model's, composite type's or field's members through `symbol.node.entries()`, `.node.attributes()`, `.node.fields()` or `.node.members()`, read the symbol's own `entries`, `attributes` or `fields` instead. Behaviour must not change.

## Scope

**In:** the 16 sites the slice spec lists:

- `packages/2-sql/2-authoring/contract-psl/src/interpreter.ts` (2) and `sql-attribute-specs.ts` (1)
- `packages/2-sql/2-authoring/contract-prisma7/src/interpreter.ts` (5)
- `packages/2-mongo-family/2-authoring/contract-prisma6/src/interpreter.ts` (4)
- `packages/1-framework/3-tooling/language-server/src/rename.ts` (4)

Plus an `upgrade-instructions/pending/` fragment with `changes: []` if the upgrade-coverage check requires one.

**Out:**

- `fieldTakesMap` finding a field's owner through `field.node.syntax.parent` in `rename.ts`. Leave it.
- Code that walks the syntax tree with no symbol in hand (completion, semantic tokens, formatter).
- Existing test assertions, fixtures, and anything about mixins.

## Completed when

- [ ] `rg "\.node\.(fields|members|attributes|entries)\(\)" packages -g '*.ts' --glob '!**/test/**' --glob '!**/dist/**'` returns no line outside `packages/1-framework/2-authoring/psl-parser/src/symbol-table.ts`.
- [ ] `pnpm typecheck`, `pnpm test:packages`, `pnpm lint:deps`, `pnpm fixtures:check` and per-package `lint` for each touched package pass, with no fixture file changed.

## Halt conditions

- A site needs a different record shape than D1 provides, or cannot be moved by substitution without changing behaviour. Report it; do not redesign.
- A gate fails for a reason that exists on `main` without your change.
