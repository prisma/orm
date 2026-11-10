import { expectTypeOf, test } from 'vitest';
import { defineContract, field, model, rel } from '../../src/exports/contract-builder';
import postgres from '../../src/exports/runtime';

const int4 = { codecId: 'pg/int4@1' } as const;
const text = { codecId: 'pg/text@1' } as const;

const User = model('User', {
  fields: { id: field.column(int4).id(), email: field.column(text) },
});
const Post = model('Post', {
  fields: {
    id: field.column(int4).id(),
    title: field.column(text),
    authorId: field.column(int4),
    reviewerId: field.column(int4).optional(),
  },
});
const Profile = model('Profile', {
  fields: { id: field.column(int4).id(), userId: field.column(int4) },
});
const Tag = model('Tag', {
  fields: { id: field.column(int4).id(), label: field.column(text) },
});
const PostTag = model('PostTag', {
  fields: { postId: field.column(int4), tagId: field.column(int4) },
});
const Review = model('Review', {
  fields: {
    id: field.column(int4).id(),
    postId: field.column(int4),
    editorId: field.column(int4).optional(),
  },
});
const Employee = model('Employee', {
  fields: { id: field.column(int4).id(), managerId: field.column(int4).optional() },
});
const Session = model('Session', {
  namespace: 'auth',
  fields: { id: field.column(int4).id(), userId: field.column(int4) },
});

const contract = defineContract({
  namespaces: ['auth'],
  models: {
    User: User.relations({
      posts: rel.hasMany(Post, { by: 'authorId' }),
      profile: rel.hasOne(Profile, { by: 'userId' }),
      sessions: rel.hasMany(Session, { by: 'userId' }),
    }).sql({ table: 'users' }),
    Post: Post.relations({
      author: rel.belongsTo(User, { from: 'authorId', to: 'id' }),
      reviewer: rel.belongsTo(User, { from: 'reviewerId', to: 'id' }),
      tags: rel.manyToMany(Tag, { through: PostTag, from: 'postId', to: 'tagId' }),
    }).sql({ table: 'posts' }),
    Profile: Profile.sql({ table: 'profiles' }),
    Tag: Tag.sql({ table: 'tags' }),
    PostTag: PostTag.sql({ table: 'post_tags' }),
    Review: Review.relations({
      post: rel.belongsTo(Post, { from: 'postId', to: 'id', optional: false }),
      editor: rel.belongsTo(User, { from: 'editorId', to: 'id', optional: true }),
    }).sql({ table: 'reviews' }),
    Employee: Employee.relations({
      manager: rel.belongsTo(Employee, { from: 'managerId', to: 'id' }),
      reports: rel.hasMany(Employee, { by: 'managerId' }),
    }).sql({ table: 'employees' }),
    Session: Session.relations({
      user: rel.belongsTo(User, { from: 'userId', to: 'id' }),
    }).sql({ table: 'sessions' }),
  },
});

const db = postgres({ contract, url: 'postgres://localhost/db' });

type UserRow = { id: number; email: string };
type PostRow = { id: number; title: string; authorId: number; reviewerId: number | null };
type ProfileRow = { id: number; userId: number };
type TagRow = { id: number; label: string };
type EmployeeRow = { id: number; managerId: number | null };
type SessionRow = { id: number; userId: number };

test('a has-many include is an array of the target rows', async () => {
  const user = await db.orm.public.User.include('posts').first();
  expectTypeOf(user).toEqualTypeOf<{ id: number; email: string; posts: PostRow[] } | null>();
});

test('a required belongs-to include is one row', async () => {
  const post = await db.orm.public.Post.include('author').first();
  expectTypeOf(post).toEqualTypeOf<{
    id: number;
    title: string;
    authorId: number;
    reviewerId: number | null;
    author: UserRow;
  } | null>();
});

test('an optional belongs-to include is one row or null', async () => {
  const post = await db.orm.public.Post.include('reviewer').first();
  expectTypeOf(post).toEqualTypeOf<{
    id: number;
    title: string;
    authorId: number;
    reviewerId: number | null;
    reviewer: UserRow | null;
  } | null>();
});

test('a has-one include is one row or null', async () => {
  const user = await db.orm.public.User.include('profile').first();
  expectTypeOf(user).toEqualTypeOf<{
    id: number;
    email: string;
    profile: ProfileRow | null;
  } | null>();
});

test('a many-to-many include is an array of the target rows', async () => {
  const post = await db.orm.public.Post.include('tags').first();
  expectTypeOf(post).toEqualTypeOf<{
    id: number;
    title: string;
    authorId: number;
    reviewerId: number | null;
    tags: TagRow[];
  } | null>();
});

test('a nested include types the rows at every level', async () => {
  const user = await db.orm.public.User.include('posts', (posts) => posts.include('tags')).first();
  expectTypeOf(user).toEqualTypeOf<{
    id: number;
    email: string;
    posts: {
      id: number;
      title: string;
      authorId: number;
      reviewerId: number | null;
      tags: TagRow[];
    }[];
  } | null>();
});

test('a select inside an include narrows the included rows', async () => {
  const user = await db.orm.public.User.include('posts', (posts) => posts.select('title')).first();
  expectTypeOf(user).toEqualTypeOf<{
    id: number;
    email: string;
    posts: { title: string }[];
  } | null>();
});

test('a self-relation includes rows of the same model', async () => {
  const employee = await db.orm.public.Employee.include('manager').include('reports').first();
  expectTypeOf(employee).toEqualTypeOf<{
    id: number;
    managerId: number | null;
    manager: EmployeeRow | null;
    reports: EmployeeRow[];
  } | null>();
});

test('an include of a model in another namespace types its rows', async () => {
  const user = await db.orm.public.User.include('sessions').first();
  expectTypeOf(user).toEqualTypeOf<{ id: number; email: string; sessions: SessionRow[] } | null>();
  const session = await db.orm.auth.Session.include('user').first();
  expectTypeOf(session).toEqualTypeOf<{ id: number; userId: number; user: UserRow } | null>();
});

test('a belongs-to declared optional: false is one row', async () => {
  const review = await db.orm.public.Review.include('post').first();
  expectTypeOf(review).toEqualTypeOf<{
    id: number;
    postId: number;
    editorId: number | null;
    post: PostRow;
  } | null>();
});

test('a belongs-to declared optional: true is one row or null', async () => {
  const review = await db.orm.public.Review.include('editor').first();
  expectTypeOf(review).toEqualTypeOf<{
    id: number;
    postId: number;
    editorId: number | null;
    editor: UserRow | null;
  } | null>();
});
