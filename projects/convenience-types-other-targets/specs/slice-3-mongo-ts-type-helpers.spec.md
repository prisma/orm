# Slice 3: MongoDB's TypeScript builder takes its helpers from the contributed type constructors

Project spec: [../spec.md](../spec.md). Branch: `tml-3714-mongo-type-helpers`, from `main` (it touches nothing slices 1 and 2 touch).

## Outcome

```ts
// before
export const contract = defineContract({ family, target }, ({ field, gen, model }) => ({
  models: {
    Order: model('Order', {
      fields: {
        _id: field.objectId(),
        total: field.int32(),
        raw: field.scalar('mongo/bson@1'),
        updatedAt: field.date().onCreate(gen.now()).onUpdate(gen.now()),
      },
    }),
  },
}));

// after
export const contract = defineContract({ family, target }, ({ field, model, type }) => ({
  models: {
    Order: model('Order', {
      fields: {
        _id: field.scalar(type.ObjectId()),
        total: field.scalar(type.Int32()),
        raw: field.scalar(type.Bson()),
        updatedAt: field.scalar(type.temporal.UpdatedAt()),
      },
    }),
  },
}));
```

Each emits the same `contract.json`.

## Decisions

- **The MongoDB target contributes its scalar type constructors** (`String`, `Int32`, `Bool`, `Date`, `ObjectId`, `Double`, `Int64`, `Int64Number`, `Decimal128`, `Binary`, `Json`, `Bson`, and the deprecated `Int`, `Float`, `Boolean`, `DateTime`), moved from the adapter's `mongoScalarAuthoringTypes` to the target, as ADR 241 requires of a target whose constructors are TypeScript helpers. PSL sees the same names.
- **The builder gets a `type` namespace** built from the family, target and extension packs' `type` contributions, typed so a call is its explicit type, a type choice is typed one overload per row, and a type alias carries its generators, as the SQL builder's is.
- **A field is `field.scalar(type.X())`.** `field.scalar` takes a type instead of a codec id. `column` is SQL's word; MongoDB has no columns.
- **The code that builds the typed helpers is the MongoDB family's own,** in `packages/2-mongo-family/2-authoring/contract-ts`, written for MongoDB's field type `{ kind: 'scalar', codecId, typeParams? }`. It uses the framework's existing authoring types and functions (`@internal/framework-components/authoring`, `@internal/contract-authoring`) and changes neither. The framework does not hold helpers two families share only for reuse (`.agents/rules/never-change-the-framework-domain.mdc`).
- **Removed:** `field.objectId()`, `field.string()`, `field.double()`, `field.int32()`, `field.bool()`, `field.date()`, `field.int64()`, `field.int64Number()`, `field.decimal128()`, `field.binary()`, `field.json()`, `field.bson()`, `field.vector()` and `field.scalar(codecId)`. No deprecated aliases: an upgrade instruction rewrites them with a script.
- **Stays:** `field.valueObject(name)`, `field.namedType(enum)`, `.optional()`, `.many()`, `.onCreate()`, `.onUpdate()`, `.mongo({ field })`.
- **`mongo/vector@1` gets a type constructor,** `Vector(length?)`, with the params `field.vector()` took, in PSL and TypeScript. MongoDB PSL now reads a type call's arguments, which it dropped before, so `Vector(3)` keeps its length.
- **Deprecated PSL names stay PSL-only:** `Int`, `Float`, `Boolean` and `DateTime` get no `type.*` helper.
- **A field with no type params** emits no `typeParams`, as today, so contracts and hashes do not change.
- **The facade's contract builder** passes the packs that carry the constructors, so `type.*` sees them.

## Tests

- Builder tests: every scalar through `field.scalar(type.X())` emits what the removed helper emitted; a type choice is typed per row and a combination with no row does not compile; `type.temporal.CreatedAt()` and `UpdatedAt()` carry their generators; an extension pack's constructor appears under its namespace; a name collision with a built-in helper key is refused.
- The contract-parity fixtures (`test/integration/test/contract-parity/fixtures/mongo`) and `authoring/mongo-parity` emit unchanged contracts from the rewritten TypeScript.
- The upgrade script rewrites a fixture with every removed helper and its result emits the same contract.
- Every `field.<helper>()` call in tests, examples, the CLI init template, docs and skills is rewritten.

## Docs

ADR 257's sentence on `field.<token>()`, ADR 241's note on the MongoDB adapter, ADR 275's note that the MongoDB builder has no `type.*`, the MongoDB family subsystem doc, `docs/reference/scalar-types.md`'s MongoDB section, the `prisma-8` skill, and an upgrade-instructions fragment with the rewrite script.
