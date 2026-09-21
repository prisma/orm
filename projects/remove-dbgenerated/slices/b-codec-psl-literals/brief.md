# Implementation brief — literal types for column defaults

You are implementing ADR 254. This brief is self-contained: it assumes you have not seen the discussion that produced the design, and it tells you everything you need to decide nothing for yourself. Where something is not settled, it says so and tells you to stop and ask rather than choose.

## 1. One decision is blocked and must be discussed before you write code for it

**A plain number scalar in a schema does not name a literal type of its own.** Under ADR 254, `42` written on an `Int` column is an `int` literal, on a `BigInt` column a `bigint` literal, and on a `Decimal` column a `decimal` literal. Which one it is depends on what the column's codec declares. That consequence is deliberate but unsettled, and Will has asked to discuss it before it is built.

Three answers are open, and ADR 254 records all three: accept it as written; give each numeric literal type its own tag so a written literal always names its own type; or return to a single `number` literal type whose conversion each codec owns.

**What this means for you:**

- Raise the question with Will before you implement anything in section 6.4 or the numeric part of section 6.3. Ask directly, state the three options, and wait for an answer. Do not pick one, and do not proceed on an assumption.
- Everything else in this brief is settled and you can build it while you wait, in the order section 7 gives.
- Once Will answers, write the answer into the slice specification (section 5) before you write the code that depends on it.

## 2. What this repository is, in the terms this brief uses

Prisma 8 is a data layer whose single source of truth is a **contract**: a JSON file, `contract.json`, that describes every table, column, index and constraint of a database. Nothing generates runtime code from it; tools read it.

Four ideas matter here.

**Authoring surfaces.** A contract is written in one of several ways. The main one is **PSL**, the Prisma Schema Language, the `.prisma` file people write. A second is the TypeScript contract builder. A third is the schema file of an earlier Prisma version, which Prisma 8 reads directly. Every one of these is called a **contract source**, and each turns its own syntax into the same contract.

**Codecs.** A **codec** owns one database type. It converts between the JavaScript value an application uses, the wire form the database driver exchanges, and a JSON form used inside `contract.json`. Its four methods are `encode`, `decode`, `encodeJson` and `decodeJson`. Every codec has a **codec id** such as `pg/int4@1`. A **codec descriptor** holds the codec's static metadata, keyed by codec id: `traits`, `targetTypes`, a params schema, and the factory that makes codec instances. The descriptor is where this work adds a declaration.

**Column defaults.** A column's default in the contract is one of two shapes. `{ kind: 'literal', value }` holds a value, stored in that column's codec JSON form. `{ kind: 'function', expression }` holds SQL text the database evaluates. Nothing in this work changes those two shapes.

**Tagged literals.** PSL can write text that Prisma does not parse, as a **tag** followed by a string: `` sql`now()` ``. The tag says which pack owns the text. This already exists and is described in ADR 129.

## 3. What you are building, in one paragraph

Every literal column default gains a **literal type**: `string`, `boolean`, `int`, `float`, `bigint`, `decimal`, or `json`. Each literal type is defined once in the framework and produces exactly the value shape that the codecs naming it already accept in `decodeJson`. Each codec descriptor names the literal types its columns are compatible with, as a list of names carrying no functions. A contract source turns its own syntax into a literal of a type, the interpreter checks the type against the column's codec and reports a precise error when they do not match, and the literal type produces the value that goes through `decodeJson` into the contract. Printing a schema runs the same path backwards. No codec gains a method, and no per-type code remains in the interpreter or the printer.

## 4. Read these first

Everything listed is committed. Fetch before you start.

**On `main`:**

- `docs/architecture docs/adrs/ADR 129 - Template-Tagged Literals for Extensions.md`. The tagged literal syntax, the canonical body, and how tags are registered.
- `docs/architecture docs/adrs/ADR 184 - Codec-owned value serialization.md`. Why codecs own the JSON form of values. Its PSL half is what ADR 254 replaces.
- `docs/architecture docs/adrs/ADR 252 - An earlier Prisma version's schema is a contract source.md`. The second text contract source you must keep working.
- `docs/reference/codec-authoring-guide.md`. How a codec and its descriptor are written.
- `projects/remove-dbgenerated/spec.md` and `projects/remove-dbgenerated/plan.md`. The project this slice belongs to. Its purpose is removing `@default(dbgenerated("..."))`, a construct that put raw SQL into a default as an unnamed string. Slice A replaced it with the `sql` tagged literal and is merged. Your slice is B. Slice C deletes `dbgenerated` and is not yours.
- `CLAUDE.md` at the repository root, and the rules it points at under `.agents/rules/`.

