# where-unique — `whereUnique` on the SQL and Mongo ORM clients

## Purpose

Let an application developer state "this query addresses at most one record" and have the compiler hold them to it: the argument must name a full primary key or unique constraint, and the operations that only make sense for many records are not callable afterwards. Today `where({ id })` and `where({ published: true })` return the same type, so nothing distinguishes a single-record query from a many-record one.

## At a glance

`whereUnique` takes an object only (no callback). The accepted object shapes are built from the model's primary key and unique constraints, one shape per constraint.

```ts
const post = await db.orm.Post.whereUnique({ id: 1 }).first();
const membership = await db.orm.Membership.whereUnique({ tenantId, userId }).first();
const updated = await db.orm.Post.whereUnique({ slug: 'hello' }).where({ ownerId }).update({ title });
```

After `whereUnique`:

| Call | SQL | Mongo |
|---|---|---|
| `where`, `variant`, `include`, `select` | available | available |
| `first`, `update`, `delete` | available | available |
| `upsert` | unchanged (it is keyed by `conflictOn`, not by the filter) | available |
| `orderBy`, `limit`, `offset`, `cursor`, `distinct`, `distinctOn` | compile error | not on the returned type |
| `all`, `aggregate`, `groupBy`, and `all` / `aggregate` on `prepared` | compile error | not on the returned type (Mongo has no `groupBy` or `prepared`) |
| `updateAll`, `updateAndCount`, `deleteAll`, `deleteAndCount` | compile error | not on the returned type |

What the argument rejects:

| Argument | Why it is rejected |
|---|---|
| `{ published: true }` | not a unique constraint |
| `{ tenantId }` when the constraint is `(tenantId, userId)` | partial key |
| `{ email: null }` on a nullable unique column | many rows can have no value |
| a callback | object form only |

