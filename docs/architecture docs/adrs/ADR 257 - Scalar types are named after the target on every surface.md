# ADR 257 — Scalar types are named after the target on every surface

Status: **Accepted**

## Decision

A scalar type's name says what the database stores, in the database's own vocabulary. Each type has one token, written exactly as its codec id writes it (`objectId` keeps its inner capital), and the three surfaces a user writes derive from it: the codec id is `<target>/<token>@<version>`, the PSL name is the token with its first letter uppercased, and the TypeScript builder helper is `field.<token>()`. Where a codec id already carries a name, the codec id is the source of the token, and no codec id is renamed to fit a surface name.

Two types are named after an encoding rather than a single stored type: `Json`, the JSON-representable subset of the target's values, and, on MongoDB, `Bson`, any BSON value.

When two types store the same thing but give the application different values, the second token adds the application type as a suffix. `mongo/int64Number@1` (`Int64Number`, `field.int64Number()`) stores a BSON `long` and reads it as a `number` in the safe-integer range, next to `mongo/int64@1`, which reads the same `long` as a `bigint`. PostgreSQL's `pg/int8number@1` and SQLite's `sqlite/bigintnumber@1` follow the same rule. The suffix names the application type because it is the only difference: the stored type is already in the first half of the token.

## The decision in code

The MongoDB adapter's PSL scalar map names each type after the BSON type it stores, and points it at a codec whose id carries the same token:

```ts
// packages/3-mongo-target/2-mongo-adapter/src/exports/control.ts
export const mongoScalarAuthoringTypes = {
  Int32: {
    kind: 'typeConstructor',
    documentation: 'A signed 32-bit integer, stored as BSON int.',
    output: { codecId: MONGO_INT32_CODEC_ID, nativeType: 'int' },
  },
  // …
  Json: {
    kind: 'typeConstructor',
    documentation:
      'A JSON value, stored as BSON object, array, string, double, int, long, bool or null; the collection validator admits only those types at the top level, and the codec refuses anything else at any depth.',
    output: { codecId: MONGO_JSON_CODEC_ID, nativeType: 'json' },
  },
  Bson: {
    kind: 'typeConstructor',
    documentation:
      'Any BSON value, read as BsonValue; the collection validator does not constrain it.',
    output: { codecId: MONGO_BSON_CODEC_ID, nativeType: 'bson' },
  },
  Int: {
    kind: 'typeConstructor',
    documentation: 'Deprecated: use Int32. A signed 32-bit integer, stored as BSON int.',
    output: { codecId: MONGO_INT32_CODEC_ID, nativeType: 'int' },
    deprecated: { replacement: 'Int32' },
  },
  // …
};
```

`MONGO_INT32_CODEC_ID` is `mongo/int32@1`, so the PSL name `Int32`, the TypeScript helper `field.int32()` and the codec id all carry the token `int32`. The same holds for `bson`:

```ts
const contract = defineContract({}, ({ field, model }) => ({
  models: {
    Event: model('Event', {
      collection: 'events',
      fields: {
        _id: field.objectId(),
        payload: field.json(),
        raw: field.bson(),
      },
    }),
  },
}));
```

## Why

A name is the one piece of a type a user reads every time they write a schema, so it must not lie. `Int` meant a 4-byte integer on PostgreSQL, a 32-bit BSON `int` on MongoDB and a 64-bit `INTEGER` on SQLite; a user moving between targets, or reading a schema without knowing its target, could not tell which. Naming each type after what the target stores means no name is shared by types of different width, and a name is always correct for the target it is written against.

The target owns its codecs, so it owns their names. A codec id already names the stored type (`mongo/int32@1`, `pg/int8@1`, `sqlite/blob@1`), which makes it the natural source of the token: the PSL name and the TypeScript helper follow the codec id, never the reverse. A codec id is recorded in every emitted `contract.json`, feeds the storage and execution hashes, and appears in signed database markers and migration snapshots, so renaming one would re-hash every contract that uses it. Surface names can change freely; codec ids do not.

