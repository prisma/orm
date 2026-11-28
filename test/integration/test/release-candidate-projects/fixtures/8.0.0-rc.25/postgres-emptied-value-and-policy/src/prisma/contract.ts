import { defineContract, policySelect, rel, rlsEnabled, sql } from '@prisma/orm-postgres/contract-builder';

export const contract = defineContract({}, ({ field, model, gen, type }) => {
  const User = model('User', {
    fields: {
      id: field.column(type.Uuid()).id().onCreate(gen.uuid()),
      email: field.column(type.String()).unique(),
    },
  });

  const Post = model('Post', {
    fields: {
      id: field.column(type.Uuid()).id().onCreate(gen.uuid()),
      title: field.column(type.String()),
      authorId: field.column(type.Uuid()),
      meta: field.column(type.Jsonb()).optional(),
    },
  });

  const PostModel = Post.relations({ author: rel.belongsTo(User, { from: 'authorId', to: 'id' }) }).sql(({ cols, constraints }) => ({
    table: 'Post',
    foreignKeys: [constraints.foreignKey(cols.authorId, User.refs.id)],
    indexes: [constraints.index([cols.meta], { name: 'post_meta_gin', type: 'gin', options: { fastupdate: false } })],
  }));
  return {
    models: {
      User: User.relations({ posts: rel.hasMany(Post, { by: 'authorId' }) }).sql({ table: 'User' }),
      Post: PostModel,
    },
    entities: [rlsEnabled(PostModel), policySelect(PostModel, { name: 'post_no_roles', roles: [], using: sql`true` })],
  };
});
