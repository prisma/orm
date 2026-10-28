# Dispatch 19: fixes from the second whole-branch review of PR 3

**Plan:** [`../plan-pr3.md`](../plan-pr3.md) · **ADR:** ADR 309 · **Reviews:** `../reviews/pr3/system-design-review.md` (A18–A26) and `../reviews/pr3/code-review.md` (F6–F9) · **Branch:** `tml-3537-value-objects-storage`

Each item records the decision; do what it says. Write a failing test first for every behaviour change.

## Codecs and their JSON type

1. **A19: name the fact, not the consumer.**
   - Rename `valueObjectJsonType` to `jsonType`. It is the JSON type the codec's value is written as inside a JSON document.
   - The values are `'string' | 'number' | 'boolean' | 'object' | 'array' | 'any'`. `'any'` means the value can be any JSON value, including `null`, as for `Json`. `'presenceOnly'` goes away.
   - Read each codec's encode path, and declare what it actually writes. For example, `pg/enum` writes a string, so it is `'string'`, and `Bytes` writes an object.
   - The check enforces the declared type. A required member is never JSON `null` unless its codec is `'any'`.
   - Some codecs have no JSON form the SQL ORM can write today. `BigInt` is one: the jsonb codec throws when it writes one. For such a codec, declare the type its value would have, and keep the `deferred.md` entry. List each one in the report.
   - Update the codec authoring guide, the error reference and the extension fragment.
2. **F6: a codec without `jsonType` is an error only where a value object member uses it.**
   - At runtime, the registries in the runtime adapter and in the control adapter accept a descriptor without `jsonType`. A codec package compiled before this release keeps working in apps that do not put it in a value object.
   - In TypeScript the field stays required, so authors who rebuild get a compile error.
   - When the build derives a value object check for a member whose codec has no `jsonType`, it refuses with a structured error, not an invariant. The error names:
     - the codec id;
     - the value object and the member;
     - the missing property;
     - what to do: the codec's author adds `jsonType`.

     Add the error to the error reference.
   - Fix the extension fragment's detection, so it also finds descriptors that implement `AnyPostgresCodecDescriptor` directly.
3. **A20: the family codecs declare their own `jsonType`.** The SQL family codecs (`sql/int` and the others) declare it on the family codec, not through options in the Postgres adapter.
4. **A25: the family resolves the JSON type.**
   - The family resolves each member's JSON type when it resolves the value object, into `ResolvedValueObject`.
   - The renderer reads that, and drops its `codecLookup` argument.
   - Remove `NO_CODECS`.

## Contract types and schemas

5. **A18: storage-only functions take storage.** About 30 functions now take `ContractWithDomain['storage']` but read only storage. These include `elementCoordinates`, `changedElementCoordinates`, `entityAt` and SQL's `storageOf`. Type their input `Pick<StorageBase, 'namespaces'>`. Keep `ContractWithDomain` only where the domain is read.
6. **A21: one field type schema.**
   - Export one run-time schema for a field's type from the framework.
   - The framework's value object member schema, the SQL domain field schema and the Mongo domain field schema all use it.
   - SQL's acceptance of a union inside a union then follows whatever the shared schema decides. A union inside a union is refused, as Mongo does.
7. **A22: the published SQL JSON schema matches the refusal.** `data-contract-sql-v1.json` must not allow union or dictionary value object members. Make the generator produce that, or state it in the source schema the generator reads, then regenerate the file.
8. **A24: one name corrected.**
   - Rename `StorageValueObjectSchema` to `ContractValueObjectSchema`, since it validates `ContractValueObject`.
   - Keep `ValueObjectReference`. Its earlier name read as the opposite of `ContractValueObjectField`, which round 1 decided to fix.
   - Keep `anyObject`. Round 1 decided on it.
9. **F7: the SQL union and dictionary refusal names the value object.** The message names the value object and the member: `value object "<ns>:<Name>" member "<member>" is a dictionary; SQL value objects hold no unions or dictionaries, since their check cannot enforce them`. It does not print the namespace as JSON.

## CLI

10. **A26: the JSON key says what users read.** Rename the `--json` key `changedElementCoordinates` to `changedStorageEntities`. That matches the README, the doc comment and the summary text. It stays filled for every written migration. Internal functions keep `changedElementCoordinates`.

## Upgrade script and docs

11. **F8: the script normalizes old Mongo value object members.** It adds `nullable: false` where a member has no `nullable`, and removes `dict: false`. The old Mongo schema allowed both forms. Add tests.
12. **A23: ADR wording.** In ADR 221 and ADR 309, say the framework *reads* the `valueSet` slot where a member names one, and *defines* `valueObject`.
13. **F9: ADR 309's two sentences.** Correct the first Consequence, and the reason given for rejecting the "record without enforcing" alternative, so they agree with the list of cases that have no operations.

## Rules

- Never run `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all`. Run only named files inside `test/integration`, with `pnpm test <file>`, and journeys with `pnpm test:journeys <file>`. `pnpm test:packages` is allowed.
- Use `mise exec --` for node and pnpm. Never `npx`. Do not write to `/tmp` or any system temp directory. Save slow output under `wip/` and read the file. Never use bare `git stash`.
- No comments where the code can say it. No bare `as` casts in production code. No `any` type. No file extensions in imports. No backwards-compatibility exports. Framework packages name no family or target.
- No invented nouns. Never hard-wrap Markdown prose. ADRs carry no ticket ids beyond those already there, and no dispatch names.
- Commit with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`. No AI attribution lines. Stage files explicitly. Commit re-emitted files apart from hand-written changes.
- Do not push. Do not open a PR.

## Done when

The same checks as dispatch 18:

- `pnpm build` and `fixtures:check` are clean.
- `pnpm test:packages` passes, apart from the known tarball trust warning.
- Typecheck passes in every example.
- `lint:deps`, `lint:ratchets`, `check:error-reference` and `check:upgrade-coverage --mode pr --prev $(git merge-base HEAD origin/main) --head HEAD` pass.
- Typecheck, lint and `test --coverage` pass in every touched package.
- These pass:
  - the journeys `value-object-checks`, `value-object-validator.mongo`, `plans-with-no-operations*` and `enum-value-statements*`;
  - `sql-orm-client/value-object-checks`;
  - `authored-contract-roundtrip`;
  - the upgrade script test.

## Report

Plain English, short sentences: each item and what you did, each codec's `jsonType` where it was not obvious, the tests that were red first, the checks, anything you could not do and why, and the commits.
