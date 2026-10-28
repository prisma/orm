import { defineContract, rel } from '@prisma/orm-postgres/contract-builder';

export const contract = defineContract({}, ({ field, model, gen, type }) => {
  const User = model('User', {
    fields: {
      id: field.column(type.Char(36)).id().onCreate(gen.uuid()),
      email: field.column(type.String()),
      createdAt: field.column(type.DateTime({ as: 'temporal' })).onCreate(gen.now()),
      updatedAt: field
        .column(type.DateTime({ as: 'temporal' }))
        .onCreate(gen.now())
        .onUpdate(gen.now()),
    },
  });

  const Post = model('Post', {
    fields: {
      id: field.column(type.Char(36)).id().onCreate(gen.uuid()),
      title: field.column(type.String()),
      userId: field.column(type.Char(36)),
      createdAt: field.column(type.DateTime({ as: 'temporal' })).onCreate(gen.now()),
      updatedAt: field
        .column(type.DateTime({ as: 'temporal' }))
        .onCreate(gen.now())
        .onUpdate(gen.now()),
    },
  });

  return {
    models: {
      User: User.relations({
        posts: rel.hasMany(Post, { by: 'userId' }),
      }).sql({
        table: 'user',
      }),
      Post: Post.relations({
        user: rel.belongsTo(User, { from: 'userId', to: 'id' }),
      }).sql(({ cols, constraints }) => ({
        table: 'post',
        foreignKeys: [
          constraints.foreignKey(cols.userId, User.refs.id, {
            name: 'post_userId_fkey',
          }),
        ],
      })),
    },
  };
});
