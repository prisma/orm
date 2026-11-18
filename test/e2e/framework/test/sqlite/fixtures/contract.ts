import {
  datetimeColumn,
  integerNumberColumn,
  plainJsonColumn,
  textColumn,
} from '@prisma/orm-sqlite/adapter/column-types';
import { defineContract, field, model, rel } from '@prisma/orm-sqlite/contract-builder';

const User = model('User', {
  fields: {
    id: field.column(integerNumberColumn).id(),
    name: field.column(textColumn),
    email: field.column(textColumn),
    invitedById: field.column(integerNumberColumn).optional().column('invited_by_id'),
  },
}).sql({ table: 'users' });

const Post = model('Post', {
  fields: {
    id: field.column(integerNumberColumn).id(),
    title: field.column(textColumn),
    userId: field.column(integerNumberColumn).column('user_id'),
    views: field.column(integerNumberColumn),
  },
}).sql({ table: 'posts' });

const Comment = model('Comment', {
  fields: {
    id: field.column(integerNumberColumn).id(),
    body: field.column(textColumn),
    postId: field.column(integerNumberColumn).column('post_id'),
  },
}).sql({ table: 'comments' });

const Profile = model('Profile', {
  fields: {
    id: field.column(integerNumberColumn).id(),
    userId: field.column(integerNumberColumn).column('user_id').unique(),
    bio: field.column(textColumn),
  },
}).sql({ table: 'profiles' });

const TypedRow = model('TypedRow', {
  fields: {
    id: field.column(integerNumberColumn).id(),
    active: field.column(integerNumberColumn),
    createdAt: field.column(datetimeColumn).column('created_at'),
    metadata: field.column(plainJsonColumn).optional(),
    label: field.column(textColumn),
  },
}).sql({ table: 'typed_rows' });

const Item = model('Item', {
  fields: {
    id: field.column(integerNumberColumn).id(),
    name: field.column(textColumn),
    label: field.column(textColumn).default('unnamed'),
  },
}).sql({ table: 'items' });

export const contract = defineContract({
  models: {
    User: User.relations({
      posts: rel.hasMany(Post, { by: 'userId' }),
      profile: rel.hasOne(Profile, { by: 'userId' }),
    }),
    Post: Post.relations({
      comments: rel.hasMany(Comment, { by: 'postId' }),
      author: rel.belongsTo(User, { from: 'userId', to: 'id' }),
    }),
    Comment,
    Profile,
    TypedRow,
    Item,
  },
});
