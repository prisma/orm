# ADR 250 — Models and views are emitted from the contract

Status: **Accepted**

Related: [ADR 223 — Target-owned default namespace](ADR%20223%20-%20Target-owned%20default%20namespace.md) establishes the `__unbound__` namespace id that this ADR keeps explicit in emitted type names. [ADR 242 — Public npm surface](ADR%20242%20-%20Public%20npm%20surface%20-%20single%20@prisma%20scope%20with%20consolidated%20publish%20packages.md) names the facade entrypoints the examples import from.

## At a glance

A user names a model, the row a default fetch returns, an application data structure derived from a model, and the result of any ORM query with types the contract emits or the family exports. None of them needs a query or a client in scope except `ResultType`, which needs only the query.

```ts
import type { models, Models } from './prisma/contract';
import type { Scalars, Shape } from '@prisma/orm-postgres/family-contract/types';
import type { ResultType } from '@prisma/orm-postgres/components/runtime';

type User = typeof models.public.User;          // the model: every field and relation
type AlsoUser = Models.public_User;             // same type, importable name
type UserRow = Scalars<User>;                   // what db.orm.public.User.first() returns
type UserWithPosts = Shape<User, { '+': 'posts' }>; // Scalars<User> & { posts: Scalars<Post>[] }

type UserResponse = Shape<User, {               // an endpoint's response, derived from the model
  '-': 'passwordHash';
  posts: { '+': 'id' | 'title' | 'comments' };
}>;

export const usersWithPosts = db.orm.public.User.include('posts');
export type SameThing = ResultType<typeof usersWithPosts>;   // equals UserWithPosts
```

## Context

Two Prisma 7 users raised the same gap. One wrote that Prisma 7 let them get "a lot of types of the available APIs from the Prisma namespace", that a single line like `export type Book = Prisma.BookGetPayload<{ include: { author: true } }>` told everyone consuming `Book` that the author is always there, and that "you can of course manually write the types yourself, but Prisma 7 made it so easy it's now confusing why the type safety feature is no longer there." The other asked: "is it normal that the models are only exposed through the `FieldOutputTypes` type in `contract.d.ts`? Can't we have a simple `export type MyModel`?"

Both are right about the facts. `contract.d.ts` exports hashes, codec maps, `FieldOutputTypes`, `FieldInputTypes`, `TypeMaps`, and `Contract`, and none of those is a model type. Naming a query result without one means writing `NonNullable<Awaited<ReturnType<typeof query.first>>>` by hand, and `ResultType`, which the SQL and Mongo query lanes support, returns `never` on an ORM collection that does not carry the marker it reads.

## Decision

**1. A model is the whole row plus its relations. A query result is a view on it.** The model is what the author wrote in PSL: every field and every relation. Selection belongs to the query, not to the model. The contract defines models; the client defines views. Two consequences follow, and both are deliberate:

- The model type carries every relation, always. `User.posts` is `Post[]`, `Post.author` is `User`, and so on around the cycle.
- A query result is therefore not a model. The default fetch returns the model's scalar fields, because returning the model would mean loading the whole reachable graph. Partial fetches return whatever was selected.

**2. The contract emits a `Models` namespace and a `models` declared constant.** After `FieldInputTypes` (and any family storage-type exports) and immediately before `TypeMaps`, `contract.d.ts` gains one block, rendered by the framework emitter for both families:

```ts
export namespace Models {
  export type public_User = {
    id: CodecTypes['pg/int4@1']['output'];
    name: CodecTypes['pg/text@1']['output'];
    posts: public_Post[];
    profile: public_Profile | null;
    readonly [RelationKeys]?: 'posts' | 'profile';
  };
  // one member per model, then per polymorphic base one union member
  export type public_AnyTask = public_Bug | public_Feature | public_Epic;
}

export declare const models: {
  public: {
    User: Models.public_User;
    Task: Models.public_Task;
    Bug: Models.public_Bug;
    AnyTask: Models.public_AnyTask;
  };
  __unbound__: {
    Audit: Models.unbound_Audit;
  };
};
```

Every model has two spellings of one type: `Models.public_User`, an importable name, and `typeof models.public.User`, dotted access with the schema as a property. The recursion between models goes through the namespace members, which is why they are named. `models` is a declared constant with no runtime; users import it with `import type`, so nothing is looked up at runtime. A TypeScript namespace cannot carry the schema as a nested namespace because `public` is a reserved word in strict mode, so the schema is folded into the member name instead.

