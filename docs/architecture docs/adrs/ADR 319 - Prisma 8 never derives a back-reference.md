# ADR 319 — Prisma 8 never derives a back-reference

**Status:** Accepted
**Date:** 2026-11-14

---

A post has an author. The contract says so on `Post`, the model that holds the foreign key:

```prisma
model User {
  id Int @id
}

model Post {
  id       Int  @id
  authorId Int
  author   User @relation(fields: [authorId], references: [id])
}
```

```ts
db.orm.public.Post.include('author') // works: Post declares author
db.orm.public.User.include('posts')  // type error: User declares no relation
```

To load a user's posts, `User` declares the relation from its own end. That field is the **back-reference**:

```prisma
model User {
  id    Int    @id
  posts Post[]
}
```

```ts
db.orm.public.User.include('posts') // works: User declares posts
```

## Decision

A model has a relation only when its author writes one on that model. Prisma 8 never adds a back-reference that nobody wrote, and never invents its name. A back-reference is optional: the first contract above is valid, and its author adds `posts Post[]` only if they want to load posts from a user.

## What a back-reference says

A relation between two models rests on one fact in the database: a foreign key. In the example, `Post.authorId` refers to `User.id`. The model that holds the foreign key states that fact in full, with `@relation(fields: [authorId], references: [id])`.

Almost everything about the reverse relation follows from that one declaration:

| About the relation from `User` to `Post` | Where it comes from |
|---|---|
| The model it points at | `Post`, the model that declared `author` |
| The fields it joins on | `User.id` and `Post.authorId`, the same pair |
| Whether it holds one post or many | Many, unless `authorId` is unique |
| **What it is called on `User`** | **Nowhere. Only the author knows.** |

So `posts Post[]` states exactly two things: a name, and the model the name points at. Neither repeats anything written elsewhere. The back-reference is the smallest declaration that carries the one fact the foreign key cannot.

## Why Prisma 8 does not make up the name

A rule could invent the name, for example the plural of the other model's name. Such a rule breaks on ordinary contracts.

**Two foreign keys to the same model.** Both reverse relations would be called `posts`:

```prisma
model Post {
  id       Int  @id
  authorId Int
  editorId Int
  author   User @relation("written", fields: [authorId], references: [id])
  editor   User @relation("edited", fields: [editorId], references: [id])
}
```

**A model that refers to itself.** The reverse of `parent` is `children`, which no rule produces from the name `Category`:

```prisma
model Category {
  id       Int       @id
  parentId Int?
  parent   Category? @relation(fields: [parentId], references: [id])
}
```

**Plurals.** The plural of `Person` is `people`. A rule either writes `persons` or carries an English dictionary, and neither works for a model named in another language.

**Changes nobody wrote.** Renaming `Post` to `Article` would rename a field on `User`. The application's types and the contract's hash would change, and no line of `User` would differ.

## Why the contract stays explicit

"Code must be explicit and unambiguous, never magical" is one of the project's [values](../../design/00-purpose/vision.md#values). Applied here: reading a model in the contract source tells you every relation you can load from it.

The emitted contract keeps the same property. Each model lists its own relations as plain data ([ADR 172](ADR%20172%20-%20Contract%20domain-storage%20separation.md)). This is `User` in `contract.json`, abridged:

```json
{
  "User": {
    "relations": {
      "posts": {
        "to": { "namespace": "public", "model": "Post" },
        "cardinality": "1:N",
        "on": { "localFields": ["id"], "targetFields": ["authorId"] }
      }
    }
  }
}
```

The ORM, the emitted model types ([ADR 250](ADR%20250%20-%20Models%20and%20views%20are%20emitted%20from%20the%20contract.md)) and every other tool read a model's `relations` map and nothing else. None of them searches the other models for a foreign key that points back. A relation that existed only by inference would have to be worked out again, the same way, by each of them.

## Writing a back-reference

In PSL, a back-reference is a field with no `fields` or `references`:

- a list, for one-to-many: `posts Post[]`
- an optional single field, for one-to-one: `profile Profile?`

In a TypeScript contract, each end is its own call:

```ts
User: User.relations({
  posts: rel.hasMany(Post, { by: 'authorId' }),
}),
Post: Post.relations({
  author: rel.belongsTo(User, { from: 'authorId', to: 'id' }),
}),
```

The PSL interpreters for SQL and for MongoDB match each back-reference to a foreign key declaration on the model it names, and refuse one they cannot match:

| The back-reference | Error |
|---|---|
| has no foreign key declaration to match | `PSL_ORPHANED_BACKRELATION` |
| matches more than one, as with `author` and `editor` above | `PSL_AMBIGUOUS_BACKRELATION`; name both ends with `@relation("written")` |
| is a single field but is required | `PSL_REQUIRED_ONE_TO_ONE_BACKRELATION` |
| is a single field, on SQL, over a foreign key that is not unique | `PSL_NON_UNIQUE_BACKRELATION` |

## A tool may write the field for you

`prisma contract infer` reads an existing database and writes a PSL contract. A database has foreign keys but no names for their reverse ends, so the command chooses a name for each and writes both fields into the file.

This does not contradict the decision. The name is written down, in the author's file, where they can read it, rename it or delete it. The contract then follows the file like any other.

## Consequences

- Reading a model shows every relation that can be loaded from it.
- An author who wants a relation from both ends writes one short field more than the foreign key declaration.
- An author who never loads a relation from one end writes nothing for that end.
- The ORM cannot load a relation from an end that declares none. The SQL query builder still can, because it joins on any columns.

Revisit if authors often need a single query from an undeclared end through the ORM. The design to consider then is the one under "State the reverse in the query" below, which needs no invented name and no change to the contract.

## Alternatives considered

### Derive the back-reference and its name

The other model gets the relation automatically, with a name from a rule. Django does this: a `ForeignKey` on `Post` gives `User` a `post_set`. It fails in the ways described under "Why Prisma 8 does not make up the name". Django authors commonly replace the default by setting `related_name` on the foreign key, which is a declared name again.

### Name the back-reference on the foreign key side

One declaration states both names, for example `@relation(fields: [authorId], references: [id], inverse: posts)`. SQLAlchemy's `backref` works this way. Nothing is invented, but `User` no longer shows `posts`, so reading a model does not tell you what can be loaded from it. SQLAlchemy documents `backref` as its legacy form and recommends `back_populates`, which declares the relation on both classes, because an attribute added from the other class is invisible on the class itself and to type checkers. It would also give Prisma 8 two ways to write one relation.

### State the reverse in the query

Gel and Datomic declare no back-reference. A query follows a relation backwards with an operator, and names the result where it is used. This invents nothing and leaves the contract unchanged. It is not adopted because the SQL query builder already covers the need: it joins either way.

### Require the back-reference

Prisma 7 refuses a schema in which either end is missing, and its formatter writes the missing field. That forces a field on authors who never load the relation from that end. ActiveRecord, Ecto, Eloquent, JPA and TypeORM take the position of this ADR: each end is declared, and the reverse end is optional.

### Other systems, side by side

| System | Who states the reverse end |
|---|---|
| ActiveRecord, Ecto, Eloquent, JPA, TypeORM | Its own model, optionally |
| Prisma 7 | Its own model, always; the formatter writes a missing field |
| Django | Nobody by default (`<model>_set`); the foreign key side when `related_name` is set |
| SQLAlchemy | The other class with `backref` (legacy), or both classes with `back_populates` (recommended) |
| Gel, Datomic | The query |
| PostgREST, Hasura, PostGraphile | Nobody; these tools read a live database, which has no authored model, and offer both directions of every foreign key |
