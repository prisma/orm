# Dispatch 12 — authoring writes value objects and discriminator value sets into storage

**Plan:** [`../plan-pr3.md`](../plan-pr3.md) · **ADR:** ADR 309 · **Grounding:** `wip/pr3-grounding.md` § A (SQL family, Mongo family), C, E · **Builds on:** dispatch 10 (`d607bde854`, `1792de2a67`, `965c0cf100`) · **Branch:** `tml-3537-value-objects-storage`

## Outcome

Every authoring path writes the dispatch 10 shape, and the storage hash covers it:

- SQL PSL and the SQL TypeScript build write each value object to `storage.namespaces.<default storage ns>.entries.valueObject.<Name>`, and each field that holds one refers to it by the storage coordinate. A value object member typed by an enum refers to the storage value set.
- Mongo PSL, the Mongo TypeScript builder and the Prisma 6 reader do the same through the one Mongo builder. `build-mongo-storage.ts` hashes `valueObject` entries.
- SQL PSL builds the discriminator value set before the hash. The value set is `storage.namespaces.<ns>.entries.valueSet.<Base>.<field>`, holding the variant values, and the discriminator column refers to it. This needs the discriminator and the variant values in the build definition, so `resolvePolymorphism` no longer patches them in after the hash (grounding risk 2).
- An enum-typed discriminator keeps the enum's value set (plan decision 2); no second value set is written.
- An enum whose name equals a discriminator's `<Base>.<field>` key is refused, naming both and saying to rename the enum. Nothing else about enum names changes (plan decision 3).
- The MongoDB validator derivation reads value objects from storage. Its output does not change.

The Postgres check for the discriminator and value object columns is dispatch 15, not this one.

## Do

1. **Tests first, red before each change:**
   - SQL PSL: a composite type lands in storage with the coordinate on the field; nested and list members; an enum member refers to the storage value set; the storage hash changes when a member changes.
   - SQL PSL: a polymorphic model writes the `<Base>.<field>` value set and the column refers to it; adding a variant changes the hash; an enum-typed discriminator keeps the enum's value set.
   - SQL: the clash refusal through `enumType()`.
   - Mongo: TypeScript builder, PSL and Prisma 6 each write storage value objects; the hash changes with a member; the derived collection validator is unchanged for an existing fixture.
2. Implement. Reuse the names dispatch 10 chose. Do not invent nouns; if one is unavoidable, list it in the report with candidates.
3. Move `@repo/test-utils` `createContract` and `applicationDomainOf`'s `valueObjects` option to storage.
4. Fix the source type errors dispatch 10 left in `sql-contract-ts`, `sql-contract-psl`, `mongo-contract-ts`, `mongo-contract-psl` and `mongo-contract-prisma6`.

## Do not

- Do not change the emitter or `contract.d.ts` (dispatch 13), runtimes, the CLI resolver or `contract print` (dispatch 14), or Postgres checks (dispatch 15).
- Do not re-emit committed fixtures or examples (dispatch 16). Tests in other packages that load committed fixtures may stay red; list them.

## Rules

- Never run `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all`. Only named files inside `test/integration` with `pnpm test <file>`.
- Use `mise exec --` for node and pnpm. Never `npx`.
- No comments where the code can say it; no bare `as` casts in production code; no `any`; arktype, not zod; no file extensions in imports; no backwards-compatibility exports; framework packages name no family or target.
- Commit with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`. No AI attribution lines. Stage files explicitly.
- Do not push. Do not open a PR.
- Save slow command output under `wip/` and read the file. Run tests by file where you can.

## Done when

- Typecheck, lint and `test --coverage` pass in every package this dispatch touches; `lint:deps`; `lint:ratchets`.
- The report lists what is still red outside those packages and which dispatch owns it.

## Report

Plain English, short sentences: what each authoring path now writes, how the discriminator facts reach the build, the clash message, the test that was red first for each change, the checks, what is still red, and the commits.
