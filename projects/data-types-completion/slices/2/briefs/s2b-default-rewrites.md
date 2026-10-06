# SQLite default rewrites for the upgrade script (dispatch d)

Source: design section 9.3 as built in slice 2 dispatch b. These rules apply to literal defaults only. A function default (`{ "kind": "function", ... }`) is never changed.

## When a rule applies

Apply these rules only to a contract whose `target` is `sqlite`, and only to an object that the script rewrites in step 3 of design 10.1: an object that carries both `codecId` and `nativeType`. A contract already in the new format carries `dataType` and no `nativeType`, so it is skipped, and the script stays idempotent. This matters because an old `sqlite/json@1` default holding a JSON string (the document `"plain"`) and a new one (the text `"\"plain\""`) are both strings, and only the format of the contract tells them apart.

The rule is chosen by the object's `codecId` and changes `default.value` when `default.kind` is `literal`.

## Rules

1. `sqlite/json@1`: `value` becomes the JSON text of the stored document, including `null`, which becomes the text `"null"`: the old codec read a stored `null` as the JSON `null` document and the planner wrote `DEFAULT 'null'` (design 10.1 step 4). The text is `JSON.stringify` with object keys sorted at every level and no whitespace. This is `canonicalizeJson` from `@internal/framework-components/utils`. A stored object, array, number, boolean or string all take this rule; a stored string `plain` becomes the text `"plain"` (with the quotes). Stored documents in an emitted or snapshot `contract.json` already have sorted keys, so this equals plain `JSON.stringify` of the stored value.
2. `sqlite/integer@1`, and `sql/int@1` in a SQLite contract: if `value` is a JSON number, it becomes its decimal digits: `BigInt(value).toString()`. `-0` becomes `"0"`. The old codec refused any number that is not a safe integer, so every stored number converts exactly. A string `value` is left unchanged.
3. `sqlite/bigint@1` and `sqlite/bigintnumber@1`: these already store digit text. If `value` is a JSON number (a hand-written contract), apply rule 2. Otherwise leave it unchanged.
4. Every other SQLite codec (`sqlite/text@1`, `sqlite/datetime@1`, `sqlite/real@1`, `sqlite/blob@1`, `sql/char@1`, `sql/varchar@1`, `sql/float@1`): no change. `sqlite/datetime@1` already stores ISO text and `sqlite/real@1` a JSON number.

## `contract.d.ts`

The emitter writes each literal default as `DefaultLiteralValue<'<codecId>', <stored value as a TypeScript literal>>` (`packages/2-sql/3-tooling/emitter/src/index.ts`, `generateTableLiteralType`). When a rule above changes a column's `default.value`, the second type argument of that column's `DefaultLiteralValue` must become the TypeScript string literal of the new value, written as the emitter writes a string literal. Example: `DefaultLiteralValue<'sqlite/integer@1', 0>` becomes `DefaultLiteralValue<'sqlite/integer@1', '0'>`.

## Data type ids for the SQLite codecs (design 9.2)

| Codec | Data type |
| --- | --- |
| `sqlite/text@1`, `sqlite/json@1`, `sqlite/datetime@1` | `sqlite/text` |
| `sqlite/integer@1`, `sqlite/bigint@1`, `sqlite/bigintnumber@1`, `sql/int@1` | `sqlite/integer` |
| `sqlite/real@1`, `sql/float@1` | `sqlite/real` |
| `sqlite/blob@1` | `sqlite/blob` |
| `sql/char@1` | `sqlite/character` |
| `sql/varchar@1` | `sqlite/character-varying` |

## In this repository

No committed SQLite contract or snapshot has a literal default on a JSON, datetime or integer column. The only SQLite literal defaults are on `sqlite/text@1` columns (`packages/3-targets/3-targets/sqlite/test/fixtures/sqlite-contract.json` and `test/e2e/framework/test/sqlite/fixtures/generated/contract.json`, both `"unnamed"`), which no rule changes.
