import { bigintColumn, datetimeColumn, textColumn } from '@prisma/orm-sqlite/adapter/column-types';
import { defineContract, now, rel } from '@prisma/orm-sqlite/contract-builder';

export const contract = defineContract({}, ({ field, model, type }) => {
  // SQLite contributes `BigIntNumber` — INTEGER storage read as a JS `number`,
  // throwing rather than rounding outside ±(2^53 − 1). It contributes no
  // `UnboundedInt`: that type needs lossless unbounded integer storage, which
  // SQLite has not got, so the type simply is not on offer here. The PostgreSQL
  // sibling demo (`examples/prisma-8-demo`) has all three representations.
  const types = { BigIntNumber: type.BigIntNumber() } as const;

  const User = model('User', {
    fields: {
      id: field.id.uuidv4String(),
      email: field.column(textColumn),
      displayName: field.column(textColumn),
      createdAt: field.column(datetimeColumn).default(now()),
    },
  });

  const Post = model('Post', {
    fields: {
      id: field.id.uuidv4String(),
      title: field.column(textColumn),
      userId: field.uuidString(),
      createdAt: field.column(datetimeColumn).default(now()),
      // Two engagement counters, both INTEGER in the database and each read
      // back as a different JavaScript type. They are optional because the
      // analytics pipeline backfills them.
      viewCount: field.namedType(types.BigIntNumber).optional(),
      impressionCount: field.column(bigintColumn).optional(),
    },
  });

  const Tag = model('Tag', {
    fields: {
      id: field.id.uuidv4String(),
      label: field.column(textColumn),
    },
  });

  const PostTag = model('PostTag', {
    fields: {
      postId: field.uuidString(),
      tagId: field.uuidString(),
    },
  }).attributes(({ fields, constraints }) => ({
    id: constraints.id([fields.postId, fields.tagId], { name: 'post_tag_pkey' }),
  }));

  return {
    types,
    models: {
      User: User.relations({
        posts: rel.hasMany(Post, { by: 'userId' }),
      }).sql({
        table: 'user',
      }),
      Post: Post.relations({
        user: rel.belongsTo(User, { from: 'userId', to: 'id' }),
        tags: rel.manyToMany(() => Tag, {
          through: () => PostTag,
          from: 'postId',
          to: 'tagId',
        }),
      }).sql(({ cols, constraints }) => ({
        table: 'post',
        foreignKeys: [
          constraints.foreignKey(cols.userId, User.refs.id, {
            name: 'post_userId_fkey',
          }),
        ],
      })),
      Tag: Tag.relations({
        posts: rel.manyToMany(() => Post, {
          through: () => PostTag,
          from: 'tagId',
          to: 'postId',
        }),
      }).sql({
        table: 'tag',
      }),
      PostTag: PostTag.sql(({ cols, constraints }) => ({
        table: 'post_tag',
        foreignKeys: [
          constraints.foreignKey(cols.postId, Post.refs.id, { name: 'post_tag_postId_fkey' }),
          constraints.foreignKey(cols.tagId, Tag.refs.id, { name: 'post_tag_tagId_fkey' }),
        ],
      })),
    },
  };
});
