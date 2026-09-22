# Naming model and result types

The model is what you wrote in PSL: every field and every relation. Each related model includes its own relations in turn, so no query returns a value of the model type. A query returns the fields it fetched. The default fetch, `db.orm.public.User.first()` or `db.orm.public.User.all()`, returns `Scalars<Model>`: the model without its relations. A fetch with `.include()` returns `Scalars<Model>` plus the relations you asked for. A fetch with `.select()` returns what you selected.

Every type on this page is emitted into `contract.d.ts` or exported by the family package. You can name a model, a default row, a data structure derived from a model, or the result of a query without a client in scope.

```ts
import type { models, Models } from './prisma/contract';
import type { Scalars, Shape } from '@prisma/orm-postgres/family-contract/types';
import type { ResultType } from '@prisma/orm-postgres/components/runtime';
```

On Mongo the imports are `./prisma/contract`, `@prisma/orm-mongo/family-contract/types`, and `@prisma/orm-mongo/components/runtime`.

## The model

`contract.d.ts` exports a `Models` namespace with one member per model and a `models` declared constant that reaches the same types by dotted access. Each member carries every scalar field and every relation. A relation is typed as the related model: `X[]` for to-many, `X | null` for a to-one relation whose field is optional in the schema (`author User?`, or `belongsTo(User, { ..., optional: true })`), and `X` for a required one.

```ts
export namespace Models {
  export type public_User = {
    id: CodecTypes['pg/int4@1']['output'];
    name: CodecTypes['pg/text@1']['output'];
    email: CodecTypes['pg/text@1']['output'];
    invitedById: CodecTypes['pg/int4@1']['output'] | null;
    address: AddressOutput | null;
    invitedUsers: public_User[];
    invitedBy: public_User | null;
    posts: public_Post[];
    profile: public_Profile | null;
    tags: public_Tag[];
    roles: public_Role[];
    readonly [RelationKeys]?: 'invitedUsers' | 'invitedBy' | 'posts' | 'profile' | 'tags' | 'roles';
  };
  export type public_Post = {
    id: CodecTypes['pg/int4@1']['output'];
    title: CodecTypes['pg/text@1']['output'];
    userId: CodecTypes['pg/int4@1']['output'];
    views: CodecTypes['pg/int4@1']['output'];
    embedding: Vector<3> | null;
    comments: public_Comment[];
    author: public_User;
    readonly [RelationKeys]?: 'comments' | 'author';
  };
}

export declare const models: {
  public: {
    User: Models.public_User;
    Post: Models.public_Post;
  };
};
```

`typeof models.public.User` and `Models.public_User` are the same type. `models` has no runtime value; import it with `import type`.

```ts
import type { Models, models } from './prisma/contract';

type User = typeof models.public.User;
type AlsoUser = Models.public_User;
```

The `readonly [RelationKeys]?` line lists the relation names. It never affects assignability and never appears in a value.

### Namespaces in model names

On a database without schemas, such as SQLite, the model name is bare: `Models.User` and `typeof models.User`.

```ts
export declare const models: {
  User: Models.User;
  Post: Models.Post;
};
```

On a database with schemas, such as Postgres, the schema is part of the name: `Models.public_User` and `typeof models.public.User`. A model declared without a schema is in the unbound namespace, written `Models.unbound_User` and `typeof models.__unbound__.User`. This is the same convention as `db.enums.__unbound__.X`. Mongo names its models the same way.

Adding a schema later never renames an existing type.

### Polymorphic models

A polymorphic base emits three shapes: the base member, one member per variant, and an `Any<Base>` union of the variant members. The base's discriminator field is the union of the variant literals; each variant narrows it to its own literal and adds its own fields. A relation whose target is a polymorphic base is typed as the `Any<Base>` union, because the ORM returns the variant union for such an include.

```ts
type TaskType = Models.public_Task['type']; // 'bug' | 'feature' | 'epic'

const bugs = db.orm.public.Task.variant('Bug');
type Bug = ResultType<typeof bugs>; // Scalars<Models.public_Bug>

type AnyTask = ResultType<typeof db.orm.public.Task>; // Scalars<Models.public_AnyTask>

const projectsWithTasks = db.orm.public.Project.include('tasks');
type ProjectWithTasks = ResultType<typeof projectsWithTasks>; // Shape<Models.public_Project, { '+': 'tasks' }>
```

