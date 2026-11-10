# Dispatch 18 — fixes from the whole-branch review of PR 3

**Plan:** [`../plan-pr3.md`](../plan-pr3.md) · **ADR:** ADR 309 · **Reviews:** `../reviews/pr3/system-design-review.md` (findings A01–A17) and `../reviews/pr3/code-review.md` (findings F1–F5) · **Branch:** `tml-3537-value-objects-storage`

F1 is fixed (`059a3e6a8f`). Each item below records the decision; do what it says. Write a failing test first for every behaviour change. One commit per item or per small group of items.

## Contract shape and types

1. **A01 — `valueObject` is a framework storage entity kind.**
   - Record this in ADR 309. Add a matching note to ADR 221's section on pack-contributed entity kinds: value objects and the value sets their members name are kinds the framework defines and reads, because domain fields refer to them.
   - Give the value object field schema one definition that both families use. If a shared schema cannot be imported by both, add a test that one input gives the same entity in both families.
   - Decide `nullable` and `dict` once:
     - `nullable` is required in the JSON, as SQL has it.
     - `dict` is `true` or absent. The Mongo schema currently accepts `false`.
   - Update the JSON schema and any fixture this changes.
2. **A03 — one name for "domain plus storage namespaces."**
   - Widen `ContractWithDomain` to carry `storage: Pick<StorageBase, 'namespaces'>`. Remove `StatementContract` and `ContractPlanes`, and replace the inline `Pick<StorageBase, 'namespaces'>` uses with that type or one exported name for it.
   - Rename the local `StorageNamespaces` aliases, so the word means one thing across the codebase.
3. **A04 and A05 — the names of the storage value object helpers.**
   - Today there are three different functions named `storageValueObjects`, plus an export that only tests use. Give each a name that says what it returns, and remove the test-only export.
   - Make `ValueObjectFieldType` and `ContractValueObjectField` read as what they are: the field type that refers to a value object, and a field of a value object. Rename one of them if a reader cannot tell them apart.
   - Use existing vocabulary. List the names you chose in the report.
4. **A06 — the sixth type parameter of `FieldTypesFromDomain` is required.**
   - Always emit `ContractBase['storage']['namespaces']`, and remove the `hasValueObjects` branch. Every `contract.d.ts` changes, so re-emit.
   - Say in the type's doc comment that it reads both planes.
   - Update the extension upgrade fragment.
5. **A07 — the extension fragment's override example.** Correct the namespace in the example. Say that under `valueObjects` the key is the storage namespace, while under `models` it is the domain namespace.
6. **A14 — names in the column check input.**
   - The column check input reuses the member type. Give the column its own type if a member and a column can differ.
   - Rename `openObject` to say what the predicate accepts there (any object), not why. Use existing vocabulary.
7. **A15 — the Mongo validator.** It looks up value objects by name only. Look them up by the field's coordinate, as every other reader now does. Add a test with two value objects of the same name in different storage namespaces, built by hand as a contract.
8. **A16 and F4 — no unions or dictionaries in SQL.** The SQL storage schema accepts union and dictionary value object members, but SQL code treats them as impossible. Refuse them in the SQL schema, with a message that names the member. Add a test that a hand-written contract with one is refused at validation, not by an internal error in `contract print`.

## Postgres checks

9. **A08 and F2 — a codec's JSON type is declared on the codec or data type, not in a table in the target.**
   - Declare it the way the Mongo family declares `bsonTypes` on its data types (`mongo-data-type.ts`, `bsonTypesOfCodec`). The Postgres renderer reads it through the codec lookup the build already has. Remove `value-object-json-types.ts`.
   - Every Postgres and SQL family codec declares one of these: its JSON type; that it holds any JSON value; or that only presence is checked. This includes the three codecs that came with the merge of main: `pg/timestamp-date@1`, `pg/timestamp-instant@1` and `pg/interval-string@1`.
   - Add a test that fails when a codec declares none of them.
   - Keep the presence-only rules from dispatch 15: a required member is not JSON `null`, and `Json` members hold anything.
10. **A11 — the check kind is `shape`, and its constraint suffix is `shape`.**
    - The sibling kinds name what they check (`membership`, `elementNotNull`). A value object check checks the column's shape. The suffix ships in users' constraint names, so it changes now, before release.
    - Update `CHECK_KIND_SUFFIX`, the docs, the error reference, the upgrade fragment and the `prisma-8-demo` migration, then re-emit.
