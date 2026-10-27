# ADR 170 — Pack-provided type constructors and field presets

**Status:** Superseded in part by [ADR 275](ADR%20275%20-%20Client%20generators%20are%20field%20attributes%2C%20and%20a%20type%20alias%20is%20expanded%20into%20each%20column.md): the field-preset half. Prisma 8 removed field presets on 2026-10-22. The type constructor sections, names, namespaces and short names stand.

## What this looks like

> **Superseded 2026-10-22** by [ADR 275](ADR%20275%20-%20Client%20generators%20are%20field%20attributes%2C%20and%20a%20type%20alias%20is%20expanded%20into%20each%20column.md): field presets were removed. Each one is written as a type constructor or a contributed type alias plus `@id`, `@onCreate(...)` and `@onUpdate(...)`.

Today, the TS authoring surface can already express “id column with UUID generation” as a single helper call:

```ts
model('User', {
  fields: {
    id: field.generated(uuidv4()).id(),
  },
}).sql({ table: 'user' })
```

The current PSL surface expresses the same idea by spreading the meaning across the base type and attributes:

```prisma
model User {
  id String @id @default(uuid())
}
```

What we want after this work is for both surfaces to lead with the same idea: the author is choosing a named column shape, not manually stitching together a base type, a default, and constraints.

Illustrative TS shape after this work:

```ts
model('User', {
  fields: {
    id: field.id.uuidv4String(),
  },
}).sql({ table: 'user' })
```

Illustrative PSL shape after this work:

```prisma
model User {
  id Uuid()
}
```

Or, for a parameterized storage type:

```prisma
model User {
  name String(length: 35)
}
```

Extension-owned types would still use a namespace when needed, for example `pgvector.Vector(1536)`.

The point is not the exact final spelling of every helper. The point is that both TS and PSL should be able to express the same intent in the same place: the type position should carry the real meaning, and packs/targets should own the behavior behind it.

## Why we need this

The examples above show the core problem.

Right now, a column definition usually needs to say more than just “this is a string” or “this is bytes”.

Quite often we also need to say:

- what storage shape to use, including parameters like length
- what default behavior to apply
- whether this is really a common preset, like an id column
- and, sometimes, what constraints naturally come with that choice

Today, PSL handles a lot of this either by piling information into `@` attributes or by forcing pack-specific meaning into syntax that the type position does not own cleanly. That is how we end up with things like:

- `String` plus extra attributes to describe the real storage type
- extension-specific attribute forms that push storage meaning outside the type position
- `@default(uuid())` when what the author really means is something closer to “make this a UUID-backed id column”

TS authoring has the same problem. We solved part of it there with helper functions, but we put some of those helpers in a low layer in `@internal/ids`. That turned out to be the wrong place. It made concrete behavior feel “built in” even though it really belongs to targets, families, or packs.

So this ADR is about fixing that in a way that works for both authoring surfaces.

## What we are doing

We are introducing a shared way for families, targets, and extension packs to provide authoring helpers.

There are two kinds of helpers:

- **Type constructors**: these describe the storage type. They answer questions like “what codec/native type should this use?” and “does it have parameters like length?”
- **Field presets**: these do the same thing, but can also bundle extra behavior such as defaults, nullability, execution-time generation, and even constraints when that makes sense.

In plain terms:

- a type constructor is something like “a string with length 35”
- a field preset is something like “a UUID id column”

The important rule is that the framework core does **not** define the actual helpers. Core only defines the shape they must follow and the rules for combining them. The real helpers live in the family, target, or extension pack that owns the behavior.

That keeps the core thin and keeps the real behavior with the part of the system that actually knows what it means.

## How names work

Helpers use dot-separated names when they need a namespace.

Examples:

- `sql.String(length: 35)`
- `ids.Uuid(4)`
- `pgvector.Vector(1536)`

If two contributors try to register the same helper name, that is a hard error. We do not allow silent overrides or “last one wins” behavior.

That rule matters because we want the available vocabulary to be obvious and predictable. If there is a naming conflict, we fix it by adding or widening a namespace, not by relying on load order.

## What can a preset do?

> **Superseded 2026-10-22** by [ADR 275](ADR%20275%20-%20Client%20generators%20are%20field%20attributes%2C%20and%20a%20type%20alias%20is%20expanded%20into%20each%20column.md): field presets were removed. Each one is written as a type constructor or a contributed type alias plus `@id`, `@onCreate(...)` and `@onUpdate(...)`.

A field preset is allowed to imply constraints.

For example, an id preset can mean more than “use this storage type and this default”. It can also imply primary key behavior if that is part of the preset being offered.

That reflects how people actually think about these cases. They are not just choosing a storage type; they are choosing a well-known column shape with expected behavior.

## Who gets the short names?

We do not want to recreate a global “built-in standard library” by accident.

Because of that, only **family** and **target** contributors may register non-namespaced helper names. Extension packs should use namespaced names by default.

This gives us a small, deliberate baseline vocabulary while making extension-owned behavior explicit.

## How this fits TS and PSL together

> **Superseded 2026-10-22** by [ADR 275](ADR%20275%20-%20Client%20generators%20are%20field%20attributes%2C%20and%20a%20type%20alias%20is%20expanded%20into%20each%20column.md): field presets were removed. Each one is written as a type constructor or a contributed type alias plus `@id`, `@onCreate(...)` and `@onUpdate(...)`.

TS and PSL should not solve this problem in two completely different ways.

Both authoring surfaces should lower into the same underlying contract data:

- `ColumnTypeDescriptor` for storage shape
- `ExecutionMutationDefaultValue` for execution-time defaults

That means:

- TS column helpers can be thin wrappers around the same helper definitions
- PSL can read the same helper definitions and lower them without hardcoding special cases into the interpreter

This is the main reason to do this as a shared architecture decision instead of a one-off TS convenience feature.

## Consequences

### Good outcomes

- PSL becomes easier to read because more meaning can move into the type position instead of being spread across `@` attributes.
- TS and PSL can share one source of truth for these common authoring helpers.
- We stop pushing concrete behavior down into low layers where it does not belong.
- The available helper vocabulary stays deterministic because naming collisions fail fast.

### Costs

- We need to define and maintain the registry shape and assembly rules.
- Some existing syntax and examples may need to migrate over time.
- Contributors will need to think a bit more carefully about names and namespaces.

### Risks

- PSL could become more complicated if we try to make the syntax do too much at once.
  - Mitigation: keep the grammar simple and let the registries provide the meaning.
- We could accidentally reinvent “built-ins” under a different name.
  - Mitigation: reserve short names for family/target contributors, require namespaces for extensions by default, and fail hard on duplicates.

## Related ADRs

- ADR 005 — Thin Core Fat Targets
- ADR 006 — Dual Authoring Modes
- ADR 104 — PSL extension namespacing & syntax
- ADR 112 — Target Extension Packs
- ADR 158 — Execution mutation defaults
- ADR 169 — Declared applicability for mutation default generators (mutation defaults are one output that presets can configure; ADR 169 owns the default-specific registry and applicability model)
- ADR 171 — Parameterized native types in contracts (how contracts represent parameterized storage types)