Symmetry across targets is symmetry of rule and grammar, not of spelling. Bare PascalCase scalar names, namespaced presets (`temporal.createdAt()`), the shared attribute set and `field.<token>()` are the same everywhere; the tokens are each target's own. A reader moving between targets uses one table that maps concepts across targets, not a shared spelling that hides the differences.

## `Json` and `Bson`

`Json` means a JSON value, no more. On MongoDB its codec `mongo/json@1` declares the JSON-representable BSON types (`object`, `array`, `string`, `double`, `int`, `long`, `bool`, `null`), so its collection validator lists them. Encode accepts exactly a plain JSON value and refuses anything else at any depth; decode accepts a stored value made only of those BSON types, with a `long` in the safe-integer range read as a `number`, and refuses the rest. Both name the value's path inside the field:

```text
mongo/json@1 wire value contains a non-JSON BSON date at events.0.at
```

`Bson` (`mongo/bson@1`) is any BSON value, the only MongoDB type whose validator does not constrain the field. Its application type `BsonValue` is structural (a `_bsontype` tag plus methods), because values come from the driver's own copy of the `bson` library. Its JSON form is canonical Extended JSON v2. The split is the same decision seen from both sides: a field typed `Json` holds what JSON can represent and is validated as such, and a field that must hold dates, identifiers or 64-bit integers inside it is typed `Bson`.

On PostgreSQL and SQLite, `Json` columns store JSON text, so what is stored is always JSON, but their codecs do not yet refuse a non-JSON value on write: they pass it to `JSON.stringify`, which stores a `Date` as text, drops `undefined` members and stores `null` for `NaN`. Moving MongoDB's plain-JSON check into the framework so that those codecs refuse such values too is planned and has not shipped; until it does, the rule that `Json` holds a JSON value is enforced on write on MongoDB only. No `Bson` counterpart exists on either target.

## Renaming a surface name

A renamed PSL name stays available as a deprecated alias of the new one for one release line, then is removed. The alias resolves to the same codec, so the contract does not change. A type constructor marks itself with `deprecated: { replacement }` on its `AuthoringTypeConstructorDescriptor`, and the PSL interpreter reports `PSL_DEPRECATED_SCALAR_NAME` at the type's span through the contract source's warning channel: a `ContractSourceDiagnostic` with `severity: 'warning'`, delivered to `ContractSourceContext.reportWarning`. `contract emit` prints it and still emits; the language server shows it as a warning and lists the deprecated names last in completion, struck through.

A codec id is never renamed under this decision. If one ever has to change, the reserved mechanism is: the codec registry registers the same codec under both ids, the emitter always writes the new id, the contract validator accepts both, `CodecTypes` carries both keys mapped to the same type, and an upgrade instruction tells users to re-emit and re-sign; after one release line the old id is removed with an error naming the new one.

## Consequences

- Every target follows the same rule and the same deprecation path for a renamed PSL name. The current per-target names and the cross-target concept table are listed in [Scalar types](../../reference/scalar-types.md); other docs link there instead of repeating them.
- Readers of Prisma 6 and Prisma 7 schemas map the old names to codec ids through their target bindings and are unaffected by PSL names.
- An extension that contributes a codec names its PSL type and TypeScript helper after the codec id's token, and declares every BSON type its codec stores in `targetTypes`; the MongoDB validator derivation reads the whole list.

## Alternatives considered

**Keep the Prisma 6 and Prisma 7 names on every target.** The spelling is symmetric and familiar, and nothing needs renaming. Rejected: the shared names are wrong about storage. The same `Int` is three different widths, and `DateTime` is a timezone-aware instant on one target and a text column on another, so the name cannot be trusted without knowing the target.

**Adopt MongoDB's query-language aliases (`int`, `long`, `decimal`, `binData`) and rename the codec ids to match.** Every surface would share one vocabulary with the database's own operators. Rejected: renaming codec ids changes every emitted contract and every hash derived from it, re-signs every database marker, and invalidates every migration snapshot, for no change in behaviour. Taking the token from the existing codec id gives the same honesty with none of that churn.
