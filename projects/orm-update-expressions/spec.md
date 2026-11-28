# orm-update-expressions — expressions in SQL ORM updates

## Purpose

Let an application developer set a column from the row's current state (another column, an operation on a column, a counter increment) in one `UPDATE` statement through the ORM, with TypeScript rejecting a value the column cannot hold. Today an ORM update takes plain values only, so such a write needs a read followed by a write, which is not atomic, or a switch to the SQL query builder.

## At a glance

```prisma
model Post {
  id       Int     @id
  title    String
  subtitle String?
  slug     String
  views    Int
  popular  Boolean
  author   User    @relation(fields: [authorId], references: [id])
  authorId Int
}
```

```ts
const db = postgres({ contract, url }).orm.public;

await db.Post.where({ id }).update((p) => ({
  title: 'New title',          // plain value, as in the object form
  slug: p.title,               // value of another column
  views: p.views.add(1),       // numeric operation
  popular: p.views.gt(100),    // condition
}));

await db.Post.where({ id }).updateAll((p, { fns }) => ({
  views: fns.raw`${p.views} + 1`.returns('pg/int4@1'),
}));

await db.User.where({ id: userId }).update({
  posts: (posts) =>
    posts.where({ published: false }).updateAll((post) => ({ slug: post.title })),
});
```

What a value position rejects at compile time:

| Returned object | Why it is rejected |
|---|---|
| `{ views: p.title }` | different codec |
| `{ title: p.subtitle }` | nullable expression into a non-null column |
| `{ status: p.role }`, two different enums | different enum, although both use the same codec id |
| `{ popular: p.subtitle.like('Draft%') }` | nullable condition into a non-null column |
| `{ views: p.comments.count() }` | a relation's `count()` is an order, not a value |

The project delivers three capabilities:

1. **The callback form of update**, on `update`, `updateAll`, `updateAndCount` and the nested `update` / `updateAll` of a relation callback. It includes making the result of an operation on a field an expression that can be used as a value and chained.
2. **Numeric operations** (`add` and its siblings), defined once for the SQL family and available on every field whose codec has the `numeric` trait.
3. **Typed conditions.** A condition is an expression of the target's boolean codec with a known nullability, in the SQL query builder and the ORM, so it can be the value of a boolean column.

The snippets above are illustrative. Before a slice treats one as fact, it re-verifies it against the shipped code.

## Decisions

1. **The update functions gain a callback overload; the object form does not change.** The callback receives `(model, { fns, indexes })`, the same two arguments a `where` callback receives. The SQL query builder already has this form for `table.update(...)` ([`table-proxy.ts`](../../packages/2-sql-family/4-lanes/sql-builder/src/types/table-proxy.ts)), and the ORM's `UpdateAst.set` already holds expressions; only the ORM's input path turns every value into a bound parameter.

2. **The callback returns the same object the object form takes, with each scalar field widened to a plain value or an expression.** Relation callbacks stay allowed in top-level `update`. Rejected: expressions only, as in the SQL query builder's callback. It would force the user to wrap every literal as soon as one column is computed.

3. **`model` is the same accessor `where` receives on that collection.** One accessor type serves `where`, `orderBy` and `update`, so a helper typed against `ModelAccessor<Contract, 'Post'>` works in all three, and the implementation reuses the accessor the ORM already builds. Relation members are present. `count()` and a to-one relation's fields return an order, which fits no value position; `some`, `every` and `none` return a condition, which fits a boolean column (decision 17). Rejected: an accessor with scalar fields only, which adds a second type to prevent a mistake the types already prevent.

4. **A value position accepts an expression when three things match.**
   - The codec id is the column's.
   - A non-null column takes only an expression typed `nullable: false`.
   - The enum is the column's. This uses the type-only `input` member of `ScopeField`, which comparisons already use to tell enums apart.

   Type parameters (length, precision, vector dimension) are not checked; the database's assignment rules decide. Rejected: codec id only, as in the SQL query builder. Every enum shares `pg/enum@1`, so `status: p.role` would compile and fail in the database, and a nullable expression in a `NOT NULL` column would fail on the first row that is `NULL`.

