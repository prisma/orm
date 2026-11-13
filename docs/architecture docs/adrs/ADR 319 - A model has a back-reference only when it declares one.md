# ADR 319 — A model has a back-reference only when it declares one

**Status:** Accepted
**Date:** 2026-11-14

---

```prisma
model User {
  id    Int    @id
  posts Post[] // the back-reference: User has a relation named posts
}

model Post {
  id       Int  @id
  authorId Int
  author   User @relation(fields: [authorId], references: [id])
}
```

```ts
db.orm.public.User.include('posts') // works because User declares posts
```

## Decision

Prisma 8 never derives a back-reference. A model has a relation to another model only when its author declares it:

- In PSL, the model that holds the foreign key declares the relation with `@relation(fields: [...], references: [...])`. The other model has a relation back only when it declares a field of its own: a list (`posts Post[]`), or an optional single field for a one-to-one (`profile Profile?`).
- In a TypeScript contract, each side is its own call: `rel.belongsTo(User, { from: 'authorId', to: 'id' })` on one model, and `rel.hasMany(Post, { by: 'authorId' })` or `rel.hasOne(...)` on the other.

The back-reference is optional. A contract with only `Post.author` is valid. `User` then has no relation to `Post`, so `User.include(...)` has nothing to load from `Post`, while `Post.include('author')` works.

Use instead of a derived back-reference: declare it. `prisma contract infer` writes both sides when it reads an existing database.

## Why

### The back-reference carries the one thing that cannot be derived

`Post.author` records the target model and the join columns. From it, the reverse relation's target, its join, and its cardinality all follow: the cardinality is one-to-one when the foreign key columns are unique, and one-to-many otherwise.

What does not follow is the name the relation has on `User`. `posts Post[]` states exactly two things, the name and the model it points at, and neither repeats anything written elsewhere. So the declaration is not redundant. The redundancy people remember from Prisma 7 is that the back-reference was mandatory there: a schema without it failed validation. Here it is optional, so an author writes it only for a relation they want to query.

### A derived name fails in known ways

- **Two foreign keys to one model.** `Post.author` and `Post.editor` both point at `User`. A naming rule gives both reverse relations the same name.
- **Self-relations.** `Category.parent` needs a reverse name such as `children`, which no rule produces from the model's name.
- **Plurals.** A name derived from `Person` is `persons`, unless the system carries an English dictionary.
- **Changes nobody wrote.** Renaming a model would rename a field on another model, which changes the application's types and the contract's hash without a line of the other model changing.

### It keeps the contract explicit

"Code must be explicit and unambiguous, never magical" is one of the project's [values](../../design/00-purpose/vision.md#values). A model's block in the contract source lists everything the ORM can include from it. A relation that appears in `contract.json` and in the application's types, but in no source the author wrote, breaks that.

Each model's relations are also plain data in the contract ([ADR 172](ADR%20172%20-%20Contract%20domain-storage%20separation.md)): `models.<Model>.relations` holds every relation the model has. The ORM, the emitted model types ([ADR 250](ADR%20250%20-%20Models%20and%20views%20are%20emitted%20from%20the%20contract.md)) and any other tool read that map and nothing else. None of them searches other models for a foreign key pointing back.

## How a back-reference is paired

The PSL interpreters of both families pair each declared back-reference with a foreign-key-side relation on the model it names:

- No matching relation is `PSL_ORPHANED_BACKRELATION`.
- More than one match is `PSL_AMBIGUOUS_BACKRELATION`. Name both sides with `@relation("name")` to choose.
- A single-valued back-reference must be optional (`PSL_REQUIRED_ONE_TO_ONE_BACKRELATION`). On SQL, the foreign key behind it must also be unique (`PSL_NON_UNIQUE_BACKRELATION`).

`prisma contract infer` reads a database, where no back-reference names exist, and writes PSL. It derives a name for each back-reference and writes the field into the file. From then on the field is the author's: they can rename it or delete it, and the contract follows the file.

## Consequences

- A model's contract source shows every relation that can be included from it.
- An author who wants to query a relation from both ends writes one short field more than the foreign key side.
- A query from the end that declares no relation is still possible in the SQL query builder, which joins on any columns.

Revisit if: authors often need a one-off query from the undeclared end through the ORM. The form to consider then is a reverse traversal stated in the query, named where it is used, which needs no derived name and no change to the contract.

## Alternatives considered

### Derive the back-reference and its name

The other model gets the relation automatically, named by a rule such as the plural of the declaring model. Django does this: a `ForeignKey` on `Post` gives `User` a `post_set`. The failures are those under "A derived name fails in known ways". In practice Django authors override the default by setting `related_name` on the foreign key, which is a declared name again.

### Name the back-reference on the foreign key side

One declaration states both names, for example `@relation(fields: [authorId], references: [id], inverse: posts)`. SQLAlchemy's `backref` works this way. Nothing is derived, but `User`'s block no longer shows `posts`, so reading a model does not tell you what you can include from it. SQLAlchemy now documents `backref` as its legacy form and recommends `back_populates`, which declares the relation on both classes, because the attribute is otherwise invisible on the class and to type checkers. It would also give Prisma 8 two ways to write the same relation.

### A reverse traversal stated in the query

Gel (EdgeDB) and Datomic have no declared back-reference at all: a query follows a link backwards with an operator and names the result where it is used. This derives nothing and leaves the contract unchanged. It is not adopted because nothing yet needs it: the SQL query builder already joins either way. It is the form named under "Revisit if".

### Require the back-reference

Prisma 7 fails validation when either side is missing, and its formatter writes the missing field. ActiveRecord, Ecto, Eloquent, JPA and TypeORM declare each side explicitly but do not require both. Requiring both forces a field on authors who never query from that end.

### Prior art, in one table

| System | Who states the reverse side |
|---|---|
| ActiveRecord, Ecto, Eloquent, JPA, TypeORM | Each side is declared explicitly; the reverse is optional |
| Prisma 7 | Both sides, mandatory; the formatter writes the missing field |
| Django | The foreign key side only; the reverse is automatic, named `<model>_set` unless `related_name` is set |
| SQLAlchemy | `backref` on one side (legacy), or `back_populates` on both (recommended) |
| Gel (EdgeDB), Datomic | Nobody; the reverse is a query operator |
| PostgREST, Hasura, PostGraphile | Nobody; both directions come from the database's foreign keys |

The last row is API tools that read a live database and have no authored model to keep explicit.
