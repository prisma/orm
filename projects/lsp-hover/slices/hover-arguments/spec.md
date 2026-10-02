# Slice: hover-arguments

Parent project: `projects/lsp-hover/`. This slice completes the spec's hover table. Argument keys, function names, constants and block attributes get binder symbols and hover content.

## At a glance

The binder records four new resolutions, and hover renders them:

```prisma
model Post {
  id       Int  @id @default(autoincrement())
  author   User @relation(fields: [authorId], references: [id], onDelete: Cascade)
}

policy ReadOwn {
  using = …
  @@someBlockAttribute(…)
}
```

| Cursor on | Resolution (new) | Hover |
|---|---|---|
| `references` in `references: [id]` | `parameter` (owner: the `@relation` attribute) | ` ```prisma references: <ArgType.label>``` ` + `Param.documentation` |
| a named arg key inside a function call | `parameter` (owner: the function) | same shape |
| a struct-block entry key (`using` in `policy`) | `parameter` (owner: the block) | same shape |
| `autoincrement` | `function` | ` ```prisma autoincrement()``` `, the signature label, + `FuncCallSig.documentation` |
| `Cascade` | `constant` | ` ```prisma Cascade``` ` + `FixedIdentifierArgType.documentation` |
| a block attribute name | `attribute` with `level: 'block'` | signature label (`@@name(…)`) + `spec.documentation` |

## Chosen design

**Binder** (`packages/1-framework/2-authoring/psl-parser/src/binder.ts`).

New `Resolution` members, each recorded in `references` (the map `symbolForNode` reads):
- `{ kind: 'parameter'; symbol: ParameterSymbol }`, where `ParameterSymbol { kind: 'parameter'; name; param: Param<unknown, never>; owner: AttributeSymbol | FunctionSymbol | BlockSymbol }`. It is keyed on the key's identifier node.
- `{ kind: 'function'; symbol: FunctionSymbol }`, where `FunctionSymbol { kind: 'function'; name; signature: FuncCallSig }`. It is keyed on the function-call name node.
- `{ kind: 'constant'; symbol: ConstantSymbol }`, where `ConstantSymbol { kind: 'constant'; name; documentation }`. It is keyed on the identifier expression node of a value matched by a fixed `identifier` arg type.

`AttributeSymbol.level` becomes `'model' | 'field' | 'block'`. Block attributes are recorded on their name node inside `bindBlock`.

Recording rules:
- **Named attribute-argument keys** are recorded where `bindArguments` resolves the parameter, keyed on the argument's name identifier.
- **Named function-call keys and function names** are recorded inside `tryBindExpression`'s `funcCall` case, into the trial's `references`.
- **Constants** are recorded inside `tryBindExpression` when an `identifier` rule with a fixed `name` matches the expression.
- **Inside a `oneOf` rule**, only the matching alternative's records survive. Today the `oneOf` case copies only `unresolved` resolutions from failed trials; it must keep doing that, so a failed alternative never leaks `parameter`, `function` or `constant` records.
- **Struct-block entry keys** are recorded in `bindBlock`, keyed on `entry.key()`. Map-mode blocks record nothing for keys.

**Hover** (`language-server/src/hover.ts`). `narrowHoverResult` gains three cases: `parameter`, `function` and `constant`. Block-level attributes reuse the attribute case, with prefix `@@`. Rendering:
- **`parameter`:** `key?: <type label>` in the fence, plus `param.documentation`. The `?` appears when the type is optional, matching `renderSignatureLabel`'s named-parameter part.
- **`function`:** `renderSignatureLabel(name, signature, params)` in the fence, plus `signature.documentation`.
- **`constant`:** the name in the fence, plus the documentation.

Empty documentation renders the fence only, through `withDocumentation`.

## Coherence rationale

There is one outcome: every position that has contributed documentation now answers hover. The binder records the symbols, and hover renders them. A reviewer can check each new resolution in the binder against its hover case in the same PR.

## Scope

**In:**
- `binder.ts` and the psl-parser binder tests;
- `hover.ts` and `hover.test.ts`;
- the SQL and Mongo `create-binder.test.ts` enumeration expectations, which list every resolution;
- the language-server README Hover section;
- the manual QA script and run over the project spec's full table.

**Out:**
- map-block keys;
- positional argument values;
- inlay hints;
- go-to-definition handling of the new kinds (that project's slice 2 is in flight on `go-to-definition-provider`).

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
| --- | --- | --- |
| `semantic-tokens.ts` `collectIdentifierExpression` reads `symbolForNode` on identifier values. A new `constant` resolution goes to `classifyTypeReference`'s `default` (`type`) instead of the `undefined` path. | Semantic tokens must not change. | Today constants outside `fields:` / `references:` already classify as `type`. The `semantic-tokens` tests must pass unchanged; any difference halts the dispatch. |
| `oneOf` alternatives (e.g. `onDelete: Cascade \| Restrict \| …`, or `funcCall` vs `str`). | Only the matching trial's records are kept. | See Recording rules. |

## Slice-specific done conditions

- [ ] A manual QA script (`drive-qa-plan`) and run report (`drive-qa-run`) cover every row of the project spec's At-a-glance table, from slices 1 and 2.

## Open Questions

None.

## References

- Parent project: `projects/lsp-hover/spec.md` (decisions 1–3)
- Linear issue: none (skipped by operator)
- Slice 1: PR #30569
