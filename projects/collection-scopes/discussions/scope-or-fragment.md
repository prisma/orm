# Scope or query fragment: what do we call a reusable piece of a query?

For a design discussion between Will and Serhii, 2026-10-07.

## The question

The SQL ORM client lets an application write a piece of a query once and reuse it. Today that thing is called a **scope**: a function from a collection to a collection, which `apply` runs. ADR 259 is titled "Query fragments are functions" and already uses **fragment** as the umbrella word, but the public API says `scope` everywhere.

Should the public name be **query fragment** (**fragment** for short) instead of **scope**? And if so, how far does the rename go?

The names in the next section are on main and shipped in **8.0.0-rc.15** (released today), so any rename is a breaking change with an upgrade entry. It is still an RC, so the cost is an upgrade entry, not a deprecation cycle. `apply` is not in question: it keeps its name under every option below.

## What exists today

| Name | Kind | What it is |
| --- | --- | --- |
| `Scope<In, Out>` | type | `(collection: In) => Out` |
| `collection.apply(fn)` | method | runs any function on the collection |
| `db.orm.scope(fields, body)` | method | a scope for any model that has the declared fields |
| `db.orm.public.Post.scope(body)` | method | a scope for one model |
| `orderByField(collection, name, direction, allowed)` | function | an order from a request's sort field |
| `FieldScope`, `DeclaredField`, `ScopeFacts` | types | what `db.orm.scope` returns, its field declarations, and what its body established |
| `Filtered<C>`, `Ordered<C>`, `Including<C, Added>` | types | a collection type plus a fact |
| `CodecField`, `CodecListField` | types | a model accessor field named by its codec, for **row fragments** |
| "row fragment" | docs term | a function of the model accessor, which `where` and `orderBy` take |

Where the word "scope" also appears:

- **Error text:** `ORM.FIELD_UNKNOWN` says "Cannot apply a scope to Task: it has no field severity". The compile errors name the properties `'the model has no field that matches the declaration in the scope'` and `'the scope could not read the model of the collection from its type'`.
- **Reserved names:** every collection has a `scope` member, so a custom class cannot define its own. An aggregate operation named `scope` is refused with `ORM.AGGREGATE_OPERATION_RESERVED`. A contract namespace named `scope` hides `db.orm.scope`.
- **Docs:** the client README section "Scopes", the `skills/prisma-8` section "Workflow — Scopes", ADR 259, ADR 265, and the upgrade entry `scope-is-a-collection-member`.
- **Planned, not built:** slice 4's draft ADR (prisma/orm#30428) has `fulltextSearchScopes<Contract, 'Post'>()` and `defineIndexScopes`. "Default scopes", such as soft delete on every query of a model, is the feature we said we would discuss after this work.
- **A clash we already know about:** the SQL builder in the same facade exports `Scope` and `ScopeField`, meaning the tables and columns visible to a query (`packages/2-sql/4-lanes/sql-builder/src/scope.ts`). It is recorded in `projects/collection-scopes/deferred.md` as a decision to make before 8.0 GA.

## The cases we know we want to cover

Each case shows how it reads today, and how it would read with "fragment". The fragment spellings are illustrations, not proposals. All cases assume `const { Post, Comment, Tag, User } = db.orm.public;`.

### 1. A named query on a custom collection class

```ts
class PostCollection extends Collection<Contract, 'Post'> {
  published() { return this.where((p) => p.publishedAt.isNotNull()); }
}

Post.published().limit(10).all();
```

No new name appears in user code either way. In the docs, Rails users would call `published` a scope. With "fragment", we would say "a class method is a named query fragment". A class method can also wrap a shared one: `search(q) { return this.apply(postSearch(q)); }`, so cases 3 to 8 all end up behind names like this in real applications.

### 2. A conditional, written inline

```ts
Post.apply((posts) => (search ? posts.where((p) => p.title.ilike(`%${search}%`)) : posts));
```

Same code either way. Only the docs change: "the function `apply` runs is a scope" or "... is a query fragment".

### 3. A filter for every model that has a field