5. **The result of a non-predicate operation on a field is an expression.** Today it is an object with comparison methods only: it has no `buildAst`, no `returnType` and no operations of its own, in the types ([`types.ts`](../../packages/3-extensions/sql-orm-client/src/types.ts), `QueryOperationMethod`) and at run time ([`model-accessor.ts`](../../packages/3-extensions/sql-orm-client/src/model-accessor.ts), `createExtensionMethodFactory`). After this project it has what a field of the operation's return codec has: the expression protocol, the comparison methods, and the operations registered for that codec. The change also reaches `where` and `orderBy`, because they receive the same accessor. A predicate operation returns a condition (decision 17), and the nullability of every operation's result follows decision 18.

6. **A value that reads a field stored in a variant's separate table is compiled as a subquery.** On a collection narrowed with `.variant(...)`, the accessor has the variant's own fields. When the variant keeps them in its own table, `UPDATE task SET title = feature.feature_name` is not valid SQL, so the value becomes a subquery on the variant's table matched to the updated row by primary key. The ORM already wraps a mutation's filter this way (`countMutationWhere` in [`mutation-statements.ts`](../../packages/3-extensions/sql-orm-client/src/mutation-statements.ts)). When the variant's fields are in the base model's table, the read needs no subquery.
   - Accepted consequence: a row with no matching variant row gets `NULL` from the subquery.
   - Accepted consequence: variant fields can be read in a value but still cannot be written through `update`, which takes the base model's fields only.
   - Rejected: refusing the read at run time; refusing it in the types (a second accessor type for one case); removing variant fields from the accessor in `update` (differs from `where` on every variant collection).

7. **The ORM sends the assignments as the callback returned them and leaves evaluation order to the database.** MySQL and MariaDB evaluate `SET` left to right, so `({ title: p.slug, slug: p.title })` swaps the two columns on Postgres and SQLite and writes the old `slug` to both on MySQL. Making databases behave alike is not the ORM's job. Rejected: refusing a read of a column the same update assigns on such databases; reordering the assignments.

8. **A nested `update` / `updateAll` callback receives the related model's accessor only.** The parent row's fields are not reachable inside it: setting a child column from a parent column needs an `UPDATE` that reads two tables, which the statement graph does not build. The existing rule that a nested update cannot set the column linking the row to its parent applies to both forms.

9. **Numeric operations are defined once for the SQL family, dispatched on the `numeric` trait, and delivered as their own slice.** No target registers an arithmetic operation today. Until that slice lands, the callback form is usable with column copies, existing operations whose return codec matches, and `fns.raw` with a declared return codec.

10. **A value passed in the object form is always bound as a parameter.** Only the object a callback returns is inspected for expressions, so data an application passes to `update({ ... })` cannot become part of the SQL text.

11. **The SQL family contributes the numeric operations itself; no target declares them.** They are defined once in the relational core, beside the built-in functions, with a template every SQL adapter renders by the same substitution. They reach a stack in three places:
    - `createExecutionContext` ([`sql-context.ts`](../../packages/2-sql-family/5-runtime/src/sql-context.ts)) registers them before the operations of the target, the adapter and the extensions.
    - The SQL emitter writes the family's operation type into `QueryOperationTypes` of every emitted `contract.d.ts`, and a contract authored in TypeScript reads the same type from the family pack.
    - Each SQL target package re-exports the family's operation type, so the import in an emitted `contract.d.ts` resolves from the target package.

    - Accepted consequence: the `contract.d.ts` of every SQL contract changes, about 350 files in this repo, and an application re-emits its contract to get the types.
    - Accepted consequence: a new SQL target gets the numeric operations at run time without declaring anything, and no target can leave them out or render them differently.
    - Accepted consequence: the registry refuses a second operation with a registered name (`CONTRACT.PACK_CONTRIBUTION_INVALID`), so a target or extension that registers an operation named like a family one fails when the execution context is created.
    - Rejected: each target's descriptor includes the operations in its `queryOperations` and `queryOperationTypes` slots. The MySQL and SQLite targets declare no operations today, and every future SQL target would have to repeat the declaration.

