# Slice 2t findings

Two points where the brief or the design does not fit the code. Both are decided and fixed (`dispatches/2t-findings-fixes-brief.md`).

## 1. The `unknown-tag` arm of `lowerDataTypeDefault` cannot simply go

The brief says: "the `unknown-tag` arm of `lowerDataTypeDefault` goes, replaced by the framework reader".

The arm exists because `lowerDataTypeDefault` switches over `DefaultRefusal`, and `DefaultRefusal` must keep `unknown-tag`: `contract-prisma7/src/defaults.ts` reads defaults through the same `readDataTypeDefault` and words that refusal itself (`refusalReason`). `readDataTypeDefault` reads through the framework's `readWrittenValue`, which returns `unknown-tag`. So the type keeps the case, and an exhaustive switch needs an arm for it.

The arm is unreachable from PSL because `psl-column-resolution.ts` checks each tag before it calls `lowerDataTypeDefault` (`readTaggedLiteral`, which uses the framework's `entryForTag` and `knownTags`).

Slice 2t leaves both as they are. The two ways to remove the dead code:

- **A (recommended).** Delete the tag check from `readTaggedLiteral`, so it only checks canonicalization. An unknown tag then reaches `lowerDataTypeDefault` through `readWrittenValue`, and its arm reports it, at the written value, with the same code and message. One place words the refusal, and the arm is live. The scalar `sql` path already calls `readWrittenValue` first, so it needs no other change.
- **B.** Keep the check in `psl-column-resolution.ts` and make the arm throw an `InternalError`. The arm stays, as an assertion.

**Decision:** option A.

**Outcome** (`3facad43e0`): the tag check is gone. The canonicalization that was left is folded into the one function that turns a parsed element into a written value, so the name `readTaggedLiteral` is gone too. An unknown tag is reported by the `unknown-tag` arm of `lowerDataTypeDefault`, with the same code, message and span as before. The existing unknown-tag tests pass unchanged. A new test covers an unknown tag inside a list, reported at that element; it fails when the arm reports at the whole value. Design sections 4 and 10 are corrected. One order changes: `@default` now canonicalizes a tagged literal before it checks the tag, so a literal with both an unknown tag and a NUL character or more text than the limit reports `PSL_TAGGED_LITERAL_NUL` or `PSL_TAGGED_LITERAL_TOO_LARGE`, where it used to report `PSL_UNKNOWN_LITERAL_TAG`. The order is kept, because `dataTypeValue` uses it too; the app upgrade instructions say so (added in the slice 2t review fixes).

## 2. A refusal inside a function call that is an arm of `oneOf` becomes "Expected one of"

`dataTypeValue` works as a parameter of a `funcCall` that is an arm of `oneOf`: the typed value comes back in the call's arguments (tested). But when the argument is refused, `oneOf` replaces every arm's diagnostic with `Expected one of: …` at the whole value (`one-of.ts`). So `@default(nanoid("8"))` would report `Expected one of: …`, not `pg/int4 has no cast from pg/text` at `"8"`.

The project "Data types own column types" requires general codes at the written value for default-function arguments. It will need `oneOf` to keep the diagnostics of an arm whose callee matched (for example, a `funcCall` that matched its name), or `@default` to dispatch on the callee before `oneOf`. That is that project's work; the note to its agent should say so.

**Decision:** `oneOf` keeps the diagnostics of the function the author named. When the argument is a call whose callee is a plain identifier and exactly one alternative is a `funcCall` of that name, `oneOf` returns that alternative's result, success or failure. Every other case is unchanged.

**Outcome** (`c294bfd4f1`, `3ac77e2800`): `oneOf` has the rule and a one-sentence doc comment. `funcCall` and `oneOf` share `plainCallee` to read the callee. New tests: `nanoid("8")` reports `pg/int4 has no cast from pg/text; write a number` at `"8"`; `nanoid(8)` returns the typed value; `other(1)` and two arms named `nanoid` still give `Expected one of`. No existing test asserted a changed message. The one test that covered wrong default-function arguments (`interpreter.defaults.functions.test.ts`) only checked the code, so it now asserts the whole diagnostics: `cuid()` reports `Attribute "cuid" is missing required argument "version"`, `uuid(5)` reports `Expected one of: 4 | 7` at `5`, and `nanoid(1)` reports `Expected an integer between 2 and 255` at `1`. Design section 6, ADR 231, the app upgrade fragment and the manual QA script are updated; the QA run is recorded.

## A08. A third default-only refusal, `no-list-cast`

Review finding A08 asked for `DefaultRefusal` to be the framework's `ReadRefusal | CastRefusal` plus the two default-only arms. The implementer added a third arm, `no-list-cast`, and recorded it in `status.md` and design section 4 instead of here.

A list written on a column that holds one value, whose type has no list cast, has no value type. The framework's `no-cast` needs a `valueType` that is a `DataTypeId`, so it cannot carry this case. Folding it into `unwritable` would say "this target has no data type for a list value", which is false on a stack where a type such as `pgvector/vector` takes lists. ADR 254 makes reading a written list the family's default reader's job, so the refusal belongs in the family, next to `not-a-list`.

**Decision:** `no-list-cast` is approved. In the round 2 review fixes the same reason gave a fourth arm, `no-element-cast`, for an element of a written list that the column type's list cast does not take (review finding B02).