**On branch `remove-dbgenerated-adr-253`, which is pull request 30334 and may have merged into `main` by the time you read this. Check `main` first; if the file is not there, fetch the branch:**

- `docs/architecture docs/adrs/ADR 254 - Data types and casts.md`. **The design you are implementing. It is authoritative. Where this brief and ADR 254 disagree, ADR 254 wins, and you tell Will about the disagreement.** If review changed the ADR, follow the changed ADR.
- The same branch amends `projects/remove-dbgenerated/spec.md` decisions D9 and D10 to match ADR 254.

**On branch `remove-dbgenerated-codec-psl-literals`, whose pull request 30324 is closed.** This branch holds an earlier, withdrawn attempt at the same slice, built against a design where codecs gained `encodePsl` and `decodePsl` methods. That design is dead. Five pieces of it are worth reusing and are listed in section 8. Do not merge or rebase this branch; take the pieces by hand.

## 5. Your first deliverable: rewrite the slice specification

`projects/remove-dbgenerated/slices/b-codec-psl-literals/spec.md` currently describes the withdrawn design and carries a banner saying so. Rewrite it to describe the work in this brief, in the same shape as the sibling file `projects/remove-dbgenerated/slices/a-sql-default-literal/spec.md`: outcome, design sections, the tests that must exist, definition of done, halt conditions. Keep it a slice-level document. Do not restate ADR 254's rationale; point at it.

Commit the rewritten spec before you write implementation code, so the two are reviewable apart.

## 6. The design, in full

### 6.1 Literal types live in the framework

Add literal types to `packages/1-framework/1-core/framework-components`, alongside the codec surface in `src/shared/`, exported through `src/exports/codec.ts`. There are seven, and no others in this slice.

| Literal type | The value it produces | Reading rules | Writing rules |
|---|---|---|---|
| `string` | The text | Escapes are already resolved by the source | Print as the source's string syntax |
| `boolean` | `true` or `false` | | |
| `int` | A JSON number, whole | Refuse text that is not a whole number, and refuse `NaN` and the infinities | Print the digits |
| `float` | A JSON number, or the text `NaN`, `Infinity`, or `-Infinity` | Accept a number, or one of those three words | Print a finite number plainly with no exponent; print the three special values as a quoted string |
| `bigint` | The digits as text | Refuse text that is not a whole number | Print the digits |
| `decimal` | Decimal text | Keep trailing zeros. Remove leading zeros and the sign of zero, so `007` reads as `7`, `-0` as `0`, and `-007.50` as `-7.50`. Accept `NaN`, `Infinity` and `-Infinity` | Print a finite decimal plainly with no exponent; print the three special values as a quoted string |
| `json` | A JSON value | Parse the body as JSON once | Print `JSON.stringify` of the value |

The canonicalisation rules for `decimal` already exist on `main` in `packages/2-sql/2-authoring/contract-psl/src/number-literal-default.ts`, in `canonicalDecimalText`. Move that logic into the `decimal` literal type and delete that file, its export from `packages/2-sql/2-authoring/contract-psl/src/exports/resolution.ts`, and its test.

A literal type must never convert a number through a JavaScript number except where the table says it produces a JSON number. `bigint` and `decimal` carry digits as text end to end.

### 6.2 Codec descriptors name their literal types

Add an optional member to `CodecDescriptor` in `packages/1-framework/1-core/framework-components/src/shared/codec-descriptor.ts`, and to `CodecDescriptorImpl`, naming the literal types that codec's columns are compatible with. It carries names only and no functions. A codec that names none accepts no literal defaults; its columns can still take a `sql` default.

The complete inventory follows. Every codec id in the repository appears exactly once. Implement it exactly.

**Postgres target, `packages/3-targets/3-targets/postgres/src/core/`:**