```ts
// today
const notDeleted = db.orm.scope(
  { deletedAt: field.temporal.timestamptz().optional() },
  (rows) => rows.where((r) => r.deletedAt.isNull()),
);
Post.apply(notDeleted);
Comment.apply(notDeleted);
Tag.apply(notDeleted); // error: Tag has no deletedAt

// with "fragment"
const notDeleted = db.orm.fragment(
  { deletedAt: field.temporal.timestamptz().optional() },
  (rows) => rows.where((r) => r.deletedAt.isNull()),
);
Post.apply(notDeleted);
```

### 4. A filter that takes a value: the tenant

```ts
const forTenant = (tenantId: string) =>
  db.orm.scope({ tenantId: field.uuidString() }, (rows) => rows.where((r) => r.tenantId.eq(tenantId)));

Post.apply(forTenant(ctx.tenantId));
```

With "fragment": `db.orm.fragment(...)`. "A tenant scope" is the phrase people already use for this in Rails and Laravel. "A tenant fragment" is not a phrase anyone uses yet.

### 5. A shared selection on one model

```ts
// today
const summary = Post.scope((posts) => posts.select('id', 'title').include('user'));
type PostSummary = CollectionRowOf<ReturnType<typeof summary>>;

Post.where({ userId }).combine(summary);
Post.where({ userId }).query(summary);
Post.where({ userId }).summary(summary);
Post.where({ userId }).pipe(summary);
Post.where({ userId }).apply(summary);
Post.where({ userId }).link(summary);
Post.where({ userId }).merge(summary);
Post.where({ userId }).and(summary);

Post.where(notDeleted).where()h

Post.where({ userId }).use(summary);
Post.where({ userId }).with(summary);



User.include('posts', (posts) => posts.apply(summary));

// with "fragment"
const summary = Post.fragment((posts) => posts.select('id', 'title').include('user'));
```

This is the case where "scope" fits worst. It does not narrow the rows; it chooses what each row contains. GraphQL users would call it a fragment: a reusable selection.

### 6. A row fragment: one `where` callback for many models

```ts
type DeletedAt = CodecField<Contract, 'pg/timestamptz-temporal@1', true>;
const isNotDeleted = (row: { deletedAt: DeletedAt }) => row.deletedAt.isNull();

Post.where(isNotDeleted);
Comment.where((c) => and(isNotDeleted(c), c.postId.eq(postId)));
```

This is case 3 one level down: a function of the row, not of the collection, so it composes inside a `where` with other conditions but carries no facts (`Filtered`) and cannot add an order or a limit. It is already called a "row fragment" in ADR 259 and the README. With "fragment" as the public word, row fragments and query fragments become one family: a fragment of a row and a fragment of a query. With "scope", we have two words for two levels.

### 7. A sort field from a request

```ts
Post.orderBy(orderByField(Post, input.sort, input.direction, ['title', 'createdAt']));
```

Not affected by the choice.

### 8. Search over an index a package defines (slice 4, not built)

```ts
// draft ADR today
const postScopes = fulltextSearchScopes<Contract, 'Post'>();
Post.apply(postScopes.post_search(websearchToTsquery('postgres index'))).limit(10).all();

// with "fragment"
const postSearch = fullTextSearchFragments<Contract, 'Post'>();
Post.apply(postSearch.post_search(q)).limit(10).all();
```

The package author writes `defineIndexScopes` or `defineIndexFragments`.

### 9. A default on every query of a model (not designed yet)

```ts
// Rails: default_scope { where(deleted_at: nil) }
// Laravel: global scopes
// Sequelize: defaultScope
orm({ ..., defaults: { Post: notDeleted } }); // shape not designed
```

"Default scope" is a known term in three ecosystems. "Default fragment" means nothing yet, so we would have to explain it. This feature is the next thing after this project, so the name we pick now constrains it.

## The options

**A. Keep "scope".** The public API stays as it is. "Fragment" stays a documentation word: "row fragment" for a function of the model accessor.

**B. "Fragment" everywhere.** `Fragment<In, Out>`, `db.orm.fragment(fields, body)`, `Post.fragment(body)`, `FieldFragment`, `FragmentFacts`, slice 4's `defineIndexFragments`, and "default fragments" later. Row fragments and query fragments are one family.