12. **An operation whose result depends on the field it is called on declares its method as a type function of that field.** The declaration is an interface whose `method` member reads `this['codecId']` and `this['nullable']`, the pattern `QueryOperationTypesFunction` uses for codec types:

    ```ts
    interface Add<CT> extends OperationMethod {
      readonly method: (
        other: CodecExpression<this['codecId'], boolean, CT>,
      ) => Expression<{ codecId: this['codecId']; nullable: this['nullable'] }>;
    }
    ```

    - `QueryOperationTypeEntry` ([`types.ts`](../../packages/2-sql-family/1-core/contract/src/types.ts)) gains one optional type-only member that holds it.
    - The ORM's field-method type applies it with the field's codec id and nullability when the member is present, and infers from `impl` as today otherwise, so no existing operation changes.
    - A helper type derives the generic `impl` behind `fns.add(self, other)` from the same declaration, so the signature is written once.

    Rejected: a generic `impl` that the ORM instantiates with the field's codec. TypeScript 5.9 substitutes each type parameter's constraint when a conditional type reads a generic function's arguments or return type, also when the first argument is fixed, so `p.views.add(1)` would be typed as any numeric codec. Rejected: numeric methods built into the ORM client beside the comparison methods, with `add` in `BuiltinFunctions`. Nothing would be registered, and a later operation that returns the codec of the field it is called on would have the same problem.

13. **The numeric operations are `add`, `subtract`, `multiply` and `divide`.** They are expressions, so they are also used in `where` and `orderBy`, where `increment` and `decrement` would read as instructions. The Mongo query builder's expression helpers have the same four names.
    - The argument is a plain value of the codec's input type or an expression of the same codec as the field. `p.price.multiply(p.qty)` with two different numeric codecs is rejected and written with `fns.raw`. Rejected: an expression of any numeric codec. The declared result codec would be wrong whenever the database widens the result, and accepting more later breaks no code while accepting less does.
    - Accepted consequence: `divide` is `/` on every database. On two integers Postgres and SQLite truncate, and MySQL computes a decimal that it rounds when it is stored in an integer column. The README documents this; the ORM does not correct it.

14. **The result of a numeric operation is nullable when the field or the argument is nullable**, as `a + b` is `NULL` in SQL when either side is. With decision 4, `views: p.views.add(p.bonus)` with a nullable `bonus` is a compile error on a non-null `views`; it is written with `fns.raw` and `coalesce`. A plain `null` is not accepted as the argument. Rejected: the result takes the field's nullability only, which compiles that call and fails in the database on the first row where `bonus` is `NULL`.
    - Accepted consequence: `divide` is typed like the other three. Division by zero is an error in Postgres; SQLite returns `NULL`, and MySQL returns `NULL` in a read. A `divide` of two non-null operands is typed non-null and can be `NULL` there. The README documents this. Rejected: typing every `divide` result as nullable, which rejects `ratio: p.ratio.divide(2)` on a non-null column.

15. **A condition is an expression of the target's boolean codec.** Its type names the codec that has the `boolean` trait in the contract's codec types (`pg/bool@1`, `mysql/boolean@1`, `sqlite/boolean@1`), and its run-time `returnType` names the same codec. Today [`functions.ts`](../../packages/2-sql-family/4-lanes/relational-core/src/functions.ts) declares every condition as `pg/bool@1` on every target, so on MySQL and SQLite a condition never matches a boolean column, and the SQL query builder's `where` and join `on` reject a boolean column there. The change is in the relational core and reaches the SQL query builder and the ORM. Rejected: leaving conditions out of value positions, with `fns.raw` as the way to set a boolean column from a comparison.

