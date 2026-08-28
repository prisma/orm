# Dispatch 4 — declare-and-read

Slice plan: `../plan.md` § Dispatch 4. Spec: `../spec.md` § Chosen design 4.

## Task

Declare `@@type` on both family `enum` descriptors and `@@map` on postgres `policy_*` / `native_enum`; switch `resolveEnumCodecId` and the two postgres lowerings to `block.attributes`; drop `PSL_NATIVE_ENUM_INVALID_MAP`; move the affected tests to the symbol-table stage — such that every block attribute has exactly one parser (the kit) and consumers read data, never source text.

## Completed when

- [ ] `rg 'blockAttributes\.find' packages test examples` → 0.
- [ ] Family enum tests, contract-psl enum/no-check/parity tests, postgres map tests green against descriptors that declare their attributes.
- [ ] Gates: `pnpm build` → workspace typecheck; lint for family-sql, family-mongo, framework-components, target-postgres, sql-contract-psl; tests for those + mongo-contract-psl + language-server; `pnpm lint:deps`; `pnpm fixtures:check`.

## Edge cases

| Case | Disposition |
| --- | --- |
| F5 destructive git | forbidden |
| Test-local `enum` descriptors (contract-psl, parity) | gain the `type` attribute via a shared fixture descriptor |
| Kit guarantees `str()` output | readers assert with `invariant`, not a defensive branch |
| No code comments | none added |
