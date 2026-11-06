import { expectTypeOf, test } from 'vitest';
import { defineContract, field, model, rel } from '../../src/exports/contract-builder';
import sqlite from '../../src/exports/runtime';

const integer = { codecId: 'sqlite/integer@1' } as const;
const text = { codecId: 'sqlite/text@1' } as const;

const User = model('User', {
  fields: { id: field.column(integer).id(), email: field.column(text) },
});
const Post = model('Post', {
  fields: {
    id: field.column(integer).id(),
    title: field.column(text),
    authorId: field.column(integer),
    reviewerId: field.column(integer).optional(),
  },
});
const Profile = model('Profile', {
  fields: { id: field.column(integer).id(), userId: field.column(integer) },
});
const Tag = model('Tag', {
  fields: { id: field.column(integer).id(), label: field.column(text) },
});
const PostTag = model('PostTag', {
  fields: { postId: field.column(integer), tagId: field.column(integer) },
});
const Review = model('Review', {
  fields: {
    id: field.column(integer).id(),
    postId: field.column(integer),
    editorId: field.column(integer).optional(),
  },
});
const Employee = model('Employee', {
  fields: { id: field.column(integer).id(), managerId: field.column(integer).optional() },
});

const contract = defineContract({
  models: {
    User: User.relations({
      posts: rel.hasMany(Post, { by: 'authorId' }),
      profile: rel.hasOne(Profile, { by: 'userId' }),
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
  },
});

const db = sqlite({ contract, path: ':memory:', verifyMarker: false });

type UserRow = { id: number; email: string };
type PostRow = { id: number; title: string; authorId: number; reviewerId: number | null };
type ProfileRow = { id: number; userId: number };
type TagRow = { id: number; label: string };
type EmployeeRow = { id: number; managerId: number | null };

test('a has-many include is an array of the target rows', async () => {
  const user = await db.orm.User.include('posts').first();
  expectTypeOf(user).toEqualTypeOf<{ id: number; email: string; posts: PostRow[] } | null>();
});

test('a required belongs-to include is one row', async () => {
  const post = await db.orm.Post.include('author').first();
  expectTypeOf(post).toEqualTypeOf<{
    id: number;
    title: string;
    authorId: number;
    reviewerId: number | null;
    author: UserRow;
  } | null>();
});

test('an optional belongs-to include is one row or null', async () => {
  const post = await db.orm.Post.include('reviewer').first();
  expectTypeOf(post).toEqualTypeOf<{
    id: number;
    title: string;
    authorId: number;
    reviewerId: number | null;
    reviewer: UserRow | null;
  } | null>();
});

test('a has-one include is one row or null', async () => {
  const user = await db.orm.User.include('profile').first();
  expectTypeOf(user).toEqualTypeOf<{
    id: number;
    email: string;
    profile: ProfileRow | null;
  } | null>();
});

test('a many-to-many include is an array of the target rows', async () => {
  const post = await db.orm.Post.include('tags').first();
  expectTypeOf(post).toEqualTypeOf<{
    id: number;
    title: string;
    authorId: number;
    reviewerId: number | null;
    tags: TagRow[];
  } | null>();
});

test('a nested include types the rows at every level', async () => {
  const user = await db.orm.User.include('posts', (posts) => posts.include('tags')).first();
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
  const user = await db.orm.User.include('posts', (posts) => posts.select('title')).first();
  expectTypeOf(user).toEqualTypeOf<{
    id: number;
    email: string;
    posts: { title: string }[];
  } | null>();
});

test('a self-relation includes rows of the same model', async () => {
  const employee = await db.orm.Employee.include('manager').include('reports').first();
  expectTypeOf(employee).toEqualTypeOf<{
    id: number;
    managerId: number | null;
    manager: EmployeeRow | null;
    reports: EmployeeRow[];
  } | null>();
});

test('a belongs-to declared optional: false is one row', async () => {
  const review = await db.orm.Review.include('post').first();
  expectTypeOf(review).toEqualTypeOf<{
    id: number;
    postId: number;
    editorId: number | null;
    post: PostRow;
  } | null>();
});

test('a belongs-to declared optional: true is one row or null', async () => {
  const review = await db.orm.Review.include('editor').first();
  expectTypeOf(review).toEqualTypeOf<{
    id: number;
    postId: number;
    editorId: number | null;
    editor: UserRow | null;
  } | null>();
});
