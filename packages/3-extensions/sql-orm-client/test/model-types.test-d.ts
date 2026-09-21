import type { AsyncIterableResult, ResultType } from '@internal/framework-components/runtime';
import type { Scalars, Shape } from '@internal/sql-contract/types';
import { expectTypeOf, test } from 'vitest';
import type {
  Contract as PolyContract,
  Models as PolyModels,
} from '../../../../test/integration/test/sql-orm-client/fixtures/polymorphism/generated/contract';
import type { Collection } from '../src/collection';
import type { DefaultModelRow, VariantModelRow } from '../src/types';
import type { Contract, Models } from './fixtures/generated/contract';

declare const db: {
  Article: Collection<Contract, 'Article'>;
  Comment: Collection<Contract, 'Comment'>;
  Post: Collection<Contract, 'Post'>;
  Profile: Collection<Contract, 'Profile'>;
  Project: Collection<Contract, 'Project'>;
  ProjectLink: Collection<Contract, 'ProjectLink'>;
  Role: Collection<Contract, 'Role'>;
  Tag: Collection<Contract, 'Tag'>;
  User: Collection<Contract, 'User'>;
  UserRole: Collection<Contract, 'UserRole'>;
  UserTag: Collection<Contract, 'UserTag'>;
};

declare const poly: {
  Account: Collection<PolyContract, 'Account'>;
  Person: Collection<PolyContract, 'Person'>;
  Project: Collection<PolyContract, 'Project'>;
  Task: Collection<PolyContract, 'Task'>;
  TaskComment: Collection<PolyContract, 'TaskComment'>;
  Ticket: Collection<PolyContract, 'Ticket'>;
  User: Collection<PolyContract, 'User'>;
};

test('DefaultModelRow equals Scalars of the emitted model for every non-polymorphic model', () => {
  expectTypeOf<DefaultModelRow<Contract, 'Article'>>().toEqualTypeOf<
    Scalars<Models.public_Article>
  >();
  expectTypeOf<DefaultModelRow<Contract, 'Comment'>>().toEqualTypeOf<
    Scalars<Models.public_Comment>
  >();
  expectTypeOf<DefaultModelRow<Contract, 'Post'>>().toEqualTypeOf<Scalars<Models.public_Post>>();
  expectTypeOf<DefaultModelRow<Contract, 'Profile'>>().toEqualTypeOf<
    Scalars<Models.public_Profile>
  >();
  expectTypeOf<DefaultModelRow<Contract, 'Project'>>().toEqualTypeOf<
    Scalars<Models.public_Project>
  >();
  expectTypeOf<DefaultModelRow<Contract, 'ProjectLink'>>().toEqualTypeOf<
    Scalars<Models.public_ProjectLink>
  >();
  expectTypeOf<DefaultModelRow<Contract, 'Role'>>().toEqualTypeOf<Scalars<Models.public_Role>>();
  expectTypeOf<DefaultModelRow<Contract, 'Tag'>>().toEqualTypeOf<Scalars<Models.public_Tag>>();
  expectTypeOf<DefaultModelRow<Contract, 'User'>>().toEqualTypeOf<Scalars<Models.public_User>>();
  expectTypeOf<DefaultModelRow<Contract, 'UserRole'>>().toEqualTypeOf<
    Scalars<Models.public_UserRole>
  >();
  expectTypeOf<DefaultModelRow<Contract, 'UserTag'>>().toEqualTypeOf<
    Scalars<Models.public_UserTag>
  >();

  expectTypeOf<DefaultModelRow<PolyContract, 'Account'>>().toEqualTypeOf<
    Scalars<PolyModels.public_Account>
  >();
  expectTypeOf<DefaultModelRow<PolyContract, 'Person'>>().toEqualTypeOf<
    Scalars<PolyModels.public_Person>
  >();
  expectTypeOf<DefaultModelRow<PolyContract, 'Project'>>().toEqualTypeOf<
    Scalars<PolyModels.public_Project>
  >();
  expectTypeOf<DefaultModelRow<PolyContract, 'TaskComment'>>().toEqualTypeOf<
    Scalars<PolyModels.public_TaskComment>
  >();
  expectTypeOf<DefaultModelRow<PolyContract, 'Ticket'>>().toEqualTypeOf<
    Scalars<PolyModels.public_Ticket>
  >();
});

