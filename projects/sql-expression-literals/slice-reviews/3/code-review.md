# Slice 3 code review (TML-3289)

Range: `tml-3288-sql-expression-places..tml-3289-sql-expression-ts` (HEAD `1bd6a49b61`). Reviewer lens: principal engineer. Code read at HEAD.

## Summary

The slice does what design sections 2 and 15 say. The `sql` tag returns a frozen `SqlExpression` whose constructor canonicalizes. The tag refuses any interpolated value that is not a `sql` value, with the exact message and `meta.index`. Every raw-SQL builder field takes only `SqlExpression`, and lowering reads each field through `requireSqlExpression` with the design's `what` strings. The index `expression` check runs `isSqlExpression` before `'render' in`, so a string reaches the refusal and not a `TypeError`. `.default()` runs the reserved-function and unsafe-SQL checks with the exact messages and `meta`. The parity fixture proves that PSL and TypeScript emit the same contract and storage hash for indented multi-line text, quoted identifiers, a backslash and an interpolated predicate. I found no behaviour bug in the new code.

The most important finding is a missing test on a row-level security path (F02). Nothing tests that policy lowering refuses a string `using` or `withCheck`. If `predicateText` read `policy.using?.text` instead of calling `requireSqlExpression`, a string predicate from untyped JavaScript would be dropped without an error, and every test would still pass. The next most important finding is in the upgrade fragments (F01): the main detection pattern matches committed migration files, which keep strings, and the prose does not say so.

Targeted run, log in `wip/review3/`: `packages/2-sql/1-core/contract/test/sql-expression.test.ts`, 52 tests pass. Other results are read from the implementer's logs in `wip/3/`.

## What looks solid

