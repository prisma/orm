import pgvector from '@prisma/orm-extension-pgvector/pack';
import { timestamptzTemporalColumn } from '@prisma/orm-postgres/adapter/column-types';
import {
  defineContract,
  enumType,
  fullTextIndex,
  member,
  rel,
  sql,
} from '@prisma/orm-postgres/contract-builder';

const pgText = { codecId: 'pg/text@1' } as const;

const Priority = enumType(
  'Priority',
  { codecId: 'pg/int4@1' },
  member('Low', 0),
  member('High', 1),
  member('Urgent', 2),
);

const UserEnum = enumType('user_type', pgText, member('admin', 'admin'), member('user', 'user'));

export const contract = defineContract(
  {
    extensions: { pgvector },
  },
  ({ field, model, type, gen }) => {
    const Embedding1536 = field.column(type.pgvector.Vector(1536));

    const User = model('User', {
      fields: {
        id: field.column(type.Char(36)).id().onCreate(gen.uuid()),
        email: field.column(type.String()),
        createdAt: field.column(timestamptzTemporalColumn).onCreate(gen.now()),
        updatedAt: field.column(timestamptzTemporalColumn).onCreate(gen.now()).onUpdate(gen.now()),
        kind: field.namedType(UserEnum),
        address: field.column(type.Jsonb()).optional(),
      },
    });

    const Post = model('Post', {
      fields: {
        id: field.column(type.Char(36)).id().onCreate(gen.uuid()),
        title: field.column(type.String()),
        body: field.column(type.String()).optional(),
        userId: field.column(type.Char(36)),
        priority: field.namedType(Priority).default(Priority.members.Low),
        createdAt: field.column(timestamptzTemporalColumn).onCreate(gen.now()),
        expiresAt: field
          .column(timestamptzTemporalColumn)
          .default(sql`(now() + '7 days'::interval)`),
        updatedAt: field.column(timestamptzTemporalColumn).onCreate(gen.now()).onUpdate(gen.now()),
        embedding: Embedding1536.optional(),
      },
    });

    return {
      enums: { Priority, user_type: UserEnum },
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
          indexes: [
            fullTextIndex(cols.title, { name: 'post_title_search' }),
            fullTextIndex([cols.title, cols.body], { name: 'post_search' }),
          ],
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