| Codec ids | Literal type |
|---|---|
| `pg/text@1`, `pg/char@1`, `pg/varchar@1`, `pg/uuid@1`, `pg/inet@1`, `pg/bit@1`, `pg/varbit@1`, `pg/timetz@1`, `pg/interval@1`, `pg/bytea@1`, `pg/enum@1`, `pg/date-string@1`, `pg/time-string@1`, `pg/timestamp-string@1`, `pg/timestamptz-string@1`, `pg/date-temporal@1`, `pg/time-temporal@1`, `pg/timestamp-temporal@1`, `pg/timestamptz-temporal@1`, `pg/timestamptz-date@1` | `string` |
| `pg/int4@1`, `pg/int2@1`, `pg/int8number@1`, `pg/int@1` | `int` |
| `pg/float4@1`, `pg/float8@1`, `pg/float@1` | `float` |
| `pg/int8@1`, `pg/unboundedint@1` | `bigint` |
| `pg/numeric@1` | `decimal` |
| `pg/json@1`, `pg/jsonb@1` | `json` |
| `pg/bool@1` | `boolean` |
| `pg/text-array@1` | none. It is internal to list handling and no column authored in a schema uses it |

`pg/enum@1` names `string` because its JSON form is the member's storage string. This does not change how enum defaults are written; see section 6.6.

**SQLite target, `packages/3-targets/3-targets/sqlite/src/core/codecs.ts`:** `sqlite/text@1`, `sqlite/blob@1` and `sqlite/datetime@1` name `string`. `sqlite/integer@1` and `sqlite/bigintnumber@1` name `int`. `sqlite/real@1` names `float`. `sqlite/bigint@1` names `bigint`. `sqlite/json@1` names `json`.

**SQL base codecs, `packages/2-sql/4-lanes/relational-core/src/ast/sql-codecs.ts`:** `sql/text@1`, `sql/char@1` and `sql/varchar@1` name `string`. `sql/int@1` names `int`. `sql/float@1` names `float`.

**Extensions:** `pg/vector@1` and `arktype/json@1` name `json`. `pg/geometry@1` names `string`, because its JSON form is hexadecimal text.

**Mongo:** `mongo/string@1`, `mongo/bool@1`, `mongo/date@1`, `mongo/double@1`, `mongo/int32@1`, `mongo/vector@1`, `mongo/array@1` and `mongo/document@1` name nothing and do not change. No Mongo contract source reads a default from text.

`sqlite/real@1` and `sql/float@1` refuse `NaN` and the infinities inside `decodeJson` already. Leave that. The `float` literal type carries those values and the codec rejects them, which produces the right error on those targets.

### 6.3 The PSL interpreter reads literals through literal types

Files: `packages/2-sql/2-authoring/contract-psl/src/sql-attribute-specs.ts`, `psl-column-resolution.ts`.

The `@default(...)` argument today has separate arms for a string, a number, a boolean, a list, a function call, an enum member, and, since slice A, a tagged literal. Replace the string, number and boolean arms with one arm that yields the written scalar and its syntax kind, keep the list arm wrapping it, and leave the function-call, enum-member and tagged-literal arms alone.

Resolution order for a default that is a literal:

1. A tagged literal takes the literal type its tag writes, from the tag registry. The `sql` tag is not a literal type and keeps slice A's behaviour of lowering to a raw SQL default.
2. A plain scalar takes its literal type from the column's codec declaration. **A string scalar takes `string` and a boolean scalar takes `boolean`, both unambiguous. A number scalar is the blocked decision in section 1: do not implement it until Will has answered.**
3. If the literal's type is not one the column's codec names, report `PSL_DEFAULT_LITERAL_TYPE_INCOMPATIBLE` at the literal, with a message naming the codec and the types it accepts, for example `Field "Account.meta": pg/int4@1 is not compatible with a json literal; it accepts int literals`.
4. Ask the literal type to read the written text. Text it refuses is `PSL_INVALID_DEFAULT_LITERAL` at the literal, with the reason. A `json` body that is not valid JSON is `PSL_INVALID_JSON_LITERAL`.
5. Pass the value to the column codec's `decodeJson`. A thrown error becomes `PSL_INVALID_DEFAULT_LITERAL` at the literal, carrying the codec's message.
6. Store the default as it is stored today.

A missing codec in the lookup is an internal error, not a diagnostic: the lookup that resolved the column must carry its codec.

### 6.4 The `json` tag

Each SQL target registers a `json` tag in the registry slice A added, `ControlMutationDefaults.defaultLiteralTagRegistry`. Register it with no prefixed alias: `json` only, on Postgres and on SQLite. The registry entry says which literal type the tag writes. A tag no pack registers keeps slice A's diagnostic, `PSL_UNKNOWN_DEFAULT_LITERAL_TAG`.

### 6.5 The earlier Prisma version's schema reader

Files under `packages/2-sql/2-authoring/contract-prisma7/src/`, principally `defaults.ts` and `target-binding.ts`, plus `packages/3-targets/3-targets/postgres/src/core/prisma7-binding.ts`.