- `sql` follows design section 2 step by step: it checks every value first, resolves escapes per template piece, inserts interpolated text unchanged, and canonicalizes the joined text once. Tests cover an empty text, raw backslashes (`'\d+'`, `E'\n'`), the three escapes (`` \` ``, `\\`, `\${`), a real `${` in the raw text, and interpolated text that holds backslashes.
- The refusal test for interpolation covers a string, a number and `{ text: 'x' }` at index 0 and index 1, and asserts code, exact message and `meta.index`.
- `SqlExpression` refuses NUL with `meta: { reason: 'nul', offset: 1 }` and oversize text with the exact message. `isSqlExpression` accepts a value made by another copy of the package and refuses `{ text: 'x' }`, a string, `null` and `undefined`.
- `indexExpressionText` in `contract-lowering.ts` has the three-way order the design requires. `contract-lowering.sql-expression.test.ts` would fail with a `TypeError` if the order were reversed, because it lowers a string expression and asserts `CONTRACT.ARGUMENT_INVALID`.
- `.default()` keeps `.default({ kind: 'function', expression })`, `now()` and `autoincrement()`, and passes `NOW()` and `uuid()` as raw SQL. Each behaviour has a test with whole-value assertions.
- The type tests carry `not.toBeAny()` sentinels on `sql` and on `RlsUsingPolicyDescriptor['using']`. Every `@ts-expect-error` for a string would turn into "unused directive" if the field became `any`. The implementer's red log (`wip/3/red-tc-contract-ts.log`) shows the string cases were unused before the change, including the `.sql({ indexes })` object form, so those cases are not vacuous.
- The builder facades export `type SqlExpression` only. `raw-sql-fields.test-d.ts` asserts the contract-builder entry has no `SqlExpression` value.
- The deleted `sql-default-literal.ts` has no remaining importer. `DEFAULT_SQL_INTERPOLATION` survives only in the error reference's rename note and the upgrade fragments. Every test of the old tag moved to `sql-expression.test.ts` or `contract-dsl.default-sql-expression.test.ts`.
- `contract print` refuses a default whose text does not read back, with the same wording as the other objects and `meta: { coordinate }`. `contract infer` prints it through `printTaggedLiteral`, not the throwing `printSqlExpressionLiteral`, and adds the note.
- No `any`, no bare `as` in production code, no re-export outside `exports/`, no test name with "should". The done-condition grep over `docs/`, `skills/`, `skills-contrib/` and package READMEs finds only PSL text and an unrelated arktype example.

## Findings

### F01. The builder detection pattern matches migration files, which keep strings

- Location: `upgrade-instructions/pending/sql-expression-literals-ts/app/instructions.md` and `.../extension/instructions.md`, changes `builder-raw-sql-is-a-sql-value` and `storage-hash-may-change-once`; `wip/3/detection-check.mjs`.
- Issue: The pattern `\b(where|expression|using|withCheck)\s*:\s*['"\x60]` with glob `**/*.{ts,mts,cts}` matches `examples/prisma-8-demo/migrations/app/20260922T1218_add_post_title_search/migration.ts:22`, `expression: 'to_tsvector(\'english\', "title")'`. Generated migration files hold `createIndex({ expression, where })`, `addCheckConstraint({ expression })` and policy operations with string arguments, and these stay strings (design section 16; slice 5 is a stretch). The prose never says migration files keep strings. An upgrade agent that follows the detection hit wraps the string in `sql` and breaks a committed migration. The detection check tests no migration-file case, and the app entry had nothing to validate because `examples/` did not change, so validation by execution could not catch this.
- Suggestion: add one sentence to the `builder-raw-sql-is-a-sql-value` prose in both audiences, and a migration-file line to the detection check's false positives. If the pattern format allows it, also exclude the migrations folder.

```md
Migration files (`migration.ts`) are not contracts: `createIndex`, `addCheckConstraint` and the policy operations keep taking strings, so leave them as they are.
```

### F02. Policy lowering's refusal of a string predicate has no test

- Location: `packages/3-targets/3-targets/postgres/src/core/authoring.ts`, `predicateText` and its two calls in `postgresLowerEntityHandles`.
- Issue: `contract-lowering.sql-expression.test.ts` covers index `where`, index `expression` and check `expression`, but no test lowers a policy whose `using` or `withCheck` is a string at run time. The manual QA run covers `using` only, and manual QA is not a regression test. A plausible edit, `...ifDefined('using', policy.using?.text)`, passes every test and silently drops a string predicate from untyped JavaScript. For a policy that takes both predicates, the contract would then hold a policy with one predicate missing, which changes which rows it admits, and nothing would report it.
- Suggestion: add a test beside the existing RLS lowering tests (for example `packages/3-extensions/postgres/test/contract-builder/rls-entities.test.ts`) that builds a contract with `using` and then `withCheck` cast to `SqlExpression` from a string, and asserts the whole refusal.

```ts
it.each([
  ['using', 'Policy "using"'],
  ['withCheck', 'Policy "withCheck"'],
] as const)('refuses a string %s at lowering', (predicate, what) => {
  const untyped = 'true' as unknown as SqlExpression;
  const build = () =>
    defineContract({
      models: { Profile },
      entities: [policyUpdate(Profile, { name: 'p', roles: [anon], [predicate]: untyped })],
    });
  expect(build).toThrow(
    expect.objectContaining({
      code: 'CONTRACT.ARGUMENT_INVALID',
      message: `${what} must be a sql\`...\` value.`,
      meta: { what },
    }),
  );
});
```

### F03. No test joins several interpolated values

- Location: `packages/2-sql/1-core/contract/test/sql-expression.test.ts`, `describe('sql')`.
- Issue: The successful join is tested with one interpolated value only. The `reduce` reads `strings.raw[index + 1]`, and an off-by-one there shows only with two or more values. The case with two values (`a ${sql`x`} ${value} b`) throws before joining. The oversize test also omits `meta`, which the NUL test asserts.
- Suggestion: add one case with three values and text between them, and assert `meta: { reason: 'too-large', offset: … }` in the oversize case.

```ts
it('joins several interpolated values in order', () => {
  const [a, b, c] = [sql`a = 1`, sql`b = 2`, sql`c = 3`];
  expect(sql`(${a} OR ${b}) AND ${c} -- end`.text).toBe('(a = 1 OR b = 2) AND c = 3 -- end');
});
```

### F04. A deprecated matcher in the new type test

- Location: `packages/2-sql/1-core/contract/test/sql-expression.test-d.ts`, test "an object with a text is not a SqlExpression".
- Issue: `expectTypeOf({ text: 'x' }).not.toMatchTypeOf<SqlExpression>()` uses the matcher `vitest-expect-typeof.mdc` forbids.
- Suggestion: `expectTypeOf({ text: 'x' }).not.toExtend<SqlExpression>();`

### F05. Two more test fixtures rebuild the `sql/expression` registration by hand

- Location: `packages/2-sql/9-family/test/psl-build/default-mapping.test.ts` (lines 78 and 122) and `packages/2-sql/9-family/test/control-instance.sql-expression-casts.test.ts` (lines 33-34).
- Issue: The carried-over item named four fixtures, and those four now spread `sqlExpressionRegistration`. These two still list `sqlExpressionDataType` and `{ [SQL_EXPRESSION_DATA_TYPE_ID]: sqlExpressionAuthoringEntry }` by hand. Per `fix-the-class-not-the-instance.mdc`, the item names a class: a fixture that drifts from the family's registration.
- Suggestion: spread `sqlExpressionRegistration.dataTypes` and `.authoring` in both, as in the other four.

### F06. One extension detection pattern matches every contract-builder import

- Location: `upgrade-instructions/pending/sql-expression-literals-ts/extension/instructions.md`, change `sql-tag-lives-in-sql-contract`, pattern `from\s+['"]@internal/sql-contract-ts/contract-builder['"]`.
- Issue: The change is about where `sql` lives and what it returns, but this pattern fires on any file that imports anything from the builder module, so most extension files match. The skill asks for token-precise patterns tested against the nearest false positive; here the nearest false positive is an import of `field` or `model` only, and the detection check does not include it.
- Suggestion: match imports that name `sql`, and add `import { field } from '@internal/sql-contract-ts/contract-builder';` as a false positive.

```text
import\s*(type\s*)?\{[^}]*\bsql\b[^}]*\}\s*from\s*['"]@internal/sql-contract-ts/contract-builder['"]
```

### F07. The infer test for a default that does not read back checks only a prefix

- Location: `packages/3-targets/3-targets/postgres/test/psl-infer/infer-sql-expression-literals.test.ts`, "prints the default and notes it on the model".
- Issue: `expect(psl).toContain('label   String @default(sql`')` passes for any `sql` default on that column. It does not prove which literal is printed, so a change that printed the canonical text, or the wrong quote form for a text with a carriage return, would pass. The sibling test asserts the whole line.
- Suggestion: assert the whole printed field line, as the "adds no note" test does.

## Deferred

- **Refusal messages do not name the object.** ``Policy "using" must be a sql`...` value.`` does not say which policy or model. Design section 15 fixes the `what` strings, and only untyped JavaScript reaches this message, so changing it is a design decision, not a review fix.
- **No public way to make a `sql` value from a computed string.** The builder facades export only the `SqlExpression` type, so code that generates SQL text at run time has no supported constructor. Design section 15.1 chose this, and interpolation covers composition. Worth a ticket if a user asks.
- **`sqlExpressionRegistration` is not frozen.** The family descriptor now shares one `dataTypes` array with every importer, where it used to build its own. Nothing mutates it today; freezing it is cheap but not required by the design.
- **The ADR 260 TypeScript example uses `Post` without defining it.** It is illustrative, like the other ADR snippets; not worth a round.

## Acceptance-criteria verification

| # | Criterion | Verdict | What I read |
| --- | --- | --- | --- |
| 1 | Plan test: `sql-expression.test.ts` extended (canonicalization, escapes, empty text, interpolation joined then canonicalized, string and number refused, constructor canonicalization and NUL, `isSqlExpression`, `requireSqlExpression`) | WEAK | All named cases are present and assert code, message and `meta`; I ran the file, 52 pass. Several interpolated values are not tested, and oversize `meta` is not asserted (F03). |
| 2 | Plan test: `sql-expression.test-d.ts` (`not.toBeAny()`, string and number in `${…}` are errors, `{ text }` not assignable) | PASS | Sentinel present; both `@ts-expect-error` cases present; `{ text: 'x' }` refused by assignment. Uses a deprecated matcher (F04). |
| 3 | Plan test: `raw-sql-fields.test-d.ts` (string, number, boolean refused in index `where`, `expression`, `check`, `IndexConstraint.where`; `sql` compiles; three `.default()` forms compile) | PASS | Every case present; red log shows the string cases were unused directives before the change. |
| 4 | Plan test: `contract-dsl.default-sql-expression.test.ts` (`now()`, `autoincrement()` exact messages; unsafe SQL; `.default(now())` passes) | PASS | Exact messages and `meta` asserted; unsafe SQL with message and `meta`; `now()`, `autoincrement()` and the function object pass. |
| 5 | Plan test: `rls-handles.test-d.ts` and `full-text-index.test-d.ts` updated | PASS | String, number and boolean are `@ts-expect-error` in every policy helper and in `fullTextIndex` `where`; `not.toBeAny()` on the descriptor field. |
| 6 | Plan test: parity fixture `parity/sql-expressions/` | PASS | Partial index and default over indented multi-line text (indented differently in each language), expression index, full-text `where`, check with `\s`, policy with `withCheck` interpolating `using`. `cli.emit-parity-fixtures.test.ts` compares the parsed contracts and the storage hashes; `wip/3/parity-red.log` shows it red before the expected file. |
| 7 | Carried over: `sqlExpressionRegistration` used in the family descriptor and spread in the four fixtures | PASS | `control-descriptor.ts` and all four fixtures use it. Two more hand-built copies remain (F05). |
| 8 | Carried over: print refuses, infer prints and notes a default that does not read back | PASS | `column-defaults.ts`, `refusals.ts`, `infer-model-blocks.ts`; print test asserts the whole error; infer note asserted; printed literal asserted by prefix only (F07). |
| 9 | Spec requirement 3: checks on SQL text belong to the consumer | PASS | The tag runs no check; `.default()` runs both; index, check and policy lowering run none. |
| 10 | Spec requirement 4: same contract from PSL and TypeScript | PASS | The constructor canonicalizes, so the tag, interpolation and the constructor all store canonical text; parity fixture proves it for multi-line text. |
| 11 | Spec requirement 5: names and stored text | PASS | Fragment `storage-hash-may-change-once` describes the one-time hash change and `migration plan`/`migration new` steps; wire names hash normalized text, which canonicalization does not change. |
| 12 | Spec requirement 9: breaking changes documented for both audiences | WEAK | Both fragments carry the design's change ids, supersede notes checked against the rc.11-to-rc.12 sources. The main detection pattern matches migration files, which the prose does not exclude (F01); one extension pattern is too broad (F06). |
| 13 | Done: `build`, `typecheck`, `lint`, `lint:deps`, `lint:casts`, `lint:throws`, `check:error-reference` | PASS | Implementer logs in `wip/3/` and status.md; not rerun. |
| 14 | Done: `test:packages` | PASS | `wip/3/test-packages.log`: 7 files fail; the three tarball tests are known, and the other four pass alone (`rerun-*.log`). |
| 15 | Done: touched integration files pass alone | PASS | `wip/3/integration.log`, 92 files and 1276 tests; extension logs 25 and 18 files. |
| 16 | Done: `fixtures:check` with no `contract.json` change | PASS | `wip/3/fixtures:check.log`. |
| 17 | Done: `lint:framework-vocabulary` count equals threshold | PASS | 272 of 272 per status.md. |
| 18 | Done: `check:upgrade-coverage` and validation by execution | WEAK | `upgrade-coverage.log` exits 0; extension entry validated against `packages/3-extensions/`; the app entry validated nothing because `examples/` did not change, and its detection hits a committed migration file (F01). |
| 19 | Done: manual QA script and run | PASS | `manual-qa.md` slice 3: run-time refusals and `tsc` refusals recorded, each as expected. |
| 20 | Done: grep for string arguments to TS raw-SQL fields in docs | PASS | I reran the pattern over `docs/`, `skills/`, `skills-contrib/` and package READMEs; matches are PSL prose and an unrelated arktype example only. |

## Counts

| Item | Count |
| --- | --- |
| Findings | 7 (F01 to F07) |
| Medium | 2 (F01, F02) |
| Low | 5 (F03 to F07) |
| PASS | 17 |
| WEAK | 3 |
| FAIL | 0 |
| NOT VERIFIED | 0 |
