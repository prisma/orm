import pgvector from '@prisma/orm-extension-pgvector/pack';
import { timestamptzTemporalColumn } from '@prisma/orm-postgres/adapter/column-types';
import { defineContract, enumType, member, rel, sql } from '@prisma/orm-postgres/contract-builder';

const pgText = { codecId: 'pg/text@1', nativeType: 'text' } as const;

const Priority = enumType(
  'Priority',
  { codecId: 'pg/int4@1', nativeType: 'int4' },
  member('Low', 0),
  member('High', 1),
  member('Urgent', 2),
);

const UserEnum = enumType('user_type', pgText, member('admin', 'admin'), member('user', 'user'));

export const contract = defineContract(
  {
    extensions: { pgvector },
  },
  ({ field, model, type }) => {
    const types = {
      Embedding1536: type.pgvector.Vector(1536),
    } as const;

    const User = model('User', {
      fields: {
        id: field.id.uuidv4String(),
        email: field.text(),
        createdAt: field.temporal.createdAt(),
        updatedAt: field.temporal.updatedAt(),
        kind: field.namedType(UserEnum),
        address: field.json().optional(),
      },
    });

    const Post = model('Post', {
      fields: {
        id: field.id.uuidv4String(),
        title: field.text(),
        userId: field.uuidString(),
        priority: field.namedType(Priority).default(Priority.members.Low),
        createdAt: field.temporal.createdAt(),
        expiresAt: field
          .column(timestamptzTemporalColumn)
          .default(sql`(now() + '7 days'::interval)`),
        updatedAt: field.temporal.updatedAt(),
        embedding: field.namedType(types.Embedding1536).optional(),
      },
    });

    return {
      enums: { Priority, user_type: UserEnum },
      types,
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
  },
);