test('VariantModelRow equals Scalars of the emitted variant member', () => {
  expectTypeOf<VariantModelRow<PolyContract, 'Task', 'Bug'>>().toEqualTypeOf<
    Scalars<PolyModels.public_Bug>
  >();
  expectTypeOf<VariantModelRow<PolyContract, 'Task', 'Feature'>>().toEqualTypeOf<
    Scalars<PolyModels.public_Feature>
  >();
  expectTypeOf<VariantModelRow<PolyContract, 'Task', 'Epic'>>().toEqualTypeOf<
    Scalars<PolyModels.public_Epic>
  >();
  expectTypeOf<VariantModelRow<PolyContract, 'User', 'Admin'>>().toEqualTypeOf<
    Scalars<PolyModels.public_Admin>
  >();
  expectTypeOf<VariantModelRow<PolyContract, 'User', 'Regular'>>().toEqualTypeOf<
    Scalars<PolyModels.public_Regular>
  >();
});

test('ResultType of a root collection equals Scalars of the emitted model and is not never', () => {
  expectTypeOf<ResultType<typeof db.Article>>().toEqualTypeOf<Scalars<Models.public_Article>>();
  expectTypeOf<ResultType<typeof db.Comment>>().toEqualTypeOf<Scalars<Models.public_Comment>>();
  expectTypeOf<ResultType<typeof db.Post>>().toEqualTypeOf<Scalars<Models.public_Post>>();
  expectTypeOf<ResultType<typeof db.Profile>>().toEqualTypeOf<Scalars<Models.public_Profile>>();
  expectTypeOf<ResultType<typeof db.Project>>().toEqualTypeOf<Scalars<Models.public_Project>>();
  expectTypeOf<ResultType<typeof db.ProjectLink>>().toEqualTypeOf<
    Scalars<Models.public_ProjectLink>
  >();
  expectTypeOf<ResultType<typeof db.Role>>().toEqualTypeOf<Scalars<Models.public_Role>>();
  expectTypeOf<ResultType<typeof db.Tag>>().toEqualTypeOf<Scalars<Models.public_Tag>>();
  expectTypeOf<ResultType<typeof db.User>>().toEqualTypeOf<Scalars<Models.public_User>>();
  expectTypeOf<ResultType<typeof db.UserRole>>().toEqualTypeOf<Scalars<Models.public_UserRole>>();
  expectTypeOf<ResultType<typeof db.UserTag>>().toEqualTypeOf<Scalars<Models.public_UserTag>>();
  expectTypeOf<ResultType<typeof db.User>>().not.toBeNever();

  expectTypeOf<ResultType<typeof poly.Account>>().toEqualTypeOf<
    Scalars<PolyModels.public_Account>
  >();
  expectTypeOf<ResultType<typeof poly.Person>>().toEqualTypeOf<Scalars<PolyModels.public_Person>>();
  expectTypeOf<ResultType<typeof poly.Project>>().toEqualTypeOf<
    Scalars<PolyModels.public_Project>
  >();
  expectTypeOf<ResultType<typeof poly.TaskComment>>().toEqualTypeOf<
    Scalars<PolyModels.public_TaskComment>
  >();
  expectTypeOf<ResultType<typeof poly.Ticket>>().toEqualTypeOf<Scalars<PolyModels.public_Ticket>>();
});

test('ResultType of a bare collection equals Shape of the emitted model with the default spec, for every model', () => {
  expectTypeOf<ResultType<typeof db.Article>>().toEqualTypeOf<Shape<Models.public_Article>>();
  expectTypeOf<ResultType<typeof db.Comment>>().toEqualTypeOf<Shape<Models.public_Comment>>();
  expectTypeOf<ResultType<typeof db.Post>>().toEqualTypeOf<Shape<Models.public_Post>>();
  expectTypeOf<ResultType<typeof db.Profile>>().toEqualTypeOf<Shape<Models.public_Profile>>();
  expectTypeOf<ResultType<typeof db.Project>>().toEqualTypeOf<Shape<Models.public_Project>>();
  expectTypeOf<ResultType<typeof db.ProjectLink>>().toEqualTypeOf<
    Shape<Models.public_ProjectLink>
  >();
  expectTypeOf<ResultType<typeof db.Role>>().toEqualTypeOf<Shape<Models.public_Role>>();
  expectTypeOf<ResultType<typeof db.Tag>>().toEqualTypeOf<Shape<Models.public_Tag>>();
  expectTypeOf<ResultType<typeof db.User>>().toEqualTypeOf<Shape<Models.public_User>>();
  expectTypeOf<ResultType<typeof db.UserRole>>().toEqualTypeOf<Shape<Models.public_UserRole>>();
  expectTypeOf<ResultType<typeof db.UserTag>>().toEqualTypeOf<Shape<Models.public_UserTag>>();

  expectTypeOf<ResultType<typeof poly.Account>>().toEqualTypeOf<Shape<PolyModels.public_Account>>();
  expectTypeOf<ResultType<typeof poly.Person>>().toEqualTypeOf<Shape<PolyModels.public_Person>>();
  expectTypeOf<ResultType<typeof poly.Project>>().toEqualTypeOf<Shape<PolyModels.public_Project>>();
  expectTypeOf<ResultType<typeof poly.Task>>().toEqualTypeOf<Shape<PolyModels.public_AnyTask>>();
  expectTypeOf<ResultType<typeof poly.TaskComment>>().toEqualTypeOf<
    Shape<PolyModels.public_TaskComment>
  >();
  expectTypeOf<ResultType<typeof poly.Ticket>>().toEqualTypeOf<Shape<PolyModels.public_Ticket>>();
  expectTypeOf<ResultType<typeof poly.User>>().toEqualTypeOf<Shape<PolyModels.public_AnyUser>>();
});

