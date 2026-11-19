import {
  autoincrement,
  defineContract,
  enumType,
  member,
  now,
  rel,
} from '../../src/exports/contract-builder';

/** The example contract of `example.prisma`, written with `defineContract`. */
function exampleContract() {
  const Role = enumType(
    'Role',
    { codecId: 'mysql/enum@1' },
    member('USER', 'USER'),
    member('ADMIN', 'ADMIN'),
  );
  return defineContract({ enums: { Role } }, ({ field, model, type }) => {
    const User = model('User', {
      fields: {
        id: field.column(type.Int()).id().default(autoincrement()),
        email: field.column(type.String()).unique(),
        role: field.namedType(Role),
      },
    });
    const Post = model('Post', {
      fields: {
        id: field.column(type.Int()).id().default(autoincrement()),
        title: field.column(type.String()),
        authorId: field.column(type.Int()),
      },
    });
    const Event = model('Event', {
      fields: {
        id: field.column(type.Int()).id().default(autoincrement()),
        title: field.column(type.String()),
        startsAt: field.column(type.DateTime()),
        day: field.column(type.Date()),
        opensAt: field.column(type.Time()),
        createdAt: field.column(type.DateTime()).default(now()),
      },
    });
    return {
      models: {
        User: User.relations({ posts: rel.hasMany(Post, { by: 'authorId' }) }),
        Post: Post.relations({ author: rel.belongsTo(User, { from: 'authorId', to: 'id' }) }).sql(
          ({ cols, constraints }) => ({
            foreignKeys: [constraints.foreignKey(cols.authorId, User.refs.id)],
          }),
        ),
        Event,
      },
    };
  });
}

export const contract = exampleContract();