Field lines use the same resolver as `FieldOutputTypes` (`resolveFieldType` with the same codec lookup, type-parameter resolver, and value-set resolver), without `readonly`, in declaration order. Relation lines follow the fields, in declaration order, typed as the related model's member. `'1:N'` and `'N:M'` give `X[]`; `'1:1'` and `'N:1'` give `X | null` when the relation's `nullable` flag in the contract is true and `X` otherwise (see decision 9). A relation whose target model is not in this contract is omitted from the member and from the phantom.

**3. The namespace is present in the name on every target that has namespaces.** The member name is `<nsSegment>_<ModelName>`, where `nsSegment` is the namespace id verbatim except that `__unbound__` becomes `unbound`. On Postgres and Mongo, models in the unbound namespace (declared without a schema) are `Models.unbound_Audit` and `typeof models.__unbound__.Audit`, never a bare `Audit`. This is the existing convention: `db.enums.__unbound__.X` and the contract views keep the namespace explicit and never promote one to the root, because a Postgres contract can hold `__unbound__` and `public` models side by side and a bare name would collide with a prefixed one. On a target whose descriptor declares `supportsNamespaces: false` (SQLite today) there is only ever one namespace, so the segment is noise: the member is `Models.Audit` and the constant nests models directly under the root, `typeof models.Audit`. The emitter reads the declaration from `GenerateContractTypesOptions.supportsNamespaces`, threaded from the target descriptor at the CLI call site; it never switches on the target id and never counts the namespaces in a contract. Every emitted name is therefore a pure function of the target declaration, namespace, and model, so nothing a user adds later renames or removes an existing type. If two emitted member names are equal (a separator collision such as schema `public_User` with model `X` against schema `public` with model `User_X`, or a model literally named `AnyTask` beside a base `Task`), the emitter throws its existing structured validation error naming both sources and emits nothing.

**4. `FieldOutputTypes`, `FieldInputTypes`, and `TypeMaps` are untouched.** They serve `TypeMaps` and the lanes, and the lanes' row derivations are built on them. `Models` and `models` are new exports beside them. The ORM's row derivations are also unchanged; equality between the emitted model types and the ORM's rows is enforced by type tests, not by redefinition, because threading the emitted map through `TypeMaps` would change `TypeMaps`.

**5. Polymorphic models emit three shapes.** The base member has the base's own fields and relations, with the discriminator field typed as the union of the variants' literal values. Each variant member has base fields, then variant fields, then base relations, then variant relations, with the discriminator narrowed to its literal. One extra member `<ns>_Any<Base>` is the union of the variant members. `models.<ns>` carries `Base`, each variant, and `Any<Base>` as keys.

**6. `RelationKeys` is a phantom that lets utilities tell relations from scalars.** It is a `unique symbol` declared once in `framework-components` and re-exported from each family's contract types entrypoint; each family's `getFamilyImports` adds it to its existing import. The last line of every member is `readonly [RelationKeys]?: 'a' | 'b'`, or `readonly [RelationKeys]?: never` when the model has no relations. An optional, symbol-keyed property never affects assignability and does not appear when a value is spread or iterated.

`Scalars<M>` is the model without its relations:

```ts
export declare const RelationKeys: unique symbol;

export type Scalars<M> = M extends { readonly [RelationKeys]?: infer R extends string }
  ? Omit<M, R | typeof RelationKeys>
  : M;
```

`Scalars` is distributive, so `Scalars<Models.public_AnyTask>` is the union of the variants' scalar rows. The name follows PSL, where a field is either scalar or relation.

**7. `Shape<M, Spec>` names an application data structure derived from a model, and is not a query language.** An endpoint declares its response type once, derived from the model; the query inside it is an implementation detail, and the compiler checks the body against the declaration at the `return`. `Spec` is an object. At every level: `'+'` is a union of scalar and relation names to keep (a relation named there is included with all of its scalars and none of its relations; the scalars are narrowed only when `'+'` names a scalar, so `'+': 'posts'` alone is every scalar plus posts); `'-'` is a union of scalar names to drop; `'+'` naming a scalar beside `'-'` at one level is a compile error, while `'+'` naming only relations beside `'-'` is every scalar but the dropped ones plus those relations; every other key is a relation of the current model whose value is a nested spec that narrows the related model (to include a relation whole, name it in `'+'`); relations are absent unless asked for; cardinality and nullability come from the model's own field type. The sigils were chosen over words such as `pick`/`omit` because words can collide with field names and sigils cannot.