test("ResultType of a to-one include equals Shape with the relation in '+'", () => {
  const withAuthor = db.Post.include('author');
  expectTypeOf<ResultType<typeof withAuthor>>().toEqualTypeOf<
    Shape<Models.public_Post, { '+': 'author' }>
  >();
});

test("ResultType of a to-many include equals Shape with the relation in '+'", () => {
  const withComments = db.Post.include('comments');
  expectTypeOf<ResultType<typeof withComments>>().toEqualTypeOf<
    Shape<Models.public_Post, { '+': 'comments' }>
  >();
});

test('Shape is the hand-written Scalars intersection, flattened into one object', () => {
  type PostWithComments = Scalars<Models.public_Post> & {
    comments: Scalars<Models.public_Comment>[];
  };
  expectTypeOf<Shape<Models.public_Post, { '+': 'comments' }>>().toExtend<PostWithComments>();
  expectTypeOf<PostWithComments>().toExtend<Shape<Models.public_Post, { '+': 'comments' }>>();
  expectTypeOf<Shape<Models.public_Post, { '+': 'comments' }>>().toEqualTypeOf<{
    [K in keyof PostWithComments]: PostWithComments[K];
  }>();
});

test('ResultType of a nullable to-one include equals Shape', () => {
  const withInviter = db.User.include('invitedBy');
  expectTypeOf<ResultType<typeof withInviter>>().toEqualTypeOf<
    Shape<Models.public_User, { '+': 'invitedBy' }>
  >();
});

test('ResultType of a to-one include on a required field equals Shape and is not nullable', () => {
  const withReviewer = db.Article.include('reviewer');
  expectTypeOf<ResultType<typeof withReviewer>>().toEqualTypeOf<
    Shape<Models.public_Article, { '+': 'reviewer' }>
  >();
  expectTypeOf<Models.public_Article['reviewer']>().toEqualTypeOf<Models.public_User>();
});

test("ResultType of a select projection equals Shape with '+'", () => {
  const projected = db.User.select('id', 'name');
  expectTypeOf<ResultType<typeof projected>>().toEqualTypeOf<
    Shape<Models.public_User, { '+': 'id' | 'name' }>
  >();
});

test("ResultType of a select plus include equals Shape with both in '+'", () => {
  const projectedWithComments = db.Post.select('id', 'title').include('comments');
  expectTypeOf<ResultType<typeof projectedWithComments>>().toEqualTypeOf<
    Shape<Models.public_Post, { '+': 'id' | 'title' | 'comments' }>
  >();
});

test('ResultType of a nested include equals a nested Shape spec', () => {
  const usersWithPostComments = db.User.include('posts', (posts) => posts.include('comments'));
  expectTypeOf<ResultType<typeof usersWithPostComments>>().toEqualTypeOf<
    Shape<Models.public_User, { posts: { '+': 'comments' } }>
  >();
  const narrowed = db.User.include('posts', (posts) =>
    posts.select('id', 'title').include('author'),
  );
  expectTypeOf<ResultType<typeof narrowed>>().toEqualTypeOf<
    Shape<Models.public_User, { posts: { '+': 'id' | 'title' | 'author' } }>
  >();
});

test('ResultType of a select projection is the projected shape', () => {
  const projected = db.User.select('id');
  expectTypeOf<ResultType<typeof projected>>().toEqualTypeOf<{ id: number }>();
});

test('a refined nullable to-one include equals a nested Shape spec', () => {
  const refined = db.User.include('invitedBy', (inviter) => inviter.select('id'));
  expectTypeOf<ResultType<typeof refined>>().toEqualTypeOf<
    Shape<Models.public_User, { invitedBy: { '+': 'id' } }>
  >();
});