16. **The nullability of a condition follows its operands.**
    - A comparison (`eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `like`, `in`, `notIn`) is nullable when either side can be `NULL`.
    - `isNull`, `isNotNull`, a comparison with a literal `null` (compiled to `IS NULL`), `exists`, `notExists` and a relation's `some`, `every` and `none` are never nullable.
    - `and`, `or` and `not` are nullable when an operand is.

    With decision 4, `popular: p.views.gt(100)` fits a non-null boolean column and `popular: p.bonus.gt(100)` with a nullable `bonus` is a compile error.

17. **Everything in an ORM callback that produces a condition returns that typed expression.** Today a field comparison, a predicate operation on a field and a relation's `some`, `every` and `none` return a syntax-tree node (`AnyExpression`), and only `fns` returns an expression.
    - `where`, `fns.and` and `fns.or` already accept both kinds, so existing `where` callbacks compile.
    - The exported `and`, `or` and `not` ([`filters.ts`](../../packages/3-extensions/sql-orm-client/src/filters.ts)) return a typed condition when their operands are typed, taking the codec from the operands. With a node operand they return a node, as today. `all()` and a call with no operands keep returning a node; as a value, `all()` is written `true`.
    - A condition has the expression protocol and no methods of its own.
    - A relation condition is usable as a value: `hasPosts: u.posts.some()` compiles to `SET has_posts = EXISTS (…)`. MySQL refuses a subquery on the table being updated; that error comes from the database.
    - Accepted consequence: code that annotates such a result as `AnyExpression`, `AndExpr` or `OrExpr`, or calls a node method on it (`p.views.gt(1).not()`), stops compiling. The change ships with upgrade instructions.
    - Rejected: relation conditions left as nodes, which keeps two kinds of condition and forces `fns.and` with one to be typed nullable. Rejected: the exported helpers left as they are, with a new `fns.not`, which makes the same expression written two ways depending on where it is used.

18. **An operation called as a method on a nullable field has a nullable result.** Every registered operation declares one return type, and all of them declare it not nullable; the ORM puts the method on nullable fields too. The result of a method call is nullable when the field is nullable or the declared return type is. An operation that declares the type function of decision 12 states its own result, and that takes precedence. Rejected: redeclaring each operation with the type function, which touches the Postgres target, postgis, paradedb and pgvector and leaves an extension that is not updated with the wrong type.

### Assumptions

- Each SQL contract has exactly one codec with the `boolean` trait. With two, the type of a condition names both and fits neither column. No target or extension in this repo adds a second one.
- Each SQL adapter renders an expression, including a subquery on another table, on the right-hand side of `SET`.
- Nothing that compiles today stops compiling when operation results gain members.

## Non-goals

- **`upsert`.** In `ON CONFLICT DO UPDATE SET` a field refers to the existing row, and the proposed row has no accessor. A callback for `upsert` needs its own design.
- **The Mongo ORM client.**
- **Writing a variant's fields through `update`.**
- **Reading the parent row inside a nested update callback.**
- **Making `SET` evaluation order the same on every database.**
- **Checking type parameters** (length, precision, vector dimension) of an expression against the column.
- **Text operations** such as concatenation. Numeric operations are the only new operations.
- **Changing the object form**, its types or its behaviour.

## Place in the larger world

- **SQL ORM client** (`packages/3-extensions/sql-orm-client`): the collection's update terminals, the relation mutator, the model accessor and the statement graph. [ADR 164](../../docs/architecture%20docs/adrs/ADR%20164%20-%20Repository%20Layer.md) describes how an update runs on a database without `RETURNING`: keys are read first and rows are read back by key. An existing check in [`update.ts`](../../packages/3-extensions/sql-orm-client/src/statement-graph/update.ts) refuses a key column set by an expression there, with `ORM.CAPABILITY_MISSING`.
- **SQL query builder and relational core** (`packages/2-sql-family/4-lanes`): the `Expression` type, `fns`, and the existing callback form of `table.update(...)`. [ADR 270](../../docs/architecture%20docs/adrs/ADR%20270%20-%20ORM%20queries%20use%20the%20query%20builder's%20functions%20and%20a%20model's%20indexes.md) is the source of the `{ fns, indexes }` argument. Decisions 15 and 16 change the type of every condition the query builder's `fns` returns and the type its `where` and join `on` callbacks return.
- **Query operations.** [ADR 203](../../docs/architecture%20docs/adrs/ADR%20203%20-%20Trait-targeted%20operation%20arguments.md) and [ADR 206](../../docs/architecture%20docs/adrs/ADR%20206%20-%20Operations%20as%20TypeScript%20functions.md) define how an operation is authored and dispatched on a codec or a trait. ADR 203 says the ORM returns a comparison-methods object for a non-predicate operation; decision 5 changes that sentence.
- **Framework domain.** `packages/1-framework` does not change. The `numeric` trait already exists there, and the family's operations are registered and typed by SQL family code (decision 11).
- **Product direction.** No entry on the [steering list](../../docs/architecture%20docs/ADR-INDEX.md#steering-list) covers this. It belongs to the vision's Querying theme.
- **`projects/port-all-tests`** lists atomic number operations as inexpressible. This project makes them expressible; re-classifying those ports is that project's work.

### Contract impact

`contract.json` does not change and no contract hash moves. The `contract.d.ts` of every SQL contract gains the family's operation type in `QueryOperationTypes` (decision 11).

### Adapter impact

Adapters do not change. Each SQL target package re-exports the family's operation type (decision 11).

### ADR pointer

The project writes two ADRs at close-out: one for the callback form (decisions 1 to 8 and 10) and one for typed conditions (decisions 15 to 18). It amends ADR 203, ADR 206 and ADR 270 where they describe what an operation on an ORM field returns. The amendment to ADR 206 also records that the SQL family contributes operations (decision 11) and replaces its statement that a method on a column preserves authored generics with the type function of decision 12.

## Cross-cutting requirements

- No change under `packages/1-framework`, and no branch on the target.
- Every existing call of `update`, `updateAll`, `updateAndCount` and the nested forms compiles and behaves as before.
- A mismatch in a value position is a compile error with a negative type test that fails when the check is removed.
- The callback form is tested against Postgres, MySQL and SQLite, at the top level and nested.
- The ORM client's README describes the callback form, including that assignment order follows the database.
- The change of what a condition is (decision 17) ships with upgrade instructions in the same pull request.
- Typed conditions are type-tested against a Postgres, a MySQL and a SQLite contract, in the SQL query builder and the ORM.

## Transitional-shape constraints

- Each slice leaves `main` with a feature a user can use. The callback form without numeric operations is complete for column copies, existing operations and `fns.raw`.
- Operation results become expressions for `where`, `orderBy` and `update` in the same slice, so the accessor never differs between them.
- The producers of conditions (`fns`, field comparisons and the exported helpers, operations on fields, relation conditions) become typed in separate slices. Between those slices a callback can hold typed conditions and nodes together; `where`, `fns.and` and `fns.or` accept both kinds, so every such state of `main` is usable.
- The callback form does not wait for typed conditions. Without them, a boolean column is set from a plain value, a boolean field or `fns.raw`.

## Project Definition of Done

- [ ] Team-DoD floor items (inherited; see [`drive/calibration/dod.md`](../../drive/calibration/dod.md)).
- [ ] The three calls under "At a glance" run in integration tests on Postgres, MySQL and SQLite and each sends one `UPDATE` for the rows it changes.
- [ ] Type tests reject each row of the rejection table under "At a glance", and a nested callback that sets the parent link column.
- [ ] An update on a variant collection whose value reads a field in the variant's separate table runs on all three databases.
- [ ] An object-form update given an object with a `buildAst` method binds it as a parameter.
- [ ] On a MySQL and a SQLite contract, the SQL query builder's `where` accepts a boolean column and `fns.and` accepts one as an operand.
- [ ] An update that sets a boolean column from a relation condition (`u.posts.some()`) runs on Postgres, MySQL and SQLite.
- [ ] Upgrade instructions cover the change of what a field comparison, a relation condition and the exported `and`, `or` and `not` return.
- [ ] The rows for atomic number operations in [`scorecard/12-nested-writes-and-atomic-ops.md`](../../scorecard/12-nested-writes-and-atomic-ops.md) are updated.
- [ ] The ADRs for the callback form and for typed conditions are accepted, and ADR 203, ADR 206 and ADR 270 are amended.

## Open Questions

None. The five questions the first draft listed are settled as decisions 11 to 18.

## References

- Linear Project: not created yet.
- Sibling projects: [`projects/port-all-tests`](../port-all-tests/spec.md), [`projects/nested-mutations`](../nested-mutations).
- ADRs: [164](../../docs/architecture%20docs/adrs/ADR%20164%20-%20Repository%20Layer.md), [203](../../docs/architecture%20docs/adrs/ADR%20203%20-%20Trait-targeted%20operation%20arguments.md), [206](../../docs/architecture%20docs/adrs/ADR%20206%20-%20Operations%20as%20TypeScript%20functions.md), [270](../../docs/architecture%20docs/adrs/ADR%20270%20-%20ORM%20queries%20use%20the%20query%20builder's%20functions%20and%20a%20model's%20indexes.md).
- Design-discussion record: the Decisions section above, from the discussion of 2026-11-26.