```ts
// packages/1-framework/1-core/framework-components/src/execution/shape.ts
export type Shape<M, Spec extends ShapeSpec<M, Spec> = Record<never, never>> = ShapeOf<M, Spec>;

/**
 * The constraint a `Shape` spec satisfies. A generic that forwards a spec needs it:
 * `type Response<S extends ShapeSpec<User, S>> = Shape<User, S>`.
 */
export type ShapeSpec<M, Spec> = {
  readonly [K in keyof Spec]: K extends '+'
    ? '-' extends keyof Spec
      ? never
      : Exclude<ScalarNamesOf<M> | RelationNamesOf<M>, keyof Spec>
    : K extends '-'
      ? '+' extends keyof Spec
        ? never
        : ScalarNamesOf<M>
      : K extends RelationNamesOf<M>
        ? ShapeSpec<RelatedModel<M, K>, Spec[K]>
        : UnknownSpecKey<M, K>;
};

type UnknownSpecKey<M, K> = [RelationNamesOf<M>] extends [never]
  ? `'${K & string}' is not a relation of the model, which has none; try '+' or '-'`
  : `'${K & string}' is not a relation of the model; try '+', '-', or '${RelationNamesOf<M>}'`;

type ShapeOf<M, Spec> = M extends unknown
  ? Flatten<
      KeptScalars<M, Spec> & {
        [K in IncludedRelations<M, Spec>]: WrapLike<
          M[K],
          ShapeOf<RelatedModel<M, K>, NestedSpec<Spec, K>>
        >;
      }
    >
  : never;
```

The constraint on `Spec` is a mapped type over `Spec`'s own keys, so a wrong name, a relation in `'-'`, a non-object relation value, an unknown key, `'+'` naming a scalar beside `'-'`, or a relation both in `'+'` and as a key is a compile error on the offending key. An unknown key is constrained to a string literal that reads as the error and names the valid keys, for example `'nope' is not a relation of the model; try '+', '-', or 'posts'`. `ShapeOf` distributes over `M`, so over a polymorphic `Any<Base>` union each variant keeps only the relations it declares, and `Flatten` turns each level into one object type so hover text shows a single shape. `Shape<M, {}>` is `Scalars<M>`, `Shape<M, { '+': 'r' }>` is what `.include('r')` returns, `Shape<M, { '+': 'a' | 'b' }>` is what `.select('a', 'b')` returns, and a nested spec is what a nested include returns. The type tests hold the bare-collection equality (`ResultType` of the collection equals `Shape<M>`) for every SQL fixture model, and the include, projection, and nested-include equalities for representative relations of the SQL fixtures. What `Shape` deliberately cannot express (`where`, `orderBy`, `limit`, aggregation, renames, computed fields) is composed with TypeScript: `Shape<User, {}> & { postCount: number }`.

**8. `ResultType` reads ORM collections through `_row`.** A collection value has exactly one row type. `db.orm.public.User` reads `Scalars<Models.public_User>`; `db.orm.public.User.include('posts')` is a new value whose terminals all return `Scalars<Models.public_User> & { posts: Scalars<Models.public_Post>[] }`; `db.orm.public.User.select('id')` is a third. `ResultType<P>` in `framework-components` already reads an optional `_row` property from the SQL and Mongo query lanes. Both ORM collections gain that one phantom (`declare readonly _row?: Row` on the SQL `CollectionImpl`; `readonly _row?: IncludedRow<...>` on the Mongo `MongoCollection` interface), so `ResultType<typeof query>` names the result of any ORM query, including projections, refined includes, and `.variant()` narrowing.

**9. To-one nullability is a contract fact.** Whether a `'1:1'` or `'N:1'` relation is `X` or `X | null` is stated by the schema (`author User?` versus `author User`) and recorded on the relation as `nullable: boolean` (`ContractToOneRelation` in `packages/1-framework/0-foundation/contract/src/domain-types.ts`). The emitter reads that flag; nothing is reconstructed from storage at emit time, and there is no family hook for it.

- Authoring sets the flag from what the user wrote. The SQL and Mongo PSL interpreters read the `?` on the relation field at every site that assigns a `'1:1'` or `'N:1'` cardinality. The SQL and Mongo TypeScript builders take an `optional` flag on `belongsTo`; when it is omitted, `belongsTo` derives it from the nullability of its local `from` fields. The side of a one-to-one relation that does not own the foreign key is always nullable, because nothing in the database guarantees the related row exists: a `'1:1'` back-relation field written without `?` is a `PSL_REQUIRED_ONE_TO_ONE_BACKRELATION` diagnostic, and `hasOne` has no `optional` flag and always records `nullable: true`.
- Authoring rejects a required to-one relation field whose foreign-key fields include a nullable one, and an optional relation field whose foreign-key fields are all required: a `PSL_RELATION_NULLABILITY_MISMATCH` diagnostic on the field in PSL, a `CONTRACT.RELATION_INVALID` error naming the model and relation in the TypeScript builders.
- `validateContractDomain` requires the flag on every `'1:1'` and `'N:1'` reference relation and rejects it on `'1:N'`, `'N:M'`, and embed relations. A `contract.json` emitted before the flag existed fails validation with a message to re-run `prisma contract emit`.
- Both ORMs read the same flag: the SQL ORM's `IsToOneRelationNullable` and the Mongo ORM's `IncludeRelationRowType` add `| null` exactly when it is true, so the emitted model and the ORM's include agree by construction. Embed relations are not relations for this purpose: they are emitted as fields typed as the embedded model's member (array or single by cardinality), placed after scalar fields and before reference relations, and are not in `RelationKeys`.

