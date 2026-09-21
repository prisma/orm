import { int4Column, textColumn, varcharColumn } from '@internal/adapter-postgres/column-types';
import { vector } from '@internal/extension-pgvector/column-types';
import pgvector from '@internal/extension-pgvector/pack';
import { uuidv4 } from '@internal/ids';
import {
  defineContract,
  field,
  fullTextIndex,
  model,
  rel,
} from '@internal/postgres/contract-builder';

const UserBase = model('User', {
  fields: {
    id: field.column(int4Column).id(),
    name: field.column(textColumn),
    email: field.column(textColumn),
    invitedById: field.column(int4Column).optional().column('invited_by_id'),
  },
});

const Post = model('Post', {
  fields: {
    id: field.column(int4Column).id(),
    title: field.column(textColumn),
    userId: field.column(int4Column).column('user_id'),
    views: field.column(int4Column),
    embedding: field.column(vector(3)).optional(),
  },
  relations: {
    comments: rel.hasMany(() => Comment, { by: 'postId' }),
    author: rel.belongsTo(UserBase, { from: 'userId', to: 'id' }),
  },
}).sql({ table: 'posts' });

const Comment = model('Comment', {
  fields: {
    id: field.column(int4Column).id(),
    body: field.column(textColumn),
    // A varchar sibling of `body`: Postgres stores `(subject)::text` inside the
    // index expression, and the full-text integration test checks that a query
    // over the same column still matches that index.
    subject: field.column(varcharColumn(200)),
    postId: field.column(int4Column).column('post_id'),
  },
}).sql(({ cols }) => ({
  table: 'comments',
  indexes: [
    fullTextIndex(cols.body, { name: 'comments_body_search' }),
    fullTextIndex(cols.subject, { name: 'comments_subject_search' }),
    // Partial: the index-usage test proves Postgres picks this one up for a
    // query that carries the same predicate.
    fullTextIndex(cols.body, { where: 'post_id = 1', name: 'comments_body_live' }),
  ],
}));

const Profile = model('Profile', {
  fields: {
    id: field.column(int4Column).id(),
    userId: field.column(int4Column).column('user_id'),
    bio: field.column(textColumn),
  },
}).sql({ table: 'profiles' });

const Article = model('Article', {
  fields: {
    id: field.generated(uuidv4()).id(),
    title: field.column(textColumn),
  },
}).sql({ table: 'articles' });

const User = UserBase.relations({
  invitedUsers: rel.hasMany(() => UserBase, { by: 'invitedById' }),
  invitedBy: rel.belongsTo(UserBase, { from: 'invitedById', to: 'id' }),
  posts: rel.hasMany(() => Post, { by: 'userId' }),
  profile: rel.hasOne(Profile, { by: 'userId' }),
}).sql({ table: 'users' });

export const contract = defineContract({
  extensions: { pgvector },
  models: {
    User,
    Post,
    Comment,
    Profile,
    Article,
  },
});