## The row a default fetch returns

`Scalars<M>` is the model without its relations. It is what `db.orm.public.User.first()`, `db.orm.public.User.all()`, and every other terminal on a plain collection return. `Scalars` distributes over unions, so `Scalars<Models.public_AnyTask>` is the union of the variants' scalar rows.

```ts
type UserRow = Scalars<Models.public_User>;
const user: UserRow | null = await db.orm.public.User.first();
```

On Mongo, embedded documents are fields, not relations, so they stay present in `Scalars`.

## A data structure derived from a model

An API endpoint declares its response type once, derived from the model. The compiler checks the body against it at the `return`. The query inside is an implementation detail: change the model and the type changes; change the query and the same declaration still has to be satisfied. `Shape<Model, Spec>` is the type for that. The demo app runs this example end to end in `examples/prisma-8-demo/src/orm-client/get-user-profile.ts` (`pnpm start -- orm-user-profile <id>`).

```ts
type UserResponse = Shape<
  Models.public_User,
  { '-': 'email'; posts: { '+': 'id' | 'title' | 'tags' } }
>;

async function getUserWithPosts(userId: Models.public_User['id']): Promise<UserResponse | null> {
  const user = await db.orm.public.User.where({ id: userId })
    .include('posts', (posts) => posts.include('tags'))
    .first();
  if (user === null) return null;
  const { email: _email, ...rest } = user;
  return { ...rest, posts: user.posts.map(({ id, title, tags }) => ({ id, title, tags })) };
}
```

At every level of the spec:

1. `'+'` is a union of names to keep, scalars and relations alike. A relation named in `'+'` is included with all of its scalars and none of its relations. `'+'` narrows the scalars only when it names a scalar: `'+': 'posts'` alone is every scalar plus `posts`.
2. `'-'` is a union of scalar names to drop. Every other scalar is kept. Relations cannot be dropped, since they are absent unless asked for.
3. `'+'` may sit beside `'-'` only when `'+'` names relations alone. `{ '-': 'passwordHash'; '+': 'posts' }` is every scalar except the hash, plus posts. `{ '-': 'passwordHash'; '+': 'id' }` is a compile error.
4. Any other key is a relation of the current model, and its value is a nested spec that narrows the related model. To include a relation whole, name it in `'+'`. Naming a relation in `'+'` and also as a key at the same level is a compile error.
5. No `'+'` and no `'-'` means every scalar.
6. Relations are absent unless they appear in `'+'` or as a key.
7. Cardinality and nullability come from the model at every level: a to-many relation is `T[]`, a nullable to-one is `T | null`, a required to-one is `T`.

```ts
type A = Shape<User>;                                        // Scalars<User>
type B = Shape<User, { '+': 'posts' }>;                      // every scalar, plus posts
type C = Shape<User, { '+': 'id' | 'name' | 'posts' }>;      // id, name, and posts
type D = Shape<User, { '-': 'passwordHash'; '+': 'posts' }>; // every scalar but the hash, plus posts
type E = Shape<User, { posts: { '+': 'title' | 'comments' } }>; // posts narrowed to title, with their comments
type F = Shape<User, { '+': 'profile' }>['profile'];         // Scalars<Profile> | null
```

`Shape` refuses, at compile time: a name in `'+'` or `'-'` that is neither a scalar nor a relation of the model; a relation name in `'-'`; a relation key whose value is not an object; `'+'` naming a scalar beside `'-'`; and a relation both in `'+'` and as a key.

```ts
// @ts-expect-error 'posts' is a relation and cannot be dropped
type Bad1 = Shape<User, { '-': 'posts' }>;
// @ts-expect-error '+' names a scalar, so it cannot sit beside '-'
type Bad2 = Shape<User, { '+': 'id'; '-': 'name' }>;
// @ts-expect-error 'posts' cannot be both kept whole and narrowed
type Bad3 = Shape<User, { '+': 'posts'; posts: { '+': 'title' } }>;
```

`Shape` has no `where`, `orderBy`, `limit`, or aggregation. For renames and computed fields, compose with TypeScript: `Shape<User> & { postCount: number }`.

Over a polymorphic union, each variant keeps only the relations it declares. `Shape<Models.public_AnyTask, { '+': 'assignee' }>` adds `assignee` to `Bug` and `Feature`, which declare it, and leaves `Epic` as its scalars.

