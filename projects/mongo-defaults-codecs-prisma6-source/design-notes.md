# Design notes — mongo-defaults-codecs-prisma6-source

## Principles

- Mongo support in Prisma 8 is recognizably the same as Postgres support. Reuse framework primitives; never invent a Mongo-only authoring form.
- No SQL vocabulary in the framework or in the Mongo family.
- A construct is either expressible or a hard error. No warnings.
- Decisions the SQL family already made are inherited, not reopened.

## The model

The contract carries an `execution` section listing, per field, a generator to run on create and on update. Authors reach it only through field presets (`temporal.*`), which the framework instantiates into `executionDefaults`. At runtime, components register generators by id; the runtime checks that every required generator is present, then the ORM's write path asks the execution context to fill missing values before building the insert or `$set` document. `timestampNow` returns `new Date()` with `'query'` stability, so one operation writes one timestamp across all rows it touches.

## Decisions settled in shaping (2026-09-24)

1. **Build the Mongo half first, hoist second.** Slices 1 and 2 give Mongo its own copy of the generator registry and apply loop with neutral names. Slice 3 moves that into `framework-components/src/execution/` and migrates SQL onto it. Rejected: hoisting first. The framework's current `ref` is `{ namespace, table, column }`, so hoisting first would either pull SQL vocabulary into the shared code or block Mongo on a SQL-wide rename.
2. **Neutral reference shape, renamed first.** The framework ref becomes `{ namespace, entry, field }` in its own slice before the Mongo execution work (decided 2026-09-24 after slice 3's first dispatch found that a Mongo-only `execution` type breaks every emitted `contract.d.ts` and the Mongo control interfaces that extend framework ones: 1,042 type errors). `entry` is the framework's own storage word (`namespaces[*].entries`); SQL puts table and column names in `entry` and `field`, Mongo puts collection and field names. Rejected: writing model and field names into `table` and `column` (the vocabulary leak the framework rules forbid); a Mongo-specific `execution` type plus an emitter hook (large churn that the hoist would undo); a generic ref type parameter on `Contract` (churn at every `Contract` use site).
3. **Codecs move to the target package.** Postgres keeps codecs in the target and the adapter registers them; Mongo had them in the adapter by mistake. The move happens in slice 1 before the new codecs are added, so all Mongo codecs land in one place.
4. **`mongo/json@1` is a new pass-through codec.** `mongo/document@1` is a type-level id for typed embedded documents and is not overloaded to mean "any BSON value".
5. **Same preset syntax as SQL, no precision.** `temporal.createdAt()`, `temporal.updatedAt()`, `temporal.timestamp(onCreate: now, onUpdate: now)`. Mongo dates have no precision, so the argument does not exist rather than being ignored.
6. **`execution` is optional and Mongo gains `executionHash`.** Absent means no generators; existing contracts hash unchanged. The emitter writes `executionHash` as its own artifact field, as for SQL.
7. **The Prisma 6 reader is the last slice of this project.** With slices 1 and 2 landed it is a thin reader over existing capability, and the earlier slice 2 spec is most of its spec.
8. **Remaining reader hard errors** (referential actions, `@@schema`, `view`, `@@id`, `@map` on composite fields) stay hard errors, with the expectation that each flips to a mapping when the Mongo family gains the capability. `@@schema` is expected to remain an error.
9. **Index names are not set by the reader.** Mongo verify and the planner match by key shape and options only.

10. **`Json` fields get an empty validator schema.** Found in slice 1 D3: the collection validator is closed, so omitting a field rejects writes. `{}` is the one schema that admits any BSON value. Canonicalisation keeps that empty object. The original assumption (omit the field) is recorded as falsified.

## Alternatives considered

- **Adding Prisma 6 attributes to Prisma 8 Mongo authoring.** Rejected outright. It diverges Mongo from Postgres and imports a frozen dialect into Prisma 8.
- **Keeping codecs in the adapter and adding the new ones there.** Rejected. It entrenches the layout mistake; the target package is where codec types are shared by control and runtime adapters (see `packages/3-targets/3-targets/postgres/src/exports/codec-types.ts` header).
- **Making `execution` required with a fixture re-emit.** Rejected. Churns roughly thirty fixtures for no behavioural gain.

## References

- `spec.md`, `plan.md`.
- `projects/prisma7-contract-source/design-notes.md` § "Unspellable shapes are hard errors" for the optional-field and default-plus-generator rules.
