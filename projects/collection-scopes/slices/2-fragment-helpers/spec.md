# Slice 2: shared query fragments as scopes

**Project:** [spec](../../spec.md), [plan](../../plan.md). **Design:** ADR 259, "Query fragments are functions", and ADR 258 for the word "scope". **Ticket:** TML-3436. **Builds on:** slice 1 (prisma/orm#30560, branch `tml-3403-collection-keeps-its-class`). **Pull request:** prisma/orm#30564, branch `tml-3436-fragment-helpers`.

## At a glance

```ts
import { field } from '@prisma/orm-postgres/contract-builder';
import { orderByField } from '@prisma/orm-postgres/orm-client';

const { Post, Comment, Tag } = db.orm.public;

const notDeleted = db.orm.scope(
  { deletedAt: field.temporal.timestamptz().optional() },
  (rows) => rows.where((r) => r.deletedAt.isNull()),
);
const forTenant = (tenantId: string) =>
  db.orm.scope({ tenantId: field.uuidString() }, (rows) => rows.where((r) => r.tenantId.eq(tenantId)));
const summary = Post.scope((posts) => posts.select('id', 'title').include('user'));

Post.with(notDeleted).with(forTenant(ctx.tenantId)).with(summary).all();
Comment.with(notDeleted);
Tag.with(notDeleted);                        // error: Tag has no deletedAt
Post.select('id').with(summary);             // error: the rows no longer have every Post field
Post.orderBy(orderByField(Post, input.sort, input.direction, ['title', 'createdAt']));
```

## Chosen design

As ADR 259. In `packages/3-extensions/sql-orm-client` (module `src/scopes.ts`), exported from the client and re-exported by the Postgres facade:

- **`db.orm.scope(fields, body)`**, a method of the client `orm()` returns. Its type is `FieldScope`. `fields` maps each field name to a field builder from the contract DSL (`field.text()`, `field.temporal.timestamptz().optional()`, `field.uuidString()`, …) or to `{ codecId, nullable }` (`DeclaredField`). A list field is declared with `.many()` on the builder or `many: true` in the object. The codec must be one of the contract's codecs; a misspelled one is refused where it is declared.
  - The body receives a collection whose model accessor has only the declared fields, each a `CodecField` (for a list, a field whose value is a list of the codec's values). It may call `where`, `orderBy`, `limit` and `offset`, not `select` or `include`.
  - The scope reads the receiver's contract, model and namespace from the receiver's type and checks the declared fields against that one model. A field matches on its codec and nullability, and is a list exactly when the declaration says so. A union of collections is accepted when every model in it has the fields. A collection whose type has no namespace, such as a custom class, matches only fields that every model of that name has.
  - It returns the receiver's own type plus what the body established: `Filtered<Self>` after a `where`, `Ordered<Self>` after an `orderBy`.
  - A model that lacks a field, or has it with another codec or nullability, or as a list where one value is declared or the reverse, is refused with an error that names the field. When the model cannot be read from the receiver's type, as for `scope.call(undefined, collection)` or a `Collection<Contract, string>`, the error says so.
  - At run time the scope checks that it was given a collection, checks the fields before the body runs (`ORM.FIELD_UNKNOWN`), and checks that the body returned a collection of the receiver's model, namespace and class (`ORM.ARGUMENT_INVALID`).
  - A contract with a namespace named `scope` keeps the namespace under that name, and the client then has no `scope` method.
- **`db.orm.public.Post.scope(body)`**, a method of every collection. The body is typed once against the plain collection of the receiver's model and namespace. The scope accepts any collection of that model whose row is the full row or wider (root, filtered, after `include`, an include refinement, `this` in a class) and refuses one narrowed by `select` or `variant`. Its result is always the body's result on the plain collection, even when the body keeps the row. The model comes from the receiver, so there are no type arguments. At run time the scope refuses a collection of another model or namespace with `ORM.ARGUMENT_INVALID`.
- **`orderByField(collection, name, direction, allowed)`**. `direction` is `string | undefined`, `undefined` meaning `asc`. `allowed` is required and typed as a non-empty list of the model's orderable fields (`OrderableFieldNames`). The name and the direction are checked at run time before any query is built.
- **`CodecField<TContract, CodecId, Nullable>`**, the model accessor's type for any field with that codec and nullability.
- **Writes refuse a limit or an offset they would ignore.** `updateAll`, `updateAndCount`, `deleteAll` and `deleteAndCount` throw `ORM.ARGUMENT_INVALID` on a collection with a limit or an offset, since a scope can add them unseen. `update` and `delete` change the row `first()` returns, so they honour the order and the offset; `update` with a relation callback finds its row by the filter alone and throws on an order, a limit or an offset.

The builder's side is `ScalarFieldDeclarationBuilder` in `@internal/framework-components/codec`, which the DSL's field builders implement and the client reads, so the client does not depend on the DSL. The facade's `contract-builder` entry exports a composed `field` with the Postgres presets.

## Coherence rationale

One idea: a scope is a function, and these are the three ways to make one that TypeScript cannot type on its own. One reviewer holds it in one sitting.

## Scope

In: the two `scope` methods, `orderByField`, `CodecField`, their exports, the write refusals, tests, the package README and `skills/prisma-8/references/queries-postgres.md`, the demo using each, ADR 259 set to match the code and to Accepted with its cost tables for the demo and for a 200-model contract, and two upgrade entries (`query-fragment-helpers`, app and extension).

Out: `with` and the `Scope` type (slice 1); a default scope per model; selecting or including by shape across models; collection scopes from indexes (slice 4); the registered class inside an include refinement (TML-3426).

## Pre-investigated edge cases

- A model may carry the declared field under a different column name (`@map`); the check is on the field, not the column.
- Declared fields must not be matched against relations or variant-only fields, and a declaration of one value must not match a list field.
- Tests use emitted fixtures or a user-facing authoring surface, never patched generated files (`.agents/rules/no-contract-data-patching-in-tests.mdc`). The emitted soft-delete fixture has `deletedAt` on two models and none on a third, and a `String[]` field on the third.

## Slice-specific done conditions

- Type tests for `db.orm.scope`: accepted on two models that have the fields and refused on one that lacks them, on another codec, on another nullability, and on a list where one value is declared or the reverse; the body cannot name an undeclared field or call `select` or `include`; the result records the body's filter and order; works at every site listed above.
- Type tests for `Post.scope`: every site accepted, `select`- and `variant`-narrowed collections refused, a wrong model refused.
- Run-time tests show the plan contains the scope's filter and order, the `ORM.FIELD_UNKNOWN` refusal, the receiver and result checks, and the write refusals.
- `examples/prisma-8-demo` uses all three, with its typecheck through `dist`, its tests and the declaration-emit test passing.
- Demo type instantiations do not rise by more than 0.2% with the helpers unused, and the costs of `db.orm.scope` are in ADR 259.
