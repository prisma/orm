# Brief: mixin-inclusion D3 — contract equivalence, the RLS example, README and skill

## Task

Prove at contract level that a mixin behaves as if its members were written inline, and document the feature. Tests and documentation only: no production source changes.

## Scope

**In:**

- SQL `contract-psl` tests: for `model`, `type`, `enum` and an extension `key = value` block, interpret a schema that uses a mixin and the same schema with the members written at the inclusion's position, and assert the two contracts are deep-equal. A field-order test with the inclusion first, in the middle and last. The cross-namespace case from the slice spec's edge-case table, asserted on the emitted relation. A model `@@id([tenantId, id])` where `tenantId` comes from a mixin.
- Mongo `contract-psl`: one equivalence test for a model mixin.
- The row-level security example from the project spec's "At a glance" (a `policy_select` mixin holding `roles` and `using`, included by two policies with different `target`s), as an equivalence test in the package that owns `policy_select`. Take the block's real syntax from `examples/supabase/src/contract.prisma`.
- A test that one interpreter-level error on a mixin's member, with the mixin included by two models, is reported once per including model at the member in the mixin. This pins the accepted behaviour; it is not a defect to fix.
- `psl-parser/README.md`: the symbol table, scope chain and resolution-kinds sections, to describe mixin symbols, inclusion replacement, the `mixin` resolution kind and "a mixin body is bound once, where it is written". Behaviour, not implementation detail.
- The user-facing PSL authoring skill (find it under `packages/0-shared/skills/` or `skills/`): a short section on mixins with the model and enum example and the rules a user needs (one keyword per mixin, a member provided twice is an error, a mixin's attributes can name only its own fields, a mixin cannot include a mixin). Run `pnpm lint:skills` if a skill file changes.

**Out:** any change under a `src` directory. If a test fails because production code is wrong, halt.

## Completed when

- [ ] The tests above exist and pass.
- [ ] `rg -i "not supported yet" packages` finds nothing about mixins.
- [ ] `git diff psl-mixin-grammar..HEAD --stat -- 'packages/2-sql/**/src' 'packages/2-mongo-family/**/src' 'packages/3-*/**/src'` lists only `psl-column-resolution.ts`, `psl-field-resolution.ts`, `sql-attribute-specs.ts` and `mongo-attribute-specs.ts`.
- [ ] `pnpm typecheck`, `pnpm test:packages`, `pnpm lint:deps`, `pnpm fixtures:check` and `lint` for each touched package pass, apart from the four known environment failures. No fixture changes other than files you add.

## Halt conditions

- An equivalence test fails. Report the differing part of the two contracts and the site that causes it. Do not change an interpreter or the binder.
- An interpreter resolves a mixed-in field's type by name in the including model's namespace, or reads a member's owner from the syntax tree, in a way that changes the contract.
- The extension that owns `policy_select` cannot be exercised in a package test without infrastructure that does not exist; say what exists and propose the nearest equivalent.
