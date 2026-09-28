# Design: scalar types are named after the target, on every surface

Settled with Will on 2026-09-25 (discussion on PR #30396). This document is exhaustive on purpose: an implementer follows it without making a design choice. Every claim about current code was checked on branch `mongo-generator-runtime-hoist` (all five slices).

## 1. The principle

1. **The target owns its codecs, so the target names its scalar types.** A PSL scalar name says what the database stores, in the database's own vocabulary. Prisma 6/7 names (`Int`, `Float`, `Boolean`, `DateTime`, `BigInt`, `Decimal`, `Bytes`) are dropped unless the target itself uses that name.
2. **One token per type on all three surfaces.** Each type has one lowercase token; the codec id is `<target>/<token>@<version>`, the PSL name is the token in PascalCase, and the TypeScript field helper is `field.<token>()` (camelCase where the token contains a digit boundary, see the tables). Where a codec id already carries a target name (every Postgres, SQLite and Mongo codec today), the codec id is the source of the token and does not change.
3. **Symmetry across targets is symmetry of rule and grammar, not of spelling.** Bare PascalCase scalar names, namespaced presets (`temporal.createdAt()`), the shared attribute set, and `field.<token>()` are the same on every target; the tokens are each target's. A single mapping table in the docs (§ 9) serves readers moving between targets.
4. **Names never lie about width or storage.** `Int` meant int4 on Postgres, int32 on Mongo, and a 64-bit INTEGER on SQLite. After this design no name is shared by types of different width.
5. **Two exceptions, both named after an encoding rather than a type:** `Json` (the JSON-representable subset of the target's values) and, on Mongo, `Bson` (any BSON value). § 5 and § 6 define both exactly.

## 2. What does not change

- **Codec ids.** No codec id changes on any target. Every existing `contract.json`, `storageHash`, `executionHash`, signed database marker, and migration snapshot is untouched. The deprecated-id aliasing mechanism in § 10 is specified but not needed by this design; it is kept in reserve.
- **TypeScript helpers on Mongo.** `field.string()`, `field.int32()`, `field.bool()`, `field.date()`, `field.objectId()`, `field.double()`, `field.int64()`, `field.decimal128()`, `field.binary()`, `field.json()` already follow the token rule and stay.
- **`field.column(<token>Column)` descriptors on Postgres and SQLite** already carry the token (`int8Column`, `byteaColumn`, `textColumn`, `blobColumn`, and so on) and stay.
- **Native-type constructors and presets that already use the target's token** (Postgres `Timestamp(p)`, `Timestamptz(p)`, `Time(p)`, `Timetz(p)`, `Uuid`, `Inet`, `Date`, `Char(n)`, the `*String` and `*JsDate` variants; the `temporal.*` presets on every target) stay.
- **Prisma 6 and Prisma 7 readers.** They map Prisma 6/7 names to codec ids through their bindings and are unaffected by PSL names; only the messages that name a Prisma 8 equivalent (if any) are updated to the new names.

## 3. Mongo

### 3.1 PSL names

| Token | Codec id (unchanged) | PSL name today | PSL name after | TS helper (unchanged) | Application type | `targetTypes` (validator `bsonType`) |
|---|---|---|---|---|---|---|
| `string` | `mongo/string@1` | `String` | `String` | `field.string()` | `string` | `['string']` |
| `int32` | `mongo/int32@1` | `Int` | `Int32` | `field.int32()` | `number` | `['int']` |
| `int64` | `mongo/int64@1` | `Int64` | `Int64` | `field.int64()` | `bigint` | `['long']` |
| `double` | `mongo/double@1` | `Float` | `Double` | `field.double()` | `number` | `['double']` |
| `decimal128` | `mongo/decimal128@1` | `Decimal128` | `Decimal128` | `field.decimal128()` | `string` (canonical decimal text) | `['decimal']` |
| `bool` | `mongo/bool@1` | `Boolean` | `Bool` | `field.bool()` | `boolean` | `['bool']` |
| `date` | `mongo/date@1` | `DateTime` | `Date` | `field.date()` | `Date` | `['date']` |
| `objectId` | `mongo/objectId@1` | `ObjectId` | `ObjectId` | `field.objectId()` | `string` | `['objectId']` |
| `binary` | `mongo/binary@1` | `Binary` | `Binary` | `field.binary()` | `Uint8Array` | `['binData']` |
| `json` | `mongo/json@1` | `Json` | `Json` (semantics tightened, § 5) | `field.json()` | `JsonValue` | `['object','array','string','double','int','long','bool','null']` |
| `bson` | `mongo/bson@1` (new) | (none) | `Bson` (new, § 6) | `field.bson()` (new) | `BsonValue` (new) | `[]` (validator `{}`) |
| `vector` | `mongo/vector@1` | (none) | (unchanged: none; out of scope) | `field.vector()` | `readonly number[]` | `['vector']` (unchanged) |

The PSL scalar map is `mongoScalarAuthoringTypes` in `packages/3-mongo-target/2-mongo-adapter/src/exports/control.ts`. Its keys change exactly as the table says; its `nativeType` values do not change (they are the validator `bsonType` names and are unrelated to PSL names). Documentation strings on each entry say "stored as BSON <bsonType>".

### 3.2 Removed names and their diagnostic

A Mongo PSL file that still uses `Int`, `Float`, `Boolean`, or `DateTime` reports `PSL_UNSUPPORTED_FIELD_TYPE` at the type's span with this exact message, where `<old>` and `<new>` are the names from the table:

```
Scalar type "<old>" was renamed to "<new>" (stored as BSON <bsonType>). Replace "<old>" with "<new>".
```

The message is produced by a fixed lookup table `{ Int: 'Int32', Float: 'Double', Boolean: 'Bool', DateTime: 'Date' }` in the Mongo PSL interpreter, consulted only when the bare name is not in the scalar map. No other name gets a rename hint. The language server surfaces the same message.

### 3.3 Everything that references a Mongo PSL name

Each of these changes in the same PR:

- `packages/3-mongo-target/2-mongo-adapter/src/exports/control.ts` (the map) and its tests (`test/control-descriptor.test.ts`, `test/scalar-documentation.test.ts`).
- Every `.prisma` file under `test/integration/test/mongo/**`, `test/integration/test/ports/prisma/functional/**` Mongo fixtures, `test/integration/test/authoring/side-by-side/mongo/`, `test/integration/test/value-objects/**` Mongo fixtures, `examples/mongo-demo`, `examples/retail-store`, `examples/mongo-blog-leaderboard`, `examples/bundle-size/src/mongo`, and any Mongo PSL literal in package tests (`packages/2-mongo-family/**/test/**`, `packages/3-mongo-target/**/test/**`, `packages/3-extensions/mongo/test/**`). Regenerated through `pnpm fixtures:check`; emitted `contract.json` files must be byte-identical before and after, which is the proof that no hash moved.
- The Prisma 6 reader binding (`packages/3-mongo-target/1-mongo-target/src/core/prisma6-binding.ts`) maps Prisma 6 names to codec ids and does not change; its diagnostics that suggest a Prisma 8 name (`UPDATED_AT_TYPE_UNSUPPORTED`, `NATIVE_TYPE_UNSUPPORTED`, `UNSUPPORTED_TYPE`) say the new names.
- Docs: `docs/reference/codec-authoring-guide.md` Mongo table, `docs/architecture docs/subsystems/10. MongoDB Family.md`, `skills/prisma-8/references/contract.md`, `packages/2-mongo-family/2-authoring/contract-ts/README.md`, `packages/3-extensions/mongo/README.md`, and the mapping table in § 9.
- The `app` upgrade fragment in § 8.

## 4. Postgres and SQLite (own project; specified here so nothing is lost)

### 4.1 Postgres PSL names

Source: `postgresScalarAuthoringTypes` and `postgresNativeAuthoringTypes` in `packages/3-targets/6-adapters/postgres/src/core/control-mutation-defaults.ts`.

| Token | Codec id (unchanged) | PSL name today | PSL name after | Note |
|---|---|---|---|---|
| `text` | `pg/text@1` | `String` | `Text` | |
| `bool` | `pg/bool@1` | `Boolean` | `Bool` | |
| `int4` | `pg/int4@1` | `Int` | `Int4` | |
| `int8` | `pg/int8@1` | `BigInt` | `Int8` | |
| `int2` | `pg/int2@1` | `SmallInt` | `Int2` | |
| `float8` | `pg/float8@1` | `Float` | `Float8` | |
| `float4` | `pg/float4@1` | `Real` | `Float4` | |
| `numeric` | `pg/numeric@1` | `Decimal` and `Numeric(p?, s?)` | `Numeric(p?, s?)` only | The two entries merge; `Decimal` is removed. |
| `timestamptz` | `pg/timestamptz-temporal@1` | `DateTime` and `Timestamptz(p?)` | `Timestamptz(p?)` only | Merge; `DateTime` removed. |
| `json` | `pg/json@1` | `Json` | `Json` | Unchanged; but see § 4.3. |
| `jsonb` | `pg/jsonb@1` | `Jsonb` | `Jsonb` | Unchanged. |
| `bytea` | `pg/bytea@1` | `Bytes` | `Bytea` | |
| `varchar` | `sql/varchar@1` | `VarChar(n?)` | `Varchar(n?)` | Capitalisation follows the token. |
| `char` | `sql/char@1` | `Char(n?)` | `Char(n?)` | Unchanged. |
| all others | | `Uuid`, `Inet`, `Date`, `DateString`, `Timestamp(p?)`, `Time(p?)`, `Timetz(p?)`, `TimestampString(p?)`, `TimestamptzJsDate(p?)`, `TimestamptzString(p?)`, `TimeString(p?)`, `BigIntNumber`, `UnboundedInt`, `pg.enum(...)`, `sql.String(n)` | unchanged | Already token-named (`BigIntNumber` and `UnboundedInt` are codec tokens `int8number` and `unboundedint`; they stay as they are). |

Removed names (`String`, `Boolean`, `Int`, `BigInt`, `SmallInt`, `Float`, `Real`, `Decimal`, `DateTime`, `Bytes`, `VarChar`) get the same fixed-table rename diagnostic as § 3.2, wording `Scalar type "<old>" was renamed to "<new>" (stored as <nativeType>). Replace "<old>" with "<new>".`

### 4.2 Postgres TypeScript presets

Source: `packages/3-targets/3-targets/postgres/src/core/authoring.ts` field presets. The token rule renames the preset keys; `field.column(...)` descriptors are unchanged.

| Preset today | Preset after | Codec id |
|---|---|---|
| `field.text()` | `field.text()` | `pg/text@1` |
| `field.boolean()` | `field.bool()` | `pg/bool@1` |
| `field.int()` | `field.int4()` | `pg/int4@1` |
| `field.bigint()` | `field.int8()` | `pg/int8@1` |
| `field.float()` | `field.float8()` | `pg/float8@1` |
| `field.decimal()` | `field.numeric()` | `pg/numeric@1` |
| `field.dateTime()` | `field.timestamptz()` | `pg/timestamptz-temporal@1` |
| `field.json()` | `field.jsonb()` | `pg/jsonb@1` (today `field.json()` produces jsonb, which contradicts PSL `Json` = `pg/json@1`) |
| (none) | `field.json()` | `pg/json@1` (new preset so PSL `Json` and TS `field.json()` agree) |
| `field.bytes()` | `field.bytea()` | `pg/bytea@1` |
| `field.uuidNative()`, `field.uuidString()`, `field.id.*`, `field.temporal.*` | unchanged | |

### 4.3 SQLite PSL names

Source: `sqliteScalarAuthoringTypes` in `packages/3-targets/6-adapters/sqlite/src/core/control-mutation-defaults.ts`. SQLite has no scalar TS presets (only `field.column(...)` and `temporal.*`); none are added.

| Token | Codec id | PSL name today | PSL name after | Note |
|---|---|---|---|---|
| `text` | `sqlite/text@1` | `String` | `Text` | |
| `integer` | `sqlite/integer@1` | `Int` | `Integer` | |
| `bigint` | `sqlite/bigint@1` | `BigInt` | `Bigint` | Token spelling; nativeType stays `integer`. |
| `real` | `sqlite/real@1` | `Float` | `Real` | |
| `decimal` | `sqlite/decimal@1` (new) | `Decimal` (today aliased to `sqlite/text@1`) | `Decimal` | A new codec: text storage, canonical decimal text application type with the same normalisation as `pg/numeric@1`, traits equality/order/numeric, so `Decimal` is no longer indistinguishable from `Text` in the contract. Existing contracts that used `Decimal` carry `sqlite/text@1` and keep it; new emits use the new codec. |
| `datetime` | `sqlite/datetime@1` | `DateTime` | `Datetime` | |
| `json` | `sqlite/json@1` | `Json` | `Json` | Unchanged. |
| `blob` | `sqlite/blob@1` | `Bytes` | `Blob` | |
| `bigintnumber` | `sqlite/bigintnumber@1` | `BigIntNumber` (type constructor) | unchanged | |

### 4.4 Scope of the Postgres/SQLite project

Everything in § 3.3 has a Postgres and SQLite counterpart, plus: the Prisma 7 reader's diagnostics that name Prisma 8 types; the contract printer (`prisma contract print`) prints the new names; the language server's completion list and hover text; every SQL fixture `.prisma` and example (`examples/prisma-8-demo`, `prisma-8-demo-sqlite`, `prisma-8-postgis-demo`, `supabase`, `react-router-demo`, `prisma-8-cloudflare-worker`, `prisma7-adoption`); `docs/reference/*`, the `prisma-8` skill references, package READMEs; `app` and `extension` upgrade fragments with the exact rewrite tables above. `contract.json` files stay byte-identical except where the new `sqlite/decimal@1` codec is adopted by a re-emit. This project runs before general availability.

## 5. `Json` on Mongo, exact semantics

`Json` means "a JSON value", no more. It replaces the slice 1 behaviour where a `Json` field's validator was `{}` and any BSON value passed through.

- **Application type:** `JsonValue` from `@internal/contract/types` (input and output).
- **`targetTypes`:** `['object', 'array', 'string', 'double', 'int', 'long', 'bool', 'null']`. The validator derivation (`packages/2-mongo-family/2-authoring/contract-psl/src/derive-json-schema.ts`) changes from "use `targetTypes[0]`" to "use the whole list": one entry gives `{ bsonType: '<entry>' }`, more than one gives `{ bsonType: [...entries] }`; for a list field the same applies to `items`; the nullable case prepends `'null'` unless already present. `'null'` is always in Json's list because JSON `null` is a JSON value; a required `Json` field must be present and may hold `null`.
- **Encode** (`mongo/json@1` `encode`): accepts exactly a `JsonValue`. Refuses with `RUNTIME.ENCODE_FAILED` (message `mongo/json@1 value must be a JSON value; received <describe>`) any `undefined`, `bigint`, `symbol`, function, `Date`, any object with a `_bsontype` property, non-finite numbers (`NaN`, `Infinity`, `-Infinity`), and any array or object containing such a value at any depth. Plain objects and arrays are walked recursively; key names are not restricted (MongoDB 5.0+ stores `$`- and `.`-containing keys).
- **Decode** (`mongo/json@1` `decode`): accepts the wire value if every value at any depth is a BSON `string`, `double`, `int`, `bool`, `null`, `object`, `array`, or a `long` whose value is a safe integer (returned as `number`). Anything else (`Date`, `ObjectId`, `Decimal128`, `Binary`, regex, timestamp, a `long` outside the safe range, `undefined`) throws `RUNTIME.DECODE_FAILED` with message `mongo/json@1 wire value contains a non-JSON BSON <type> at <path>` where `<path>` is the dotted path from the field root (`""` for the root).
- **JSON form** (`encodeJson`/`decodeJson`): identity, unchanged.
- **Traits:** none (unchanged). `renderValueLiteral`: none.
- **Tests required:** encode refusal for each listed rejected kind, nested; decode refusal for each listed BSON kind with the path; a `long` at `2^53 - 1` decodes, at `2^53` refuses; validator derivation for a required, a nullable, and a list `Json` field; end to end: a document written by the raw driver with a `Date` inside a `Json` field fails decode with the path in the message; the slice 1 `bson-scalars` and `temporal-presets` journeys still pass.

### 5.1 Decisions added during slice 6 (2026-09-27)

Points § 5 and § 6 left open, fixed during slice 6. Points 14 to 22 were added in the review round of the slice's pull request, where the implementation or the review found a case the earlier points did not decide.

1. **`<describe>` in the encode message** is the value's kind, chosen in this order: for an object carrying `_bsontype`, that tag (`ObjectId`, `Long`, `Decimal128`, `Binary`, `BSONRegExp`, `Timestamp`, `Int32`, `Double`); `Date`; `bigint`; `symbol`; `function`; `undefined`; for a non-finite number its literal (`NaN`, `Infinity`, `-Infinity`); for a sparse array hole `sparse array hole`; for any other object whose prototype is neither `Object.prototype`, `null`, nor `Array.prototype`, its constructor name (`Map`, `Set`, `RegExp`, `Uint8Array`, `Buffer`, or the class name). The encode message also carries the path: `mongo/json@1 value must be a JSON value; received <describe> at <path>`.
2. **`<type>` in the decode message** is the BSON `$type` alias, the same vocabulary the validators use: `date`, `objectId`, `decimal`, `binData`, `regex`, `timestamp`, `long` (for a `long` outside the safe-integer range), `double` (for a non-finite double), `undefined`, `symbol`, `javascript`, `minKey`, `maxKey`. The deprecated `dbPointer` type never reaches the codec under its own name: the `bson` library reads it as a `DBRef`, so it is handled by point 9 (for `Json`, its `ObjectId` member is refused as `objectId` at `<path>.$id`) and point 13.
3. **Non-finite doubles on decode are refused** with the path (`… non-JSON BSON double at <path>`), because `NaN` and `±Infinity` are not JSON values; encode refuses them for the same reason.
4. **Encode accepts exactly a plain JSON value.** Plain objects (prototype `Object.prototype` or `null`), arrays without holes, strings, finite numbers, booleans, `null`. Everything else is refused with its `<describe>` from point 1, at any depth.
5. **`Int32` and `Double` wrapper objects on decode** (present only when the driver runs with `promoteValues: false`) are unwrapped to `number`; a `Double` wrapping a non-finite value is refused per point 3.
6. **Path format** is dot notation with array indices as segments (`items.0.when`). At the root the message says `at the root` instead of an empty path.
7. **Detection glob for the extension fragment entry** is `**/*.{ts,mts,cts}`, because an extension author's repository does not have this repository's layout.
8. **Fragment directory** for this slice is `upgrade-instructions/pending/mongo-json-and-bson/` (the § 8 text below is amended accordingly); the earlier slice's fragment stays `mongo-target-owns-codecs`.
9. **`DBRef` on decode.** The `bson` library turns any subdocument with a string `$ref` and an `$id` into a `DBRef` instance. That is a plain BSON `object` following a naming convention, not the deprecated `dbPointer` type, so decode rebuilds the document it was stored as, `{ $ref, $id[, $db], ...fields }`, and decodes each member with its own path; an `ObjectId` in `$id` is then refused at `<path>.$id` as `objectId`.
10. **Objects the driver never produces** (`Map`, `Set`, class instances) are refused on decode with `RUNTIME.DECODE_FAILED` and named by their constructor in place of the `$type` alias, because dropping their contents would be silent data loss. Two driver-option cases are decided as well: a `Uint8Array` or `Buffer` (what the driver returns for binData with `promoteBuffers: true`) is refused as `binData`, and a JavaScript `bigint` (what it returns for a `long` with `useBigInt64: true`) is treated as a `long`: returned as a `number` in the safe-integer range and refused as `long` outside it.
11. **Enums over `Json`.** The enum entity factory reads `targetTypes[0]` as the member storage type; with the list it would resolve `@@type("mongo/json@1")` to `object`. An enum's codec must declare exactly one target type; the factory reports `enum "<name>" @@type codec "<id>" declares <n> BSON types; an enum needs exactly one` for zero or several, at the `@@type` argument, in the same form as the factory's other `enum "<name>" @@type …` diagnostics. The factory's "unknown codec" diagnostic also points at the `@@type` argument rather than the whole block. `Json` and `Bson` are therefore not enum codecs.
12. **`Bson` encode of values outside `BsonValue`.** Encode additionally accepts a native `RegExp` (the driver serialises it as BSON regex) and a `Uint8Array` or `Buffer` (serialised as binData subtype 0), returning them unchanged; `BsonValue`'s input side includes both. Everything else outside the union (`Map`, `Set`, other class instances, sparse array holes, typed arrays other than `Uint8Array`) is refused on encode with `RUNTIME.ENCODE_FAILED`, the § 5.1 `<describe>`, and the path, because the driver would either throw or serialise them as empty documents.
13. **`Bson` and the remaining BSON kinds.** `BsonScalar` widens to include `{ readonly _bsontype: 'Code'; readonly code: string; readonly scope?: { readonly [key: string]: BsonValue } | null }` (`null` because the driver's `Code` declares `scope` as possibly null), `{ readonly _bsontype: 'MinKey' }`, `{ readonly _bsontype: 'MaxKey' }`, and `{ readonly _bsontype: 'BSONSymbol'; valueOf(): string }`, so the union covers every value the driver can hand back except `DBRef` (a stored regex comes back as a native `RegExp`, which is in the union); encode accepts these four as well. `Bson` decode rebuilds a `DBRef` into its document form `{ $ref, $id[, $db], ...fields }` exactly as § 5.1 point 9 does for `Json`, so no `DBRef` instance ever reaches the application from either codec, including one inside a `Code` value's `scope`, which `Bson` decode walks and rebuilds as a new `Code`; the members keep their BSON types (an `ObjectId` in `$id` stays an `ObjectId`). `Bson` encode of a plain `{ $ref, $id }` document therefore round-trips to the same document. The excluded kinds are exactly `undefined`, `bigint`, `symbol`, functions, and `DBRef` instances, all named in the encode refusal list.

14. **A `_bsontype` key on a stored subdocument.** Another client can store a subdocument with a `_bsontype` key, and the `bson` library reads it as a plain object. Both decoders treat a value as a BSON class only when it is not a plain object, so such a subdocument decodes as the document it is. Encode (both codecs) still refuses any object with a `_bsontype`, because the driver refuses to write one it did not create.
15. **`Bson` encode checks the `bson` version.** The driver writes only values created by its own major version of `bson`, which it recognises by the `Symbol.for('@@mdb.bson.version')` marker. `Bson` encode reads the marker of every tagged value and refuses one whose marker differs from the target's `bson` major (the two majors are kept equal by a test) with `<tag> not created by bson <major>`, for example `MinKey not created by bson 7` for a literal `{ _bsontype: 'MinKey' }` or an `ObjectId` from another major version. A tag outside the § 6 list is refused as the tag, as before.
16. **Circular references.** Both encoders track the objects and arrays they are inside and refuse one that contains itself with `circular reference` at the path where it repeats. The same object at two places that do not contain each other is accepted.
17. **Refusal details.** The codecs put the path inside the value in `meta.valuePath`, not `meta.path`: the runtime's decode wrapper sets `path` to the field's own path in the document, which would overwrite it. On a read the runtime's envelope therefore carries `codecId`, `received`, `valuePath`, `collection` and `path`.
18. **Non-finite numbers on `Bson`.** BSON `double` stores `NaN` and `±Infinity`, `Bson` decode returns them, and canonical Extended JSON spells them, so `Bson` encode accepts them too; refusing them meant a document could not be written back as it was read. `Json` still refuses them in both directions (point 3).
19. **`Bson` JSON form and the types the driver writes.** Extended JSON and the driver disagree on two JavaScript values: EJSON writes an integer outside the int32 range as `$numberLong` and a `Uint8Array` or `Buffer` as a document of its bytes, while the driver writes `double` and `binData`. `encodeJson` therefore first replaces such an integer with a `Double` and bytes with a `Binary` (subtype 0), at any depth including a `Code` scope, then serialises. `decodeJson` returns the canonical deserialisation, with `Int32`, `Double`, `Long`, `Binary` and `BSONRegExp` wrappers; the round trip keeps the BSON bytes the driver would write for the original value, not the JavaScript classes.
20. **`Json` decode copies only around converted values.** A wire value that is already JSON is returned as the same object; only the objects and arrays that contain a converted value (an unwrapped `Int32` or `Double`, a `long` returned as a number, a rebuilt `DBRef`) are copied, as `Bson` decode already did.
21. **Numbers on `Bson` follow the driver.** With the driver's defaults (`promoteLongs`, `promoteValues`), a stored `long` in the safe-integer range and an integral `double` read back as a JavaScript `number`, and writing that `number` back stores `int` when it fits in 32 bits. `Bson` does not undo this; the scalar-types reference and the codec guide say so and tell users to wrap a value in `Long` or `Double` to keep its BSON type.
22. **Where the `BsonValue` types live.** § 6 names the Mongo family's value vocabulary, `@internal/mongo-value`, as the one declaration, so the TS builder does not keep a copy; see § 6.
## 6. `Bson` on Mongo, exact specification

A new scalar for "any BSON value", the only Mongo type whose validator does not constrain the value.

- **Token** `bson`; codec id `mongo/bson@1`; data type `mongo/bson`; PSL `Bson`; TS `field.bson()`; `CodecTypes['mongo/bson@1']` input `BsonInputValue`, output `BsonValue`.
- **`targetTypes`:** `[]`; the validator derivation gives `{}` (or `{ bsonType: 'array', items: {} }` for a list), exactly the mechanism slice 1 built for a known codec with no BSON type. The canonicalisation rule that keeps empty objects under `properties` and `items` stays.
- **Application type `BsonValue`**, declared once with `BsonScalar` and `BsonInputValue` in the Mongo family's value vocabulary, `packages/2-mongo-family/1-foundation/mongo-value/src/bson-value.ts` (exported from `@internal/mongo-value`). The target's `exports/codec-types.ts` re-exports the three types for users and uses them in `CodecTypes`; the Mongo TS builder's local codec map imports them from `@internal/mongo-value`, so authoring gets the same types without depending on the target. The types are structural because values come from the driver's own copy of `bson`:

```ts
export type BsonScalar =
  | string | number | boolean | null | Date | RegExp
  | { readonly _bsontype: 'ObjectId'; toHexString(): string }
  | { readonly _bsontype: 'Long'; toBigInt(): bigint }
  | { readonly _bsontype: 'Decimal128'; toString(): string }
  | { readonly _bsontype: 'Binary'; value(): Uint8Array; readonly sub_type: number }
  | { readonly _bsontype: 'BSONRegExp'; readonly pattern: string; readonly options: string }
  | { readonly _bsontype: 'Timestamp'; toBigInt(): bigint }
  | { readonly _bsontype: 'Int32'; valueOf(): number }
  | { readonly _bsontype: 'Double'; valueOf(): number }
  | { readonly _bsontype: 'Code'; readonly code: string; readonly scope?: { readonly [key: string]: BsonValue } | null }
  | { readonly _bsontype: 'MinKey' }
  | { readonly _bsontype: 'MaxKey' }
  | { readonly _bsontype: 'BSONSymbol'; valueOf(): string };
export type BsonValue = BsonScalar | ReadonlyArray<BsonValue> | { readonly [key: string]: BsonValue };
export type BsonInputValue = BsonScalar | Uint8Array | ReadonlyArray<BsonInputValue> | { readonly [key: string]: BsonInputValue };
```

  `undefined`, `bigint`, `symbol`, functions, and `DBRef` instances are not part of `BsonValue`. A stored regex reads back as a native `RegExp` (the driver deserialises with `bsonRegExp: false`), so `RegExp` is on the read side; `BSONRegExp` appears only when a driver is configured otherwise. `Uint8Array` is write-only (`Binary` is what reads back). `CodecTypes['mongo/bson@1']` is `{ input: BsonInputValue; output: BsonValue }`. `BsonInputValue` is written from `BsonScalar` rather than `BsonValue`; its own array and document members already admit every `BsonValue`, so both spellings admit the same values. `mongoBsonCodec` is typed the same way: `encode` takes a `BsonInputValue` and `decode` returns a `BsonValue`. `MongoCodec` takes the decode type as a fifth type parameter, `TOutput`, defaulting to the input type, and `mongoCodec` has a second overload that takes it explicitly, so every other codec and its type inference are unchanged.
- **Encode:** accepts any `BsonInputValue` and returns it unchanged; refuses with `RUNTIME.ENCODE_FAILED` (message `mongo/bson@1 value must be a BSON value; received <describe> at <path>`) `undefined`, `bigint`, `symbol`, function, `DBRef` instances, any object with a `_bsontype` not in the list above or not created by the driver's `bson` major (§ 5.1 point 15), a circular reference (§ 5.1 point 16), and any other non-plain object (`Map`, `Set`, class instances, typed arrays other than `Uint8Array`, sparse holes), at any depth (§ 5.1 points 12 and 13). Non-finite numbers are accepted (§ 5.1 point 18). A tagged value is checked for its tag and `bson` version only; encode does not look inside it, so a `Code` value's `scope` goes to the driver as the application built it.
- **Decode:** returns the wire value unchanged except that a `DBRef` at any depth, a `Code` scope included, is rebuilt into `{ $ref, $id[, $db], ...fields }` with member types kept (§ 5.1 point 13); refuses nothing. A `long` promoted to `number` by the driver is returned as that `number` (§ 5.1 point 21).
- **JSON form:** MongoDB Extended JSON v2, canonical mode: `encodeJson` is `EJSON.serialize(value, { relaxed: false })` and `decodeJson` is `EJSON.deserialize(json, { relaxed: false })`, both from the `bson` package the target already depends on, after `encodeJson` records each JavaScript number and `Uint8Array` as the BSON type the driver writes (§ 5.1 point 19). This is deterministic, and the round trip keeps the BSON bytes of every `BsonInputValue`.
- **Traits:** none. `renderValueLiteral`: none. `renderOutputType`: none.
- **Prisma 6 reader:** unchanged; Prisma 6 has no equivalent.
- **Tests required:** encode pass-through for each `BsonScalar` kind nested in objects and arrays; encode refusal for each rejected kind with the path; decode pass-through; EJSON round trip for every kind; validator `{}` for required, nullable (`{}` too, since `{}` admits null), and list; TS type test that `field.bson()` yields `BsonValue` on both the emitted and no-emit paths; end to end: write an `ObjectId`, a `Long` above `2^53`, a `Decimal128`, a `Binary` with subtype 4, and a nested document through the ORM into a `Bson` field, read back, assert `_bsontype` tags and values.
- **Docs:** the codec authoring guide's Mongo JSON-form table gains the row (the guide links the scalar-types page for everything else, per § 9); subsystem 10 explains `Json` versus `Bson` in one paragraph: `Json` is the JSON-representable subset and is validated as such; `Bson` is any BSON value and is not constrained by the validator.

## 7. `Json` on Postgres and SQLite

No value-level change. `pg/json@1`, `pg/jsonb@1`, and `sqlite/json@1` hold JSON only; `JsonValue` is exact. Their encode is `JSON.stringify`, so a non-JSON value is coerced (a `Date` becomes text, `undefined` members are dropped) where Mongo's `Json` refuses it; making the SQL `Json` codecs refuse as Mongo's does is recorded as a follow-on in the project plan, not done here. The only change is the Postgres TS preset split in § 4.2 so that PSL `Json` and TS `field.json()` both mean `pg/json@1`, and `field.jsonb()` means `pg/jsonb@1`.

## 8. Upgrade fragments

Per `skills-contrib/record-upgrade-instructions/SKILL.md`. The slice 1 renames ship in `upgrade-instructions/pending/mongo-target-owns-codecs/` (app change `mongo-psl-scalar-names`); the slice 6 changes ship in `upgrade-instructions/pending/mongo-json-and-bson/`.

- **App, change `mongo-psl-scalar-names`:** detection glob `**/*.prisma`, pattern matching a field line whose type is one of the removed names: `^\s*[A-Za-z_][A-Za-z0-9_]*\s+(Int|Float|Boolean|DateTime)(\[\])?\??(\s|$)`. Instruction: a table `Int → Int32`, `Float → Double`, `Boolean → Bool`, `DateTime → Date`, applied to Mongo schemas only (the pattern also matches Postgres and SQLite schemas; the instruction says to apply it only in a schema whose config uses `@prisma/orm-mongo`), then re-emit; `contract.json` does not change. A second change `mongo-json-field-semantics`: no detection pattern (a `Json` field is not identifiable as non-JSON by grep); instruction: a `Json` field now admits only JSON values; documents holding `Date`, `ObjectId`, `Decimal128`, `Binary`, or 64-bit integers inside a `Json` field fail to decode; switch such fields to `Bson`, then re-emit and run `db update` so the validator changes. The instruction also gives the query that finds documents whose field holds a non-JSON value at its top level: a BSON type outside the JSON types, a `long` outside the safe-integer range, or a non-finite `double` (nested values are found only by reading the documents), says that a project whose contract source is a Prisma 6 schema cannot declare `Bson` and either keeps the field JSON-only or moves the contract source to a Prisma 8 schema (intended behaviour, not a gap), and says that `db update` reports the validator change as destructive and asks for confirmation, while a project on migrations runs `migration plan` instead.
- **Extension, change `mongo-bson-codec-added`:** additive, `changes: []` is not enough because the validator derivation reads a `targetTypes` list now; entry describes that `targetTypes` may hold several BSON type names and that `targetTypes[0]` is no longer the only entry read. Detection: `targetTypes\s*:\s*\[\s*[^\]\s,][^\],]*,\s*[^\]\s]` in `**/*.{ts,mts,cts}` (an extension declaring more than one target type, which previously was ignored beyond the first). The pattern requires a second entry, quoted or a named constant, so a one-entry list written over several lines with a trailing comma does not match; a list referenced by name is not detected, and the instruction says so. The one change also describes `mongo/bson@1`, its `CodecTypes` entry (`BsonInputValue` on write, `BsonValue` on read), and the enum rule of § 5.1 point 11.

The Postgres/SQLite project ships its own fragments with the § 4 tables as rewrite instructions and the same field-line pattern per removed name.

## 9. Documentation mapping table

`docs/reference/scalar-types.md` (new) holds one table per target with columns PSL name, TS helper, codec id, storage type, application type, plus a cross-target table keyed by concept (32-bit integer, 64-bit integer, double, decimal, boolean, timestamp, text, bytes, JSON, any-value) so a reader who knows one target finds the other's name. The Prisma 6/7 names appear in that table as "Prisma 6/7 name" for migrating readers. Every other doc that lists scalars links here instead of repeating the list.

## 10. Deprecated codec ids (reserve mechanism, not used by this design)

If a codec id ever needs to change: the codec registry registers the same codec under both ids; the emitter always writes the new id; the validator accepts both; `CodecTypes` carries both keys mapped to the same type; a deprecation entry in the upgrade fragment tells users to re-emit and re-sign; after one release line the old id is removed with a hard error naming the new id. Not used now because no id changes.

## 11. Delivery

- **Mongo renames (§ 3) go into PR #30396** as an amendment to slice 1: the same scalar map and fixtures are already changing there.
- **`Json` tightening (§ 5) and `Bson` (§ 6)** are slice 6 of this project, `mongo-json-and-bson`, stacked on slice 4, since they build on slice 1's validator mechanism and slice 5's fixtures.
- **Postgres and SQLite (§ 4, § 7)** are a separate project, `target-named-scalars-sql`, with this document as its spec input.
- **`docs/reference/scalar-types.md` (§ 9)** is written in slice 6 for Mongo and extended by the SQL project.