11. **A13 — one derivation for the build and for print.**
    - Put the discriminator value set derivation and the value object check derivation in one function each, in `@internal/sql-contract/check-expressions` beside `resolveValueObject`.
    - The build and `contract print` both call them. The print round-trip tests then check the comparison, not two copies of the rule.
12. **F3 — the lock.**
    - Add one sentence to the app upgrade fragment and to the Data Contract doc. Adding a check takes a lock on the table while Postgres reads every row. Any later change to a value object renames the check, so the check is dropped and added again, and the rows are read again.
    - Add a `deferred.md` entry: adding these checks as `NOT VALID` and then running `VALIDATE CONSTRAINT`.

## CLI and messages

13. **A12 — `changedStorageEntities`.**
    - Fill it for every migration `migration plan` writes, not only one with no operations.
    - The CLI decides "written with no operations" from the operations, not from whether the field is present.
    - Use the same noun as `changedElementCoordinates` where that reads better.
    - Check that it does not clash with the existing `noOp` field, and say how in the README.
14. **A02 — the domain validator checks storage entities.**
    - Today `validateContractDomain` checks that a value object member's storage value set exists. Move the checks of storage entries to a storage validator: in the framework if there is one, otherwise beside `validateContractDomain` under a name that says it checks storage.
    - Leave the checks of the domain-to-storage reference in the domain validator.
15. **F5 — the refusal for an old snapshot.** Name the upgrade script, as the `noCheck` refusal does. A snapshot cannot be re-emitted.

## ADR 309 and other docs

16. **A09.**
    - Add a short paragraph on why a value object does not have both a domain definition and a storage entity, the way models and tables do. Name the cost: there are no stored names without a later shape change.
    - Change the Prisma 6 reader's diagnostic (`contract-prisma6/src/interpreter.ts` around line 880), so that it no longer promises `@map` support on composite type fields.
    - Say that enum member names are outside the principle, and link TML-3720.
17. **A10.**
    - Limit "every change is an operation" to targets that derive enforcement.
    - List the known no-operation cases:
      - targets with no check renderer (SQLite and MySQL);
      - on Postgres, a member codec or type parameter change that keeps the same JSON type.
    - Point to the no-operations report as how the system handles them.
18. **A17.** Fix the small documentation drift the review lists.

## Rules

- Never run `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all`. Run only named files inside `test/integration`, with `pnpm test <file>`, and journeys with `pnpm test:journeys <file>`. `pnpm test:packages` is allowed.
- Use `mise exec --` for node and pnpm. Never `npx`. Do not write to `/tmp` or any system temp directory. Save slow output under `wip/` and read the file. Never use bare `git stash`.
- No comments where the code can say it. No bare `as` casts in production code. No `any`. No file extensions in imports. No backwards-compatibility exports. Framework packages name no family or target.
- No invented nouns. Never hard-wrap Markdown prose. ADRs carry no ticket ids except where this brief says so (TML-3720), and no dispatch names.
- Commit with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`. No AI attribution lines. Stage files explicitly. Commit re-emitted files apart from hand-written changes.
- Do not push. Do not open a PR.

## Done when

- `pnpm build` and `fixtures:check` are clean.
- `pnpm test:packages` passes, apart from the tarball tests' known `@vercel/detect-agent` trust warning.
- Typecheck passes in every example.
- `lint:deps`, `lint:ratchets`, `check:error-reference` and `check:upgrade-coverage --mode pr --prev $(git merge-base HEAD origin/main) --head HEAD` pass.
- Typecheck, lint and `test --coverage` pass in every touched package.
- These pass:
  - the journeys `value-object-checks.e2e.test.ts`, `value-object-validator.mongo.e2e.test.ts`, `plans-with-no-operations*.e2e.test.ts` and `enum-value-statements*.e2e.test.ts`;
  - `test/integration/test/sql-orm-client/value-object-checks.test.ts`;
  - `authored-contract-roundtrip.integration.test.ts`;
  - the upgrade script test.

## Report

Plain English, short sentences: each item and what you did, the names you chose, the tests that were red first, the checks, anything you could not do and why, and the commits.