Inside an `include` refinement on a to-many relation, a uniquely filtered child yields one value, not an array (SQL only; Mongo's `include` takes no callback):

```ts
const users = await db.orm.User.include('posts', (posts) => posts.whereUnique({ id: 5 })).all();
```

Here `users[n].posts` is `Post | null`.

The snippets above are illustrative. Before a slice treats one as fact, it re-verifies it against the shipped code.

## Decisions

1. **`whereUnique` returns a single-record surface, not a plain filtered collection.** Returning the same type as `where` would constrain only the argument: `all()`, `limit()` and `orderBy()` would read exactly as before and the name would promise something the type does not hold. Rejected: input validation only; a state flag that changes nothing by itself.

2. **SQL keeps the same class and rejects the many-record methods at compile time.** Every SQL chain method returns `Self & <fact>` (`Filtered<Self> = Self & HasWhere`) so that a user's `class PostCollection extends Collection` keeps its own methods through the chain. An intersection can add members but cannot remove them. Rejected: a separate single-record type. It would drop every user-defined method after `whereUnique`, including harmless ones such as a `published()` filter, and would need `include`, `select` and every mutation terminal declared a second time.
   - Accepted consequence: the rejected methods still appear in autocomplete and fail when called.
   - Accepted consequence: a user-defined scope that calls a rejected method internally (`recent() { return this.orderBy(...).limit(10) }`) is still callable after `whereUnique`. TypeScript checks the method being called, not its body. Ordering and limiting a one-record result changes nothing at runtime.

3. **The rejection is encoded as a state key that must be absent.** `whereUnique` adds `uniqueFilter: true` to the type state. A many-record method intersects its `this` type with a requirement that the key is absent (`uniqueFilter?: never`); for a uniquely filtered collection that intersection reduces the state to `never`, and the call fails. The declared-but-unused `CollectionTypeState.hasUniqueFilter: boolean` is removed: the key must be absent from the base state.
   - **Verified on the real class (2026-10-08).** With the encoding applied to `CollectionBase`: the package type-checks, its 1113 tests and all type tests pass, and every package that depends on it type-checks, including the demo's declaration-emit test. `prisma7-adoption` was left out of that run: its typecheck fails before compiling, on a Prisma 7 engine download. The applied change and its type test are kept as [`spikes/rejection-encoding.patch`](./spikes/rejection-encoding.patch).
   - **Methods that return rows or a count** (`all`, `aggregate`, `updateAll`, `updateAndCount`, `deleteAll`, `deleteAndCount`) take `this: Self & <requirement>` on every overload. `all`'s second overload must be generic in `Self` too. A non-generic `this: <requirement>` rejects nothing, because an intersection is assignable when any one of its members is. A `this: this & <requirement>` overload breaks calls on a union of collections and on an `Omit` of a collection, which existing type tests cover.
   - **Methods that return the collection** (`orderBy`, `limit`, `offset`, `cursor`, `distinct`, `distinctOn`) need two overloads. The first keeps `this: Self` and constrains `Self` with a conditional that is `never` for a uniquely filtered collection; it serves every concrete receiver and keeps the collection's printed name. The second takes `this: Self & <requirement>` and serves calls on `this` inside a user class body, where the conditional cannot be resolved. With only the second form, an exported chain such as `plain.User.where(...).orderBy(...)` no longer prints as `Collection<...>` and fails declaration emit. With a non-generic `this` in the second form, a user class method loses its polymorphic return type.
   - **Exports.** `HasUniqueFilter` and `UniquelyFiltered` must be exported, or an exported uniquely filtered chain fails declaration emit.
   - **Rejected: a conditional `this` type alone** (`Self extends HasUniqueFilter ? never : unknown`). It breaks `this.orderBy(...)` and `this.all()` inside a user subclass body, because TypeScript cannot resolve a conditional over the polymorphic `this`.
   - **Accepted consequence:** a conditional that mixes a uniquely filtered collection with another one (`flag ? Post.whereUnique(...) : Post.published()`) is not rejected. Verified: `limit`, `all` and `deleteAll` compile on such a union.
   - **Compiler message.** Accepted as it is. It names the cause ("…reduced to 'never' because property 'uniqueFilter' has conflicting types") but is long.
   - **`groupBy` (decided 2026-10-08).** Rejected like `aggregate`.
   - **`prepared` (decided 2026-10-08, revised the same day).** `prepared.all` and `prepared.aggregate` are to be rejected after `whereUnique`, but not by removing members. A first attempt made the `PreparedCollection` type omit both members for a uniquely filtered collection. That gave `prepared` a different shape on the two kinds of collection, so a uniquely filtered collection stopped being assignable to the wide `Collection<..., unknown, CollectionTypeState>` type and a conditional mixing the two kinds rejected some many-record calls and not others. It was undone. The replacement applies the collection's own encoding to the prepared object: `PreparedCollection` carries the collection's type state as a phantom member, and its `all` and `aggregate` take `this: Self & <requirement>`. The member types then do not depend on the state, so assignability is unaffected. If that cannot be made to hold (a uniquely filtered collection must stay assignable to the wide type, and mixed conditionals must behave as the accepted consequence above says), `prepared` is left untouched and `whereUnique(...).prepared.all()` compiling becomes an accepted consequence like row locks.
   - **Accepted consequence: row locks (decided 2026-10-08).** `forUpdate`, `forNoKeyUpdate`, `forShare` and `forKeyShare` return a plain `Collection` for every receiver, dropping the type-state facts and the user subclass. `whereUnique(...).forUpdate().all()` therefore compiles. The lock methods are left as they are; the intended call after a lock is `first()`.
   - **Accepted consequence: model fragments.** `with(fragment)` for a fragment made by `collection.fragment` returns the fragment's own result type, so the type-state facts and the user subclass are dropped, as with row locks. `whereUnique(...).with(summary).all()` compiles. Treated the same way as row locks; `with` and `fragment` are left as they are. The callback form `with((posts) => posts.limit(1))` is rejected, because the callback receives the uniquely filtered type.
   - **Runtime refusal inside an include refinement.** A model fragment's body is typed against the plain collection, so `include('posts', (posts) => posts.with(Post.fragment((p) => p.whereUnique(...))))` type-checks even though `whereUnique` is removed from the refinement collection's type. Until the include slice ships, `whereUnique` throws when called on a refinement collection, so the array form cannot be reached by this route either.

4. **Mongo returns a smaller interface.** `MongoCollection` is an interface over a private `MongoCollectionImpl`, there are no user subclasses, and there is no type state; "requires `.where()`" is a runtime throw. A second interface over the same implementation is the cheapest way to get the single-record surface. Rejected: adding type state to Mongo, which means a new generic through every signature.

5. **Call order is not restricted on SQL.** `whereUnique` is callable after `orderBy`, `limit` or `offset`. `offset(1).whereUnique(...)` returns nothing; no second rejection rule is added for it.

6. **The argument admits only shapes that guarantee at most one record.**
   - `null` is never an accepted value, on either family. The SQL contract's unique constraint records only columns and a name, so there is no "nulls not distinct" option, and the shorthand filter turns `null` into `IS NULL`.
   - A Mongo index is admitted for a model only when it is `unique: true`, has no `partialFilterExpression`, and every key is a top-level scalar field of that model. A variant-scoped unique index is stored as a partial index and is therefore left out. An index on an embedded path cannot be expressed by a flat object.
   - `{ _id }` is always admitted on Mongo: `_id` is unique but is not listed among the indexes.
   - On a polymorphic SQL model the shapes come from the collection model's own table. Constraints declared on a variant's table are not offered.

7. **`UniqueConstraintCriterion` itself drops `null`.** It is exported and already used by `upsert`'s `conflictOn` and by relation `connect` and `disconnect` criteria, which share one criterion type; all three reject `null` after this change. A `null` value cannot identify one record for `connect` any more than for `whereUnique`, so the rule belongs in the one type. Rejected: a second, `whereUnique`-only type that differs in one detail. Cost: a compile error for a caller passing `null` in `conflictOn` or `connect`. What `connect` does at runtime today with a `null` criterion is not investigated, since the type no longer admits it.

8. **`where` stays available after `whereUnique`, and `first()` is the read terminal.** `whereUnique({ id }).where({ ownerId })` is still at most one record and is the way to write "this record, if it belongs to this user". No new terminal is added.

9. **Relationships.**
   - A unique constraint on a foreign-key column is offered under the scalar field name (`Profile.whereUnique({ userId })`). Relation names are never keys.
   - Relation filters (`posts.some(...)`) exist only in the callback form of `where`, so they are not accepted by `whereUnique`; they remain available through a following `.where(...)`.
   - Inside an `include` refinement on a to-many relation, a uniquely filtered refinement yields `Row | null`. Rejected: keeping the array (the method would promise one record and deliver an array); hiding `whereUnique` in refinements permanently.
   - On a to-one relation nothing changes: a refined to-one include is already `Row | null`.
   - A `combine()` branch that is uniquely filtered yields `Row | null`, like a direct refinement. How branch values are typed and shaped today has not been traced; the include slice does that as part of its work.
   - The refinement scalars (`count()`, `sum()`, …) are rejected after `whereUnique`, as `aggregate` is at top level.

10. **Names.**

    | Family | Name | What it is |
    |---|---|---|
    | SQL | `HasUniqueFilter` | the fact, following `HasWhere` |
    | SQL | `UniquelyFiltered<C>` | the alias, following `Filtered<C>`; implies `Filtered<C>` |
    | SQL | `UniqueConstraintCriterion` | argument type; existing name kept |
    | Mongo | `MongoUniquelyFilteredCollection` | the interface `whereUnique` returns |
    | Mongo | `MongoUniqueIndexCriterion` | argument type; "index" is Mongo's term for the source |

    Rejected: `MongoUniqueCollection`, which reads as "a collection that is unique".

## Non-goals

- A callback form of `whereUnique`.
- Accepting Mongo variant-scoped (partial) unique indexes, including after `.variant(...)`.
- Accepting Mongo unique indexes on embedded paths.
- Offering a variant table's unique constraints on a polymorphic SQL model.
- A new read terminal for unique queries, or a change to what `first()` returns.
- Changing how `where(...).update()` and `where(...).delete()` behave. They keep working on a plain filtered collection.
- Type state on the Mongo collection beyond the one new interface.
- Detecting a user-defined scope that applies many-record methods to a uniquely filtered collection.
- "Nulls not distinct" unique constraints in the SQL contract.

## Place in the larger world

- **SQL ORM client** (`packages/3-extensions/sql-orm-client`): `CollectionBase` in `src/collection.ts`; the type-state facts in `src/collection-types.ts`; `UniqueConstraintCriterion` in `src/types.ts`; the include refinement types in `src/collection-internal-types.ts`; include result shaping in `src/collection-dispatch.ts`.
- **Mongo ORM** (`packages/2-mongo-family/5-query-builders/orm`): the `MongoCollection` interface and `MongoCollectionImpl` in `src/collection.ts`; `MongoWhereFilter` in `src/types.ts`.
- **Contracts are read, not changed.** SQL: `primaryKey` and `uniques` on the storage table. Mongo: the `indexes` tuple on the storage collection, whose `unique`, `partialFilterExpression` and `keys` literals are already in the emitted `contract.d.ts`.
- **Custom collections.** The SQL design is shaped by the guarantee that a collection keeps its class through the chain (see the package README's custom collections section).

### Contract impact

None. No contract entity, kind or emitted shape changes; both families read literals the emitter already writes.

### Adapter impact

None. `whereUnique` compiles to the same filter expressions as the object form of `where`; no target adapter changes.

### ADR pointer

None. The project makes no architectural shift; the type-state encoding in decision 3 does not need an ADR.

## Cross-cutting requirements

- The rule in decision 6 holds on both families: no accepted argument can match more than one record.
- The split of available and unavailable methods in "At a glance" is the same on both families, apart from the stated difference in mechanism and `upsert`.
- Every rejected call and every rejected argument shape is covered by a negative type test, and every available call by a test asserting its result type.
- A collection that never calls `whereUnique` behaves and type-checks exactly as before, including inside user subclass bodies.
- Package READMEs for both clients describe `whereUnique` when their slice ships.

## Transitional-shape constraints

- `whereUnique` is not callable inside an `include` refinement callback until the slice that makes it yield `Row | null` ships. The array form never ships, so there is no later breaking change from array to single value.
- The SQL top-level slice ships before the Mongo slice; the Mongo slice does not depend on the include slice.
- The `null` exclusion on `UniqueConstraintCriterion` ships with the SQL top-level slice, together with its upgrade-coverage declaration.

## Project Definition of Done

- [ ] Team-DoD floor items (inherited; see [`drive/calibration/dod.md`](../../drive/calibration/dod.md)).
- [ ] On SQL and on Mongo, `whereUnique` accepts each primary key and each admitted unique constraint or index of a model, and rejects a non-unique field, a partial key, a `null` value and a callback, shown by type tests.
- [ ] On SQL, each many-record method listed in "At a glance" fails to compile after `whereUnique`, also after a following `where` or `include`; on Mongo, none of them is on the returned type.
- [ ] A user subclass with a scope that calls `orderBy`, `limit` and `all` on `this` compiles unchanged, and its own methods are callable after `whereUnique`.
- [ ] `first`, `update` and `delete` after `whereUnique` return the same row types as after `where`, with included relations, on both families; integration tests run them against a database.
- [ ] `conflictOn` and `connect` reject `null` for a nullable unique column.
- [ ] An `include` refinement that calls `whereUnique` on a to-many relation returns `Row | null` at the type level and at runtime, covered by an integration test.

## Open Questions

None.

## References

- Linear Project: not created yet.
- Sibling / dependent projects: none.
- ADRs: none.
- Design-discussion records: the decisions section above is the record of the 2026-10-07 design discussion.
- Spikes: [`spikes/rejection-encoding.patch`](./spikes/rejection-encoding.patch), the encoding of decision 3 applied to the real class with a type test. It is evidence, not the slice's implementation; apply it with `git apply`.