**C. "Fragment" for the concept, "scope" for named ones.** `Fragment<In, Out>` is the type of anything `apply` runs. `db.orm.scope` and `Post.scope` keep their names and return a `Fragment`; a class method that returns one is called a scope in the docs, like Rails. The risk is two words for one thing in the API: `const notDeleted: Fragment<...> = db.orm.scope(...)`.

**D. A third word.** For example "modifier", as in Objection.js modifiers and Knex's `modify(fn)`. Listed so we can rule it out deliberately.

## How the choice affects the framework

| Area | A: scope | B: fragment | C: split |
| --- | --- | --- | --- |
| Public names to rename | none | `Scope`, `FieldScope`, `ScopeFacts`, `db.orm.scope`, `Post.scope`, internal `ScopeCollection`, `ScopeModelAccessor`, `MissingScopeFields`, `ModelScopeReceiver` | `Scope` → `Fragment`; helpers keep "scope" |
| Reserved collection member | `scope` | `fragment` | `scope` |
| Error and compile-error text | unchanged | reworded | partly reworded |
| Clash with the SQL builder's `Scope` | remains; rename the builder's to `NameScope` | gone in the ORM; the builder's `Scope` is then the only `Scope` | remains |
| Row fragments and query fragments | two words | one family | one family at type level |
| Prisma 7 and raw SQL readers | "fragment" appears only in docs, for row fragments | "fragment" now means two things: our query fragments, and raw SQL fragments (`Prisma.sql` helpers in Prisma 7, our own `sql` tag docs, Ecto's `fragment`) | same as B for the type |
| Rails, Laravel, Sequelize readers | familiar | must learn a new word | familiar for named ones |
| Default scopes (next feature) | "default scope", known | "default fragment", new | "default scope" |
| Slice 4 names | `defineIndexScopes`, `fulltextSearchScopes` | `defineIndexFragments`, `fullTextSearchFragments` | either |
| Mongo ORM client (TML-3427) | gets `scope` when it gains these helpers | gets `fragment` | either |
| Cost now | none | rename across the client, facade, demo, tests, README, skill, ADR 259, ADR 265, upgrade entries, slice 4 draft; plus an upgrade entry for rc.15 users | smaller version of B |

## Prior art

| Library | Word | What it names |
| --- | --- | --- |
| Rails Active Record | scope, `default_scope` | a named, chainable query on a model |
| Laravel Eloquent | local and global query scopes | the same, plus defaults |
| Sequelize | scopes, `defaultScope` | the same |
| Objection.js | modifiers | named functions that modify a query builder |
| Knex | `modify(fn)` | runs a function on a query builder, like our `apply` |
| Kysely | `$call(fn)` | the same; the closest analogue for users coming from Prisma 7's Kysely integrations |
| GraphQL | fragment | a reusable selection set, like case 5 |
| Ecto | `fragment/1` | raw SQL inside a query |
| Prisma 7 | `Prisma.sql`, `Prisma.join`, `Prisma.raw` | building raw SQL fragments |

## Questions to settle

1. Is the thing `apply` runs one concept or two? Is a selection (case 5) the same kind of thing as a filter (cases 3 and 4)?
2. Do we want row fragments (case 6) and query fragments to share a name?
3. Does "fragment" meaning raw SQL to Prisma 7 and Ecto users count against it?
4. What will the per-model default (case 9) be called, and does that settle the base word?
5. Whatever we pick for the ORM, do we rename the SQL builder's `Scope` before GA?
6. If we rename, do we do it now, in one pull request with an upgrade entry, before slice 4 builds on the names?
7. The reserved member name moves with the choice (`scope` or `fragment` on every collection). Is either more likely to collide with a method an application already has on a custom class?

## Facilitator's read

One input, not a conclusion. The strongest argument for "fragment" is coherence: ADR 259 already explains the design as fragments of rows and fragments of queries. Case 5, a shared selection, is not a scope in the Rails sense. The strongest arguments for "scope" are cases 4 and 9: "tenant scope" and "default scope" are terms users already know. "Fragment" already means raw SQL to the Prisma 7 users we are migrating. If we choose "fragment", we should choose it everywhere (option B) and do it before slice 4. Option C gives users two words for one thing.