That reader has its own per-type handling for defaults, including a rule that `Int` and `BigInt` defaults must be whole numbers, and a path that parses quoted JSON text. Replace both with the same route as section 6.3: map the written syntax to a literal of a type, check it against the codec's declaration, read it with the literal type, pass it to `decodeJson`. Its diagnostics keep their existing code, `PSL.PRISMA7_UNKNOWN_DEFAULT`, with the reason from the literal type or the codec.

Two behaviours of that reader stay exactly as they are:

- A `Bytes` or `DateTime` default is carried as a raw SQL expression rather than a value, because verification cannot yet compare those as typed values. This is decision D11 in the project spec.
- Its diagnostic for a JSON default of `null`, `PSL.PRISMA7_JSON_NULL_DEFAULT_UNSUPPORTED`, stays and keeps firing.

That language writes a JSON default as a quoted string, such as `@default("{\"a\":1}")`. The reader turns that quoted string into a `json` literal itself. Prisma 8's own PSL does not accept that form; see section 6.7.

### 6.6 The printer

Files: `packages/2-sql/9-family/src/core/psl-contract-infer/default-mapping.ts` and the Postgres printer under `packages/3-targets/3-targets/postgres/src/core/psl-infer/`.

`contract infer` reads a live database and prints a schema. For a literal default it must now take the literal type the column's codec names, ask that type to write the stored value, and print the result: as a plain scalar where the literal type has one, otherwise as a tagged literal with the tag that writes it. When the codec names no literal type, or the literal type cannot write the value, keep whatever the printer does on `main` for a default it cannot express. Slice C changes that fallback; you do not.

Delete the per-type formatter table in the Postgres printer, `PslDefaultValueFormat`, `pslDefaultValueFormat`, `formatPslValue`, `formatPslListLiteralValue` and the helpers they use, and the equivalent literal formatting in the family's `default-mapping.ts`.

### 6.7 Behaviour that changes for people who already wrote schemas

Three forms that work today become errors. Each needs an entry in the app-author upgrade instructions; section 9 says where.

- A JSON column with a quoted JSON string, `Jsonb @default("{}")`. It becomes `` Jsonb @default(json`{}`) ``.
- A decimal column with a quoted decimal, `Decimal @default("1.50")`. It becomes `Decimal @default(1.50)`.
- Any other quoted value on a column whose codec names a non-`string` literal type.

Two forms are unchanged and must stay working: an enum column's default is a bare member name, such as `@default(ACTIVE)`; and a list column keeps PSL's list syntax, `Int[] @default([1, 2])`, where each element is checked against the element codec's declaration, so `` Jsonb[] @default([json`{}`, json`[]`]) `` is valid and `Int[] @default([1, "x"])` is refused at its second element.

`` Json @default(json`null`) `` is allowed and stores JSON null.

### 6.8 What you must not change

- The contract format. Every `contract.json` already in the repository must come out byte-identical. `pnpm fixtures:check` is the proof.
- The `Codec` interface. No codec gains a method in this slice.
- The TypeScript contract builder's `.default(value)`, which passes a value of the codec's own type and is checked by TypeScript.
- Anything about `dbgenerated`, which slice C removes.
- The DDL rendering half of ADR 184, which stays future work.

## 7. Order of work

1. Rewrite the slice specification (section 5).
2. Literal types in the framework, with their own tests (section 6.1).
3. The descriptor member and the full inventory of declarations, with a test per pack asserting every registered codec's declaration (section 6.2).
4. The `json` tag on both targets (section 6.4).
5. The interpreter, for the `string`, `boolean` and `json` literal types only (section 6.3, steps 1 and 3 to 6).
6. The printer for the same types (section 6.6).
7. The earlier Prisma version's reader (section 6.5).
8. **Stop. The numeric literal types need the blocked decision from section 1.** If it is answered by now, implement them across the interpreter, the printer and the reader, and update the slice specification first.
9. Documentation and upgrade instructions (section 9).
10. Full gates and the pull request (sections 10 and 11).

Steps 5 to 7 leave the repository in a state where numeric defaults do not yet work, so the branch is not ready to merge until step 8 lands. Do not open the pull request before then.

## 8. What to reuse from the closed branch

Branch `remove-dbgenerated-codec-psl-literals`. Take these by hand; ignore everything else on it, especially anything adding `encodePsl`, `decodePsl`, a `PslLiteral` type, or a `literal()` parser combinator.

