# Slice 3 design: MongoDB's TypeScript builder takes its helpers from the contributed type constructors

## The problem

```ts
// SQL today: type.* is built from what the family, target and extension packs contribute
createdAt: field.column(type.DateTime({ as: 'temporal' })),
embedding: field.column(type.pgvector.Vector(1536)),
updatedAt: field.column(type.temporal.UpdatedAt()),

// MongoDB today: one hard-coded helper per explicit type, in the family package
createdAt: field.date(),                      // codec id 'mongo/date@1' written into the Mongo family
raw:       field.scalar('mongo/bson@1'),      // anything else by codec id
```

The Mongo family's builder names the Mongo target's codec ids (`contract-builder.ts:1095-1172`), so the family knows its target's types; an extension pack cannot add a helper; and type aliases (`temporal.UpdatedAt`) and type choices (`DateTime(as: temporal)`) have nowhere to go. ADR 275 records this as a gap: "a type-constructor surface for the Mongo builder is its own design".

## What is decided by existing records (no question)

- **Mongo's scalar type constructors move from the adapter to the target**, as ADR 241 (amended by ADR 275) requires: the target contributes the constructors that are TypeScript helpers. Today they are on the adapter (`mongo/2-adapter/src/exports/control.ts`), which the facade's contract builder does not even load.
- **The Mongo builder gets a `type` namespace built from the family, target and extension packs**, typed so a call is its explicit type, with type choices typed one overload per row, as SQL's is.
- **Value objects, enums and lists stay field helpers and builder methods**: `field.valueObject(name)`, `field.namedType(enum)`, `.many()`, `.optional()`, `.onCreate()`, `.mongo({ field })`.
- **`type.temporal.CreatedAt()` and `type.temporal.UpdatedAt()` work on Mongo**, as ADR 275 intended.
- **ADR 257's sentence that the TypeScript helper is `field.<token>()`** is corrected: the helper is `type.<Name>()`, on every target.
- **The rewrite is mechanical**: about 1,000 calls in tests, examples, docs and skills; an upgrade instruction rewrites `field.int32()` and the rest, with a script.

## Question 1: what does a Mongo field write instead of `field.column(...)`?

`column` is SQL's word, and Mongo has no columns. Options:

1. **`field.scalar(type.Int32())`** (recommended). Mongo's builder already has `field.scalar`, as "a scalar field of this codec"; it changes from taking a codec id to taking a type, and sits beside `field.valueObject` and `field.namedType`. ADR 257 asks for symmetry of rule, not of spelling: each family writes its own storage word.
2. **`field.of(type.Int32())` on both families.** One spelling everywhere, but every SQL contract (several thousand calls) changes too.
3. **`field.column(type.Int32())` on Mongo too.** One spelling, at the cost of a SQL word on a database that has none.

## Question 2: where does the helper-building code live?

The code that turns a pack's type constructors into typed `type.*` helpers (`createTypeHelpersFromNamespace` and the type-level machinery in `packages/2-sql-family/2-authoring/contract-ts/src/composed-authoring-helpers.ts`) is SQL-family code today, though it is family-neutral apart from the shape of what it returns (`codec-instance` with `typeParams: {}` for SQL, `{ kind: 'scalar', codecId, typeParams? }` for Mongo).

1. **Move it to `@internal/contract-authoring` (`packages/1-framework/2-authoring/contract`), with the returned shape as a parameter** (recommended). It is an affordance every family's TypeScript builder fills in, the same kind of thing as `composePackAuthoringNamespace`, which already lives there. This is a framework change and a SQL family change.
2. **Copy it into the Mongo family.** No framework change; two copies of the most intricate type-level code in the builders.

## Not in this slice

- Mongo's convenience types themselves (slice 4), which this slice makes writable in TypeScript.
- A `Vector(length?)` constructor for `mongo/vector@1`, which has none today: `field.vector()` becomes `type.Vector()` with the same params.
