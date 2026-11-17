import { describe, expectTypeOf, test } from 'vitest';
import type { RelationKeys, Scalars, Shape, ShapeSpec } from '../src/execution/shape';

type Post = {
  id: number;
  title: string;
  authorId: number;
  author: User;
  comments: Comment[];
  readonly [RelationKeys]?: 'author' | 'comments';
};

type Comment = {
  id: number;
  body: string;
  post: Post;
  readonly [RelationKeys]?: 'post';
};

type Profile = {
  id: number;
  bio: string | null;
  readonly [RelationKeys]?: never;
};

type User = {
  id: number;
  name: string;
  posts: Post[];
  profile: Profile | null;
  manager: User;
  readonly [RelationKeys]?: 'posts' | 'profile' | 'manager';
};

type Bug = {
  id: number;
  type: 'bug';
  severity: string;
  reporter: User;
  assignee: User | null;
  readonly [RelationKeys]?: 'reporter' | 'assignee';
};

type Feature = {
  id: number;
  type: 'feature';
  priority: number;
  owner: User;
  readonly [RelationKeys]?: 'owner';
};

type Chore = {
  id: number;
  type: 'chore';
  readonly [RelationKeys]?: never;
};

type AnyTask = Bug | Feature | Chore;

describe('Scalars', () => {
  test('strips relation keys and the phantom', () => {
    expectTypeOf<Scalars<User>>().toEqualTypeOf<{ id: number; name: string }>();
  });

  test('keeps every field when the model has no relations', () => {
    expectTypeOf<Scalars<Profile>>().toEqualTypeOf<{ id: number; bio: string | null }>();
  });

  test('distributes over a union', () => {
    expectTypeOf<Scalars<AnyTask>>().toEqualTypeOf<
      | { id: number; type: 'bug'; severity: string }
      | { id: number; type: 'feature'; priority: number }
      | { id: number; type: 'chore' }
    >();
  });

  test('passes a type without the phantom through unchanged', () => {
    expectTypeOf<Scalars<{ id: number }>>().toEqualTypeOf<{ id: number }>();
  });
});