## Responsibilities

- **Framework emitter** renders the `Models` block and `models` constant for both families, resolves field types with the `FieldOutputTypes` resolver, applies the naming and collision rules, and reads each to-one relation's `nullable` flag.
- **Family emitter** (`EmissionSpi`) adds `RelationKeys` to its family import.
- **`framework-components`** declares `RelationKeys`, `Scalars`, and `Shape`, exported beside `ResultType`; each family contract types entrypoint re-exports them.
- **ORM clients** carry the `_row` phantom and nothing else changes. Their row derivations stay their own; type tests hold them equal to the emitted types.

## Consequences

- A default fetch returns `Scalars<Model>`, not the model. This is the opposite of Prisma 7, where the generated `User` is scalars-only, and it is the first thing a Prisma 7 user notices. The reference docs say it in their first paragraph.
- A data structure with relations is written as `Shape<A, { '+': 'rel' }>` (or by hand as `Scalars<A> & { rel: Scalars<B>[] }`), never as `Pick` on the model. `Pick<User, 'id' | 'name' | 'posts'>` demands `posts: Post[]` with every post carrying its own `author` and `comments`, and no query returns that.
- `contract.json` is unchanged; `contract.d.ts` grows by one block per contract, and every emitted fixture is regenerated.
- The Prisma 7 questions have direct answers: `Prisma.User` is `Models.public_User`; `Prisma.UserGetPayload<{ include: { posts: true } }>` is `Shape<Models.public_User, { '+': 'posts' }>`; `Awaited<ReturnType<typeof fn>>` is `ResultType<typeof query>`. Input types (`CreateInput`, `MutationUpdateInput`, `ShorthandWhereFilter`, `UniqueConstraintCriterion`) were already exported by the ORM client and only needed documenting beside these.
- No runtime behaviour changes anywhere. This is emitter output, phantom properties, two utility types, and docs.

## Alternatives considered

**`db.models`, a runtime accessor for model types.** Rejected: dotted access already exists through `typeof models.public.User` with no runtime. A runtime value would be either an object pretending to be a row or a definition object whose `typeof` is not the model.

**Bare `export type User` at the top level.** Rejected: adding a second `User` in another schema would silently remove the alias and break every import of it, a breaking change caused by an unrelated schema edit. `Models.public_User` is the importable name instead, and it cannot disappear.

**Emit `GetPayload`-style types per query.** Rejected: it ties the contract to one lane's vocabulary and grows `contract.d.ts` without bound.

**`With<M, R>`, a model plus a union of relation names, one level deep.** The first draft of this decision. Replaced by `Shape` before merge: `With<User, 'posts'>` is `Shape<User, { '+': 'posts' }>`, and keeping both would be two overlapping helpers. `With` could not narrow scalars or nest, so an endpoint whose response drops a column or narrows a related row had to fall back to hand-written types, which is exactly the need Prisma 7 users met with `GetPayload<{ select, include }>`.

**Prisma 7's boolean form, `{ id: true; posts: { title: true } }`.** Rejected as verbose: every scalar must be listed for the wide case, or a wildcard sigil added.

**A relation-selection parameter on the contract, `Model<Contract, 'User', { posts: { comments: true } }>`.** Rejected: it takes the contract rather than the model, and it reads as a query. `Shape` is a pure utility over the model type, like `Scalars`, describes end states rather than queries, and has nothing that could be mirrored at runtime.

**Dotted relation paths as a union, `'id' | 'posts.title' | 'posts.comments'`.** One flat grammar that composes as unions, but deep trees repeat prefixes per leaf and exclusion needs a sigil anyway; nested objects read better.

**A parameter mapping relation name to the model type that sits there.** Rejected: it makes the user import and restate what the contract already knows.

**`Models.public.User` as nested TypeScript namespaces.** Rejected: `namespace public` does not compile. Folding the schema into the member name gives the importable form; the declared constant gives the dotted form.

**A separate `RowOf` helper for ORM queries.** Rejected: `ResultType` exists and is documented. Give the collections the marker it reads.

## References

- [Naming model and result types](../../reference/model-and-result-types.md) — the user-facing reference for `Models`, `models`, `Scalars`, `Shape`, and `ResultType`