- **The end-to-end test** at `test/integration/test/cli-journeys/codec-psl-literal-defaults.e2e.test.ts`, which emits a schema using every literal kind, runs `db init`, verifies the database, and reads a row back through the client. Adapt its schema to the new syntax, in particular the JSON column.
- **The JSON round-trip case** in `test/integration/test/cli-journeys/infer-roundtrip-fidelity.e2e.test.ts`, which asserts that a `jsonb` default survives infer, emit and verify without a workaround.
- **The float fix** in `packages/3-targets/3-targets/postgres/src/core/codec-helpers.ts`: `pg/float4@1` and `pg/float8@1` carry `NaN` and the infinities as text in their JSON form and on the wire, and read them back as numbers. The `float` literal type depends on this.
- **The decimal canonicalisation behaviour** for `pg/numeric@1`, as test cases. The logic itself comes from `main` as section 6.1 says.
- **The Postgres printer's codec lookup**, `packages/3-targets/3-targets/postgres/src/core/psl-infer/infer-default-codec.ts`, which finds the codec that `contract emit` binds to a printed PSL type name. The printer needs a codec and this is how it gets one. Note the reason recorded there: several codecs share one database type, so the printed type name, not the database type, picks the codec.

One trap from that branch: when the `@default` argument arms change, the language server's completion for `@default(` loses its `true` and `false` suggestions unless the new arm offers them. There is a test for it in `packages/1-framework/3-tooling/language-server`.

## 9. Documentation to update in the same pull request

- `docs/reference/error-reference.md`: add `PSL_DEFAULT_LITERAL_TYPE_INCOMPATIBLE`, `PSL_INVALID_DEFAULT_LITERAL` and `PSL_INVALID_JSON_LITERAL`, in the form its neighbours use, and update the earlier-version reader's message wording where it changed.
- `docs/reference/codec-authoring-guide.md`: a codec descriptor names its literal types; show one example.
- `packages/2-sql/2-authoring/contract-psl/README.md`: one paragraph on how a literal default is written and what the column's codec accepts.
- Upgrade instructions for the three broken forms in section 6.7, following the `record-upgrade-instructions` skill in `skills-contrib/record-upgrade-instructions/`. Both audiences need one: app authors, whose schemas change; and extension authors, whose codec descriptors should name literal types. The repository check for this is `pnpm check:upgrade-coverage --mode pr`.
- If ADR 254 has merged and your implementation diverges from it in any way, update the ADR in this pull request and say so in the description.

## 10. How to work

- Follow the Drive process: invoke the `drive-process` skill and run the slice with one implementer and one reviewer, resumed across dispatches.
- Tests before implementation, as `CLAUDE.md` requires. Every named test must fail before the change that makes it pass.
- Use `pnpm`, never `npm` or `npx`. Use the shell's Node; do not switch versions.
- Run slow commands through their `:agent` variants and read the log file each prints, per `.agents/rules/running-tests.mdc`.
- No `any`, no bare `as` casts in production code, no comments that restate the code, and test names that omit "should". The rules under `.agents/rules/` are not optional.
- Stage files explicitly and sign off every commit, per `.agents/rules/git-staging.mdc`. Do not push until the work is ready for review.

## 11. Definition of done

- `pnpm typecheck`, `pnpm test:packages`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm lint`, `pnpm lint:deps`, `pnpm lint:docs` and `pnpm fixtures:check` all green, the last with no contract file changed.
- `pnpm lint:throws` and `pnpm check:upgrade-coverage --mode pr` green. Neither runs under `pnpm lint`, and continuous integration fails without them.
- `git grep -n "numberLiteralDefault\|PslDefaultValueFormat\|formatPslValue\|formatPslListLiteralValue" -- packages` returns nothing.
- A test per pack asserts that every codec it registers declares the literal types this brief's inventory gives it, so a codec added later without a declaration fails.
- The end-to-end test from section 8 passes against a real database, covering every literal type.
- One pull request against `main`, with a description that follows the `create-pr` skill in `skills-contrib/create-pr/`. This project has no Linear ticket, so omit the ticket prefix from the title and say so in the checklist.

## 12. Stop and ask Will if

- The blocked decision in section 1 is still unanswered when you reach step 8.
- A codec's JSON form turns out not to match the literal type this brief assigns it, so the declaration would need a conversion function after all. That would reopen the ADR's central claim.
- Making a codec declaration work would require changing what a `contract.json` stores.
- A contract source other than PSL and the earlier version's reader turns out to read literal defaults.
- The rewritten slice specification would need a design decision this brief does not give you.