The rows the ORM returns are `Shape`s of the model. A plain `.include(r)` returns `Shape<M, { '+': 'r' }>`. A `.select(a, b)` projection returns `Shape<M, { '+': 'a' | 'b' }>`. A nested include returns a nested spec.

```ts
const withAuthor = db.orm.public.Post.include('author');
type PostWithAuthor = ResultType<typeof withAuthor>; // Shape<Models.public_Post, { '+': 'author' }>

const projected = db.orm.public.User.select('id', 'name');
type UserIdName = ResultType<typeof projected>; // Shape<Models.public_User, { '+': 'id' | 'name' }>

const narrowed = db.orm.public.User.include('posts', (posts) =>
  posts.select('id', 'title').include('author'),
);
type UserWithNarrowedPosts = ResultType<typeof narrowed>; // Shape<Models.public_User, { posts: { '+': 'id' | 'title' | 'author' } }>
```

One rule of the query builder is not in the type: a refined to-one include (`include('reviewer', (r) => r.where(...))`) is `| null` even on a required relation, because the refinement can exclude the row.

To name a model plus some of its relations, use `Shape`, not `Pick`. `Pick<Models.public_User, 'id' | 'posts'>` demands `posts: Models.public_Post[]` with every post carrying its own `author` and `comments`, and no query returns that. Write `Shape<Models.public_User, { '+': 'id' | 'posts' }>` instead.

## The result of any query

`ResultType<typeof query>` names the row of any ORM query value: a plain collection, an include, a projection, a refined include, or a `.variant()` narrowing. Each collection value has exactly one row type, and every terminal on it returns that row in some wrapper (`Row | null`, `Row[]`, an async iterable of `Row`). `typeof` needs a value, so bind the query to a name first.

```ts
type UserRow = ResultType<typeof db.orm.public.User>; // Scalars<Models.public_User>

const projected = db.orm.public.User.select('id');
type UserId = ResultType<typeof projected>; // { id: number }

const usersWithTasks = () => db.orm.public.User.include('tasks');
type UserWithTasks = ResultType<ReturnType<typeof usersWithTasks>>; // Shape<Models.public_User, { '+': 'tasks' }>
```

`ResultType` also works on SQL query lane plans; see [Query Patterns](./query-patterns.md#type-inference-with-resulttype).

## Input types

The ORM clients export the types that describe what you pass in. They take the contract type and the model name, so they need the `Contract` from `./prisma/contract` in scope.

- SQL, from `@prisma/orm-postgres/orm-client`: `CreateInput<Contract, 'User'>` for `create`, `MutationUpdateInput<Contract, 'User'>` for `update`, `ShorthandWhereFilter<Contract, 'public', 'User'>` for `where`, and `UniqueConstraintCriterion<Contract, 'User'>` for the unique lookup in `findUnique`-style calls.
- Mongo, from `@prisma/orm-mongo/orm`: `CreateInput<Contract, 'User'>` and `VariantCreateInput` for `create`, and `MongoWhereFilter<Contract, 'User'>` for `where`.

## Coming from Prisma 7

| Prisma 7 | Prisma 8 |
| --- | --- |
| `Prisma.User` | `Models.public_User` |
| `Prisma.UserGetPayload<{ include: { posts: true } }>` | `Shape<Models.public_User, { '+': 'posts' }>` |
| `Prisma.UserGetPayload<{ select: { id: true; posts: { select: { title: true } } } }>` | `Shape<Models.public_User, { '+': 'id'; posts: { '+': 'title' } }>` |
| `Prisma.UserCreateInput` | `CreateInput<Contract, 'User'>` |
| `Prisma.UserWhereInput` | `ShorthandWhereFilter<Contract, 'public', 'User'>` |
| `Awaited<ReturnType<typeof fn>>` | `ResultType<typeof query>` |

The one difference to notice first: in Prisma 7 the generated `User` was scalars only. In Prisma 8, `Models.public_User` carries every relation, and the scalars-only row is `Scalars<Models.public_User>`.

## References

- [ADR 250 — Models and views are emitted from the contract](../architecture%20docs/adrs/ADR%20250%20-%20Models%20and%20views%20are%20emitted%20from%20the%20contract.md)
- [Contract Emitter & Types](../architecture%20docs/subsystems/2.%20Contract%20Emitter%20%26%20Types.md)
- [Query Patterns](./query-patterns.md)
