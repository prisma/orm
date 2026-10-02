## Linked issue

Refs [TML-3289](https://linear.app/prisma-company/issue/TML-3289), the fourth slice of the Linear project [SQL expression literals](https://linear.app/prisma-company/project/sql-expression-literals-c8a6659e7f4c). Builds on #30550 (TML-3288) and targets its branch until that merges.

## Summary

In the TypeScript contract builder, raw SQL was a plain string in every place except `@default`, which already took the `sql` tag. This PR makes the builder's raw-SQL fields take only a `sql` value: an index predicate or expression, a full-text index predicate, a check expression, a policy's `using` and `withCheck`, and `.default()`. The `sql` tag returns a `SqlExpression` whose text is canonicalized exactly as a PSL `sql` literal is, so PSL and TypeScript emit byte-identical contracts for the same SQL, multi-line included. A plain string in those fields does not compile.

## Skill update

The `prisma-8` skill reference `contract.md` now writes TypeScript raw SQL as `sql` values. The breaking change for TypeScript contract authors is recorded in `upgrade-instructions/pending/sql-expression-literals-ts/`.

## At a glance

Before, raw SQL in the TypeScript builder was a string with escaped quotes, and only `@default` took the `sql` tag:

```ts
index(Profile, ['userId'], { where: '"archivedAt" IS NULL', name: 'profile_user_active' });
check({ expression: 'char_length("userId") > 0', name: 'profile_user_id_present' });
```

After, every place takes the same `sql` value, and `sql` values compose:

```ts
const owner = sql`"userId"::uuid = auth.uid()`;

index(Profile, ['userId'], { where: sql`"archivedAt" IS NULL`, name: 'profile_user_active' });
check({ expression: sql`char_length("userId") > 0`, name: 'profile_user_id_present' });
policyUpdate(Profile, {
  name: 'profile_owner_write',
  roles: [authenticated],
  using: owner,
  withCheck: sql`${owner} AND "archivedAt" IS NULL`,
});
```

A string in any of those fields is a type error. Anything other than a `sql` value inside `${…}` throws `CONTRACT.SQL_EXPRESSION_INTERPOLATION`.

## Decision

This PR ships four things.

1. **`SqlExpression` is the TypeScript value of the data type `sql/expression`.** The class, the `sql` tag, `isSqlExpression` and `requireSqlExpression` live in `@internal/sql-contract/sql-expression`, next to the data type they belong to. The constructor canonicalizes the text the way PSL canonicalizes a `sql` literal's body, so the two languages store the same text ([ADR 260](docs/architecture%20docs/adrs/ADR%20260%20-%20Raw%20SQL%20is%20a%20value%20of%20the%20data%20type%20sql-expression.md), [ADR 129](docs/architecture%20docs/adrs/ADR%20129%20-%20Template-Tagged%20Literals%20for%20Extensions.md)).
2. **The builder's raw-SQL fields take `SqlExpression` only.** `index` `where` and `expression`, `IndexConstraint.where`, `check` `expression`, `fullTextIndex` `where`, and policy `using` and `withCheck`. Lowering reads the text through `requireSqlExpression`, which throws `CONTRACT.ARGUMENT_INVALID` for a caller JavaScript could not type-check.
3. **`.default()` takes a `sql` value and runs the default checks itself.** `` .default(sql`now()`) `` and unsafe SQL throw `CONTRACT.DEFAULT_INVALID`; the checks that used to live in the tag moved to the one place that needs them. The tag is now the same for every position.
4. **`contract print` refuses, and `contract infer` flags, a column default whose text would not read back.** Print refuses it like an index or policy. Infer still prints it, because a skipped default would be dropped by the next plan, and adds a note that the string constants must be checked.

The SQL family also exports its data type registration as one value, `sqlExpressionRegistration`, which the family descriptor and the test fixtures spread.

## How it fits together

1. **A `sql` literal is a value of a data type.** #30534 made `sql/expression` the type; #30539 built `dataTypeValue` for PSL positions; #30550 gave the six PSL places that type. TypeScript was the last language still passing strings.
2. **The tag builds the value and canonicalizes once.** `sql` joins the template's text with the interpolated values, which must themselves be `SqlExpression`, and passes the joined text to the constructor. The constructor runs the same canonicalization as the PSL reader: shared indentation, blank lines at either end, carriage returns and whitespace-only lines are removed. NUL or oversize text throws `CONTRACT.SQL_EXPRESSION_INVALID`.
3. **A class, not an object shape.** `SqlExpression` is a class so that `{ text: 'x' }` is not assignable to it and so that `.default()`'s literal-value check rejects it; a `sql` value can therefore never be mistaken for a JSON default.
4. **The fields change type, the contract does not.** `IndexNode`, `CheckNode` and `PostgresRlsPolicy` keep strings; lowering reads `.text`. `fixtures:check` shows no `contract.json` change, and the new parity fixture under `test/integration/test/authoring/parity/sql-expressions/` proves PSL and TypeScript emit byte-identical contracts for all six places plus a raw default, with indented multi-line text, a backslash and an interpolated predicate.
5. **Checks on SQL content belong to the place that receives the value.** Only `.default()` has them (no `now()` or `autoincrement()` as raw SQL, no `;`, comments, `$$` or `SELECT`); the other places accept any text, because those checks would refuse valid RLS predicates.

## Reviewer notes

- **Breaking change for TypeScript contract authors.** A string in a raw-SQL field no longer compiles; the fix is to wrap it in `` sql`…` ``. The app fragment lists every field and the renamed error code.
- **Largest diffs:** `packages/2-sql/1-core/contract/src/sql-expression.ts` (the class and tag), `packages/2-sql/2-authoring/contract-ts/src/contract-dsl.ts` and `contract-lowering.ts`, `packages/3-extensions/postgres/src/contract/rls.ts`, and the updated TypeScript fixtures and tests.
- **The order of checks in index lowering matters.** `isSqlExpression(e)` runs before `'render' in e`, because `'render' in 'a string'` throws a `TypeError`.
- **`CONTRACT.DEFAULT_SQL_INTERPOLATION` is gone**, replaced by `CONTRACT.SQL_EXPRESSION_INTERPOLATION`; `CONTRACT.SQL_EXPRESSION_INVALID` is new. The error reference has both.
- **A default whose string constant would change** on reading back is flagged by `infer` and refused by `print`. Infer does not skip it, because a missing default would be dropped by the next migration, which is worse than a changed constant. Postgres reprints a default's layout normalized but keeps string constants character for character, so `infer` can meet such a default.
- **Three tarball tests cannot run on the author's machine** (`pnpm install` in their scratch project refuses `@vercel/detect-agent@1.2.5`). CI is the check for them.
- **Project files.** `projects/sql-expression-literals/` holds the spec, design, plan, review reports and status. It is transient and is deleted at project close-out.

## Behavior changes & evidence

- **The `sql` tag returns a canonicalized `SqlExpression` and interpolates only `sql` values.** `packages/2-sql/1-core/contract/src/sql-expression.ts`. Evidence: `sql-contract/test/sql-expression.test.ts` (canonicalization, escapes, empty text, interpolation, a string or number inside `${…}` refused, constructor NUL refusal, `isSqlExpression`, `requireSqlExpression`) and `sql-expression.test-d.ts` (`sql` returns `SqlExpression` and is not `any`; a string inside `${…}` is a type error; `{ text }` is not assignable).
- **The builder's raw-SQL fields take `SqlExpression` only.** `contract-ts/src/contract-dsl.ts`, `contract-lowering.ts`; `extension-postgres/src/contract/rls.ts`, `full-text-index.ts`; `target-postgres/src/core/authoring.ts`. Evidence: `contract-ts/test/raw-sql-fields.test-d.ts`, the Postgres extension's `rls-handles.test-d.ts` and `full-text-index.test-d.ts`, and every updated call site.
- **`.default()` runs the default checks on a `sql` value.** `contract-ts/src/contract-dsl.ts`. Evidence: `contract-ts/test/contract-dsl.default-sql-expression.test.ts` (exact messages for `now()`, `autoincrement()`, unsafe SQL; `.default(now())` accepted).
- **PSL and TypeScript emit the same contract.** Evidence: `test/integration/test/authoring/parity/sql-expressions/` and the existing parity fixtures, including `rls` and the walking-skeleton test that composes a predicate with `` sql`${OWNER_PREDICATE} AND deleted_at IS NULL` ``.
- **Defaults that would not read back.** `target-postgres/src/core/psl-print/refusals.ts`, `column-defaults.ts`, `psl-infer/infer-model-blocks.ts`. Evidence: the `psl-print` refusal test and the infer test for the note.
- **Docs.** ADR 129, ADR 254, ADR 260 and ADRs 234, 236, 243, 244 (TypeScript examples), `docs/reference/error-reference.md`, `docs/architecture docs/subsystems/5. Adapters & Targets.md`, the contract-ts README, the `prisma-8` skill reference `contract.md`.

## Compatibility / migration / risk

- **Contracts:** no shape change; `fixtures:check` shows no `contract.json` change. A TypeScript text that was not canonical (a multi-line template with indentation, or CRLF) changes its stored text once; the fragment says to run `migration plan` once and what to expect.
- **TypeScript contract authors:** wrap raw SQL in `` sql`…` ``; `.defaultSql()` is unchanged by this PR and is removed separately (TML-3286). The renamed and new error codes are in the fragment.
- **Extension authors:** policy handles and descriptors hold `SqlExpression`; the `sql` tag is imported from `@internal/sql-contract/sql-expression` (the facades still re-export it); `sqlExpressionRegistration` replaces registering the declaration and entry separately.

## Testing performed

On the final HEAD:

- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm lint:deps`, `pnpm lint:casts` (delta 0), `pnpm lint:throws` (delta 0), `pnpm check:error-reference`, `pnpm lint:framework-vocabulary` (272 of 272), `pnpm lint:skills`, `pnpm fixtures:check` (tree clean), `pnpm test:scripts`, `pnpm check:upgrade-coverage --mode pr` against the merge base
- `pnpm test:packages`: all files pass except the 3 tarball files (registry refusal above); files that timed out under heavy machine load pass alone
- Targeted integration files: `test/authoring/**` including the new parity fixture, `test/sql-builder/**`, the RLS walking skeleton, the SQL expression literals and contract-expression CLI journeys, `test/psl-print/**`; the Postgres and Supabase extension suites. The full `test:integration` suite runs in CI.
- Manual QA: the slice 3 script in `projects/sql-expression-literals/manual-qa.md` exercises each `CONTRACT.*` refusal and each compile-time refusal; the run is recorded there
- Architect and code review, reports in `projects/sql-expression-literals/slice-reviews/3/`; every finding is fixed

## Follow-ups

- TML-3297 (stretch): migration files write `sql` values.
- TML-3286: remove `.defaultSql()` at 8.0.0.

## Alternatives considered

- **Keep accepting strings in the TypeScript fields beside `sql` values.** Rejected: two ways to write the same thing, and PSL and TypeScript would emit different contracts for a multi-line body, because only the literal path canonicalizes.
- **A plain object `{ text }` instead of a class.** Rejected: an object literal would be assignable to the field type, so a string wrapped by hand would pass the type check, and `.default()`'s literal-value check could not tell it from a JSON default.
- **Keep the default checks in the tag.** Rejected: the same tag now serves every position, and `no SELECT` would refuse a valid policy predicate such as `EXISTS (SELECT …)`. Checks on SQL content belong to the place that receives the value.
- **Let `sql` interpolate strings and numbers.** Rejected: that is string concatenation of SQL, which is what the typed value exists to prevent; compose `sql` values instead.
- **Skip a default that would not read back in `contract infer`, as for an index.** Rejected: a skipped default is dropped by the next migration, which loses data semantics silently; printing it with a note keeps the default and tells the user what to check.

## Checklist

- [x] All commits are signed off (`git commit -s`) per the [DCO](../CONTRIBUTING.md#developer-certificate-of-origin-dco).
- [x] I read [CONTRIBUTING.md](../CONTRIBUTING.md) and the change is scoped to one logical concern.
- [x] Tests are updated.
- [x] The PR title is in `TML-NNNN: <sentence-case title>` form.
- [x] The **Skill update** section above is filled in.

## Notes for the reviewer

See Reviewer notes above.

Agent: charon-96