test('a refined to-one include is nullable even when the relation is not', () => {
  const refined = db.Article.include('reviewer', (reviewer) => reviewer.where({ id: 1 }));
  expectTypeOf<
    ResultType<typeof refined>['reviewer']
  >().toEqualTypeOf<Scalars<Models.public_User> | null>();
});

test('ResultType of a refined include is not never', () => {
  const refined = db.User.include('posts', (posts) => posts.select('id'));
  expectTypeOf<ResultType<typeof refined>>().not.toBeNever();
});

test('polymorphic base discriminator is the union of variant literals', () => {
  expectTypeOf<PolyModels.public_Task['type']>().toEqualTypeOf<'bug' | 'feature' | 'epic'>();
});

test('ResultType of a variant collection equals Scalars of the variant member', () => {
  const bugs = poly.Task.variant('Bug');
  expectTypeOf<ResultType<typeof bugs>>().toEqualTypeOf<Scalars<PolyModels.public_Bug>>();
});

test('ResultType of a polymorphic base collection equals Scalars of the Any union', () => {
  expectTypeOf<ResultType<typeof poly.Task>>().toEqualTypeOf<Scalars<PolyModels.public_AnyTask>>();
  expectTypeOf<ResultType<typeof poly.User>>().toEqualTypeOf<Scalars<PolyModels.public_AnyUser>>();
});

test('ResultType of an include whose target is a polymorphic base equals Shape over the Any union', () => {
  const projectsWithTasks = poly.Project.include('tasks');
  expectTypeOf<ResultType<typeof projectsWithTasks>>().toEqualTypeOf<
    Shape<PolyModels.public_Project, { '+': 'tasks' }>
  >();
  const commentsWithTask = poly.TaskComment.include('task');
  expectTypeOf<ResultType<typeof commentsWithTask>>().toEqualTypeOf<
    Shape<PolyModels.public_TaskComment, { '+': 'task' }>
  >();
});

test('ResultType of a variant-only include on a variant collection equals Shape of the variant', () => {
  const bugsWithAssignee = poly.Task.variant('Bug').include('assignee');
  expectTypeOf<ResultType<typeof bugsWithAssignee>>().toEqualTypeOf<
    Shape<PolyModels.public_Bug, { '+': 'assignee' }>
  >();
});

test('Shape over the Any union adds a variant-only relation to the variants that declare it', () => {
  type Flat<T> = { [K in keyof T]: T[K] };
  type AssigneeRow = Scalars<PolyModels.public_Person> | null;
  expectTypeOf<Shape<PolyModels.public_AnyTask, { '+': 'assignee' }>>().toEqualTypeOf<
    | Flat<Scalars<PolyModels.public_Bug> & { assignee: AssigneeRow }>
    | Flat<Scalars<PolyModels.public_Feature> & { assignee: AssigneeRow }>
    | Flat<Scalars<PolyModels.public_Epic>>
  >();
  expectTypeOf<
    Extract<Shape<PolyModels.public_AnyTask, { '+': 'assignee' }>, { type: 'epic' }>
  >().not.toHaveProperty('assignee');
});

test('prepared terminals preserve complete emitted ordinary result types', () => {
  const nested = db.User.select('id').include('posts', (posts) =>
    posts.select('title').include('author'),
  );
  expectTypeOf(nested.prepared.all().consume).returns.toEqualTypeOf<
    AsyncIterableResult<ResultType<typeof nested>>
  >();
  expectTypeOf(nested.prepared.first().consume).returns.toEqualTypeOf<
    ReturnType<typeof nested.first>
  >();

  const required = db.Article.select('id').include('reviewer');
  expectTypeOf(required.prepared.all().consume).returns.toEqualTypeOf<
    AsyncIterableResult<{ id: number; reviewer: Scalars<Models.public_User> }>
  >();
  const refined = db.Article.select('id').include('reviewer', (reviewer) => reviewer.select('id'));
  expectTypeOf(refined.prepared.first().consume).returns.toEqualTypeOf<
    Promise<{ id: number; reviewer: { id: number } | null } | null>
  >();

  const bugs = poly.Task.variant('Bug').include('assignee');
  expectTypeOf(bugs.prepared.all().consume).returns.toEqualTypeOf<
    AsyncIterableResult<Shape<PolyModels.public_Bug, { '+': 'assignee' }>>
  >();
  expectTypeOf(bugs.prepared.first().consume).returns.toEqualTypeOf<
    ReturnType<typeof bugs.first>
  >();
});

test('Shape rejects a key that is not a relation', () => {
  // @ts-expect-error 'nope' is not a relation of User
  type Bad = Shape<Models.public_User, { nope: Record<never, never> }>;
  expectTypeOf<Bad>().not.toBeNever();
});