describe('Shape', () => {
  type UserRow = { id: number; name: string };
  type PostRow = { id: number; title: string; authorId: number };

  test('the empty spec is Scalars: every scalar, no relations', () => {
    expectTypeOf<Shape<User, Record<never, never>>>().not.toBeAny();
    expectTypeOf<Shape<User, Record<never, never>>>().toEqualTypeOf<Scalars<User>>();
    expectTypeOf<Shape<User, Record<never, never>>>().toEqualTypeOf<UserRow>();
    expectTypeOf<Shape<User>>().toEqualTypeOf<Scalars<User>>();
    expectTypeOf<Shape<Profile>>().toEqualTypeOf<Scalars<Profile>>();
    expectTypeOf<Shape<Profile, Record<never, never>>>().toEqualTypeOf<{
      id: number;
      bio: string | null;
    }>();
  });

  test("a relation named in '+' alone is every scalar plus that relation, flattened", () => {
    expectTypeOf<Shape<User, { '+': 'posts' }>>().toEqualTypeOf<{
      id: number;
      name: string;
      posts: PostRow[];
    }>();
    type Intersection = Scalars<User> & { posts: Scalars<Post>[] };
    expectTypeOf<Shape<User, { '+': 'posts' }>>().toEqualTypeOf<{
      [K in keyof Intersection]: Intersection[K];
    }>();
    expectTypeOf<Shape<User, { '+': 'posts' }>['posts'][number]>().not.toHaveProperty('author');
    expectTypeOf<Shape<User, { '+': 'posts' | 'profile' }>>().toEqualTypeOf<{
      id: number;
      name: string;
      posts: PostRow[];
      profile: { id: number; bio: string | null } | null;
    }>();
  });

  test('cardinality and nullability come from the model field', () => {
    expectTypeOf<Shape<User, { '+': 'posts' }>['posts']>().toEqualTypeOf<PostRow[]>();
    expectTypeOf<Shape<User, { '+': 'profile' }>['profile']>().toEqualTypeOf<{
      id: number;
      bio: string | null;
    } | null>();
    expectTypeOf<Shape<User, { '+': 'manager' }>['manager']>().toEqualTypeOf<UserRow>();
  });

  test('a self relation is one level of the same model', () => {
    expectTypeOf<Shape<User, { manager: { '+': 'manager' } }>>().toEqualTypeOf<{
      id: number;
      name: string;
      manager: { id: number; name: string; manager: UserRow };
    }>();
  });

  test("'+' naming a scalar keeps only the named scalars", () => {
    expectTypeOf<Shape<User, { '+': 'id' }>>().toEqualTypeOf<{ id: number }>();
    expectTypeOf<Shape<Post, { '+': 'id' | 'title' }>>().toEqualTypeOf<{
      id: number;
      title: string;
    }>();
  });

  test("'+' naming a scalar and a relation keeps the named scalars and the relation", () => {
    expectTypeOf<Shape<User, { '+': 'id' | 'posts' }>>().toEqualTypeOf<{
      id: number;
      posts: PostRow[];
    }>();
    expectTypeOf<Shape<User, { '+': 'id' | 'name' | 'posts' }>>().toEqualTypeOf<{
      id: number;
      name: string;
      posts: PostRow[];
    }>();
  });

  test("'-' drops the named scalars and keeps every other scalar", () => {
    expectTypeOf<Shape<Post, { '-': 'authorId' }>>().toEqualTypeOf<{ id: number; title: string }>();
    expectTypeOf<Shape<Post, { '-': 'authorId' | 'title' }>>().toEqualTypeOf<{ id: number }>();
  });

  test("'-' beside a '+' that names only relations drops the scalars and adds the relations", () => {
    expectTypeOf<Shape<User, { '-': 'name'; '+': 'posts' }>>().toEqualTypeOf<{
      id: number;
      posts: PostRow[];
    }>();
  });

  test("'-' with a relation key drops the scalars and narrows the relation", () => {
    expectTypeOf<Shape<User, { '-': 'name'; posts: { '+': 'title' } }>>().toEqualTypeOf<{
      id: number;
      posts: { title: string }[];
    }>();
  });

  test("'+' with a relation key keeps the named scalars and narrows the relation", () => {
    expectTypeOf<Shape<User, { '+': 'id'; posts: { '-': 'authorId' } }>>().toEqualTypeOf<{
      id: number;
      posts: { id: number; title: string }[];
    }>();
  });

  test('a relation key narrows the related model', () => {
    expectTypeOf<Shape<User, { posts: { '+': 'title' } }>>().toEqualTypeOf<{
      id: number;
      name: string;
      posts: { title: string }[];
    }>();
    expectTypeOf<Shape<User, { posts: { '+': 'title' | 'comments' } }>>().toEqualTypeOf<{
      id: number;
      name: string;
      posts: { title: string; comments: { id: number; body: string }[] }[];
    }>();
    expectTypeOf<
      Shape<User, { posts: { '-': 'authorId'; author: { '+': 'name' } } }>
    >().toEqualTypeOf<{
      id: number;
      name: string;
      posts: { id: number; title: string; author: { name: string } }[];
    }>();
  });

  test('relations are absent unless asked for', () => {
    expectTypeOf<keyof Shape<User, Record<never, never>>>().toEqualTypeOf<'id' | 'name'>();
    expectTypeOf<keyof Shape<User, { '+': 'posts' }>>().toEqualTypeOf<'id' | 'name' | 'posts'>();
    expectTypeOf<keyof Shape<User, { posts: { '+': 'id' } }>>().toEqualTypeOf<
      'id' | 'name' | 'posts'
    >();
    expectTypeOf<keyof Shape<User, { '-': 'name' }>>().toEqualTypeOf<'id'>();
  });

  test('hover text is one flat object, not an intersection', () => {
    type Flat = { id: number; name: string; posts: PostRow[] };
    expectTypeOf<Shape<User, { '+': 'posts' }>>().toEqualTypeOf<{
      [K in keyof Flat]: Flat[K];
    }>();
  });

  test('distributes over a union so each variant keeps only its own relations', () => {
    expectTypeOf<Shape<AnyTask, { '+': 'reporter' }>>().toEqualTypeOf<
      | { id: number; type: 'bug'; severity: string; reporter: UserRow }
      | { id: number; type: 'feature'; priority: number }
      | { id: number; type: 'chore' }
    >();
    expectTypeOf<Shape<AnyTask, { '+': 'reporter' | 'owner' }>>().toEqualTypeOf<
      | { id: number; type: 'bug'; severity: string; reporter: UserRow }
      | { id: number; type: 'feature'; priority: number; owner: UserRow }
      | { id: number; type: 'chore' }
    >();
    expectTypeOf<Shape<AnyTask, { '+': 'assignee' }>>().toEqualTypeOf<
      | { id: number; type: 'bug'; severity: string; assignee: UserRow | null }
      | { id: number; type: 'feature'; priority: number }
      | { id: number; type: 'chore' }
    >();
    expectTypeOf<
      Extract<Shape<AnyTask, { '+': 'assignee' }>, { type: 'chore' }>
    >().not.toHaveProperty('assignee');
    expectTypeOf<Shape<AnyTask, { reporter: { '+': 'id' } }>>().toEqualTypeOf<
      | { id: number; type: 'bug'; severity: string; reporter: { id: number } }
      | { id: number; type: 'feature'; priority: number }
      | { id: number; type: 'chore' }
    >();
  });

  test("'+' and '-' over a union name scalars of any variant", () => {
    expectTypeOf<Shape<AnyTask, { '+': 'id' | 'severity' | 'owner' }>>().toEqualTypeOf<
      { id: number; severity: string } | { id: number; owner: UserRow } | { id: number }
    >();
    expectTypeOf<Shape<AnyTask, { '-': 'severity' | 'priority' }>>().toEqualTypeOf<
      { id: number; type: 'bug' } | { id: number; type: 'feature' } | { id: number; type: 'chore' }
    >();
  });

  test('the Shape of a model is assignable from the rows a query returns', () => {
    type Response = Shape<User, { '-': 'name'; posts: { '+': 'id' | 'title' | 'comments' } }>;
    const fromRow = (
      row: UserRow & { posts: (PostRow & { comments: { id: number; body: string }[] })[] },
    ): Response => {
      const { name: _name, ...rest } = row;
      return {
        ...rest,
        posts: row.posts.map(({ id, title, comments }) => ({ id, title, comments })),
      };
    };
    expectTypeOf(fromRow).returns.toEqualTypeOf<{
      id: number;
      posts: { id: number; title: string; comments: { id: number; body: string }[] }[];
    }>();
    // @ts-expect-error the body omits posts, which the shape declares
    const missingRelation = (row: UserRow): Response => row;
    expectTypeOf(missingRelation).returns.toEqualTypeOf<Response>();
  });

  test('ShapeSpec constrains a generic that forwards its spec to Shape', () => {
    type UserShape<S extends ShapeSpec<User, S>> = Shape<User, S>;
    expectTypeOf<UserShape<{ '+': 'posts' }>>().toEqualTypeOf<{
      id: number;
      name: string;
      posts: PostRow[];
    }>();
    expectTypeOf<UserShape<{ '+': 'id'; manager: { '-': 'name' } }>>().toEqualTypeOf<{
      id: number;
      manager: { id: number };
    }>();
  });

  test('an unknown key is constrained to a message naming the valid keys', () => {
    expectTypeOf<ShapeSpec<User, { nope: Record<never, never> }>['nope']>().toEqualTypeOf<
      | "'nope' is not a relation of the model; try '+', '-', or 'posts'"
      | "'nope' is not a relation of the model; try '+', '-', or 'profile'"
      | "'nope' is not a relation of the model; try '+', '-', or 'manager'"
    >();
    expectTypeOf<
      ShapeSpec<Profile, { nope: Record<never, never> }>['nope']
    >().toEqualTypeOf<"'nope' is not a relation of the model, which has none; try '+' or '-'">();
  });

  test("refuses a name in '+' that is neither a scalar nor a relation", () => {
    // @ts-expect-error 'nope' is not a field of User
    type _Bad = Shape<User, { '+': 'nope' }>;
    // @ts-expect-error 'nope' is not a field of User even beside a valid name
    type _Mixed = Shape<User, { '+': 'id' | 'nope' }>;
  });

  test("refuses a name in '-' that is not a scalar", () => {
    // @ts-expect-error 'nope' is not a field of User
    type _Bad = Shape<User, { '-': 'nope' }>;
  });

  test("refuses a relation name in '-'", () => {
    // @ts-expect-error 'posts' is a relation and cannot be dropped
    type _Bad = Shape<User, { '-': 'posts' }>;
  });

  test('refuses a relation key whose value is not an object', () => {
    // @ts-expect-error a relation value must be a nested spec
    type _True = Shape<User, { posts: true }>;
    // @ts-expect-error a relation value must be a nested spec
    type _String = Shape<User, { posts: 'title' }>;
  });

  test('refuses a key that is neither a relation nor a sigil', () => {
    // @ts-expect-error 'name' is a scalar, not a relation
    type _Scalar = Shape<User, { name: Record<never, never> }>;
    // @ts-expect-error 'nope' is not a relation of User
    type _Missing = Shape<User, { nope: Record<never, never> }>;
    // @ts-expect-error 'posts' is not a relation of any AnyTask member
    type _Union = Shape<AnyTask, { posts: Record<never, never> }>;
  });

  test("refuses '+' naming a scalar beside '-' at the same level", () => {
    // @ts-expect-error '+' names a scalar, so it cannot sit beside '-'
    type _Both = Shape<User, { '+': 'id'; '-': 'name' }>;
    // @ts-expect-error '+' names a scalar beside a relation, so it cannot sit beside '-'
    type _Mixed = Shape<User, { '-': 'name'; '+': 'id' | 'posts' }>;
  });

  test("refuses a relation both in '+' and as a key at the same level", () => {
    // @ts-expect-error 'posts' cannot be both kept whole and narrowed
    type _Both = Shape<User, { '+': 'posts'; posts: { '+': 'title' } }>;
    // @ts-expect-error 'posts' cannot be both kept whole and narrowed
    type _WithScalars = Shape<User, { '+': 'id' | 'posts'; posts: { '+': 'title' } }>;
  });

  test('refuses every rule at a nested level too', () => {
    // @ts-expect-error 'nope' is not a field of Post
    type _Plus = Shape<User, { posts: { '+': 'nope' } }>;
    // @ts-expect-error 'author' is a relation of Post and cannot be dropped
    type _Minus = Shape<User, { posts: { '-': 'author' } }>;
    // @ts-expect-error 'nope' is not a relation of Post
    type _Key = Shape<User, { posts: { nope: Record<never, never> } }>;
    // @ts-expect-error '+' names a scalar, so it cannot sit beside '-'
    type _Both = Shape<User, { posts: { '+': 'id'; '-': 'title' } }>;
    // @ts-expect-error a relation value must be a nested spec
    type _Value = Shape<User, { posts: { comments: true } }>;
    // @ts-expect-error 'author' cannot be both kept whole and narrowed
    type _Twice = Shape<User, { posts: { '+': 'author'; author: { '+': 'id' } } }>;
  });
});
