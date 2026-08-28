# Dispatch 1 — block-level-kit

Slice plan: `projects/attribute-registry/slices/block-attributes-on-kit/plan.md` § Dispatch 1. Spec: `../spec.md` § Chosen design 1.

## Task

Give the attribute-spec kit a block-level interpret ctx and a `blockAttribute()` constructor, carrying the ctx requirement in the types — such that a spec cannot demand a model it will never receive, and every existing consumer typechecks unchanged.

## Outcome / property

`ArgType`, `Param`, `PositionalParam`, `AttributeSpec` take `Ctx extends BlockInterpretCtx = InterpretCtx`; `ArgType.parse` is a property function type (contravariant ctx); model-free combinators return `ArgType<T, BlockInterpretCtx>`; `interpretArgs` / `interpretAttribute` / `leafDiagnostic` are ctx-generic; `blockAttribute()` builds `AttributeSpec<Out, BlockInterpretCtx>` with `level: 'block'`; `BlockAttributeSpecFactory = () => AttributeSpec<never, BlockInterpretCtx>`; all exported from the barrel.

## Completed when

- [ ] `test/attribute-spec-block.test-d.ts`: `fieldRef` inside `blockAttribute` is a type error; a block spec is assignable to `AttributeSpec<Out>`; `blockAttribute` infers its output like `modelAttribute`.
- [ ] `test/attribute-spec-block.test.ts`: `interpretAttribute` over a `@@` node with a ctx lacking `selfModel` binds args and runs `refine`.
- [ ] Gates: psl-parser typecheck (incl. test), lint, test; workspace `pnpm typecheck`; grep `selfModel` in combinators names only `field-ref.ts`.

## Edge cases

| Case | Disposition |
| --- | --- |
| F5 destructive git | forbidden |
| F3 broken consumers | discover via `rg 'parse\(' … ` and workspace typecheck, not repeated test runs |
| F16 layering comment | HALT |
| No code comments (operator rule) | none added |
