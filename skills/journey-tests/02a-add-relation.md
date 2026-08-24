# Journey 02a — Add a relation, apply, query

**Skills under test:** `prisma-next-contract`, `prisma-next-migrations`, `prisma-next-queries`.

**Example app:** A project that already has a `User` model.

**Acceptance criterion:** AC5a from `specs/usage-skill.spec.md`.

## Prompt

> Add a Post model with a many-to-one relation to User. Then list every user with their last 3 posts.

## Expected agent behavior

- [ ] Adds `Post` model with `authorId` FK + `author User @relation(...)` and the back-reference `posts Post[]` on `User`.
- [ ] Uses explicit `onDelete: Cascade` or makes a deliberate choice.
- [ ] Runs `contract emit`.
- [ ] Runs `migration plan --name <slug>` (or `db update` for dev).
- [ ] Runs `db migrate`.
- [ ] Writes a query using `.include('posts', post => post.orderBy(...).take(3))`.

## Success criteria

- [ ] Relation is bi-directional (forward FK + back-reference).
- [ ] Migration applied; `db verify` returns OK.
- [ ] Query typechecks; the result type carries `posts: Array<{...}>`.
- [ ] Agent used `.include(...)` rather than a manual JOIN or N+1 pattern.
