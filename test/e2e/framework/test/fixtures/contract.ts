import { arktypeJson } from '@prisma/orm-extension-arktype-json/column-types';
import arktypeJsonPack from '@prisma/orm-extension-arktype-json/pack';
import { vector } from '@prisma/orm-extension-pgvector/column-types';
import pgvectorPack from '@prisma/orm-extension-pgvector/pack';
import {
  bitColumn,
  boolColumn,
  charColumn,
  float8Column,
  int4Column,
  int8Column,
  intervalColumn,
  jsonbColumn,
  jsonColumn,
  numericColumn,
  textColumn,
  timestamptzTemporalColumn,
  timeTemporalColumn,
  timetzColumn,
  varbitColumn,
  varcharColumn,
} from '@prisma/orm-postgres/adapter/column-types';
import postgresAdapter from '@prisma/orm-postgres/adapter/control';
import { extractCodecLookup } from '@prisma/orm-postgres/components/control';
import { defineContract } from '@prisma/orm-postgres/contract-builder';
import { type } from 'arktype';

const postgresCodecLookup = extractCodecLookup([postgresAdapter, pgvectorPack, arktypeJsonPack]);

const profileSchema = type({
  name: 'string',
  age: 'number',
});

export const contract = defineContract(
  { codecLookup: postgresCodecLookup },
  ({ field, model, rel }) => {
    const UserBase = model('User', {
      fields: {
        id: field.column(int4Column).defaultSql('autoincrement()').id(),
        email: field.column(varcharColumn(255)).unique({ name: 'user_email_key' }),
        createdAt: field.column(timestamptzTemporalColumn).defaultSql('now()').column('created_at'),
        updatedAt: field.column(timestamptzTemporalColumn).optional().column('update_at'),
        profile: field.column(jsonbColumn).optional(),
      },
    });

    const PostBase = model('Post', {
      fields: {
        id: field.column(int4Column).defaultSql('autoincrement()').id(),
        userId: field.column(int4Column),
        title: field.column(textColumn),
        createdAt: field.column(timestamptzTemporalColumn).defaultSql('now()').column('created_at'),
        updatedAt: field.column(timestamptzTemporalColumn).optional().column('update_at'),
        published: field.column(boolColumn),
        meta: field.column(jsonColumn).optional(),
      },
    });

    const Comment = model('Comment', {
      fields: {
        id: field.column(int4Column).defaultSql('autoincrement()').id(),
        postId: field.column(int4Column),
        content: field.column(textColumn),
        createdAt: field.column(timestamptzTemporalColumn).defaultSql('now()').column('created_at'),
        updatedAt: field.column(timestamptzTemporalColumn).optional().column('update_at'),
      },
      relations: {
        post: rel.belongsTo(PostBase, { from: 'postId', to: 'id' }),
      },
    }).sql({ table: 'comment' });

    const Post = PostBase.relations({
      author: rel.belongsTo(UserBase, { from: 'userId', to: 'id' }),
      comments: rel.hasMany(() => Comment, { by: 'postId' }),
    }).sql({ table: 'post' });

    const User = UserBase.relations({
      posts: rel.hasMany(() => Post, { by: 'userId' }),
    }).sql({ table: 'user' });

    return {
      models: {
        User,
        Post,
        Comment,

        ParamTypes: model('ParamTypes', {
          fields: {
            id: field.column(int4Column).defaultSql('autoincrement()').id(),
            name: field.column(varcharColumn(255)).optional(),
            code: field.column(charColumn(16)).optional(),
            price: field.column(numericColumn(10, 2)).optional(),
            flags: field.column(bitColumn(8)).optional(),
            bits: field.column(varbitColumn(12)).optional(),
            createdAt: field
              .column({ ...timestamptzTemporalColumn, typeParams: { precision: 3 } })
              .optional()
              .column('created_at'),
            startsAt: field.column(timeTemporalColumn(2)).optional().column('starts_at'),
            startsAtTz: field.column(timetzColumn(2)).optional().column('starts_at_tz'),
            duration: field.column(intervalColumn(6)).optional().column('duration'),
          },
        }).sql({ table: 'param_types' }),

        Event: model('Event', {
          fields: {
            id: field.id.uuidv7String(),
            name: field.column(textColumn),
            scheduledAt: field
              .column(timestamptzTemporalColumn)
              .default({ kind: 'literal', value: new Date('2024-01-15T10:30:00.000Z') })
              .column('scheduled_at'),
            createdAt: field
              .column(timestamptzTemporalColumn)
              .defaultSql('now()')
              .column('created_at'),
          },
        }).sql({ table: 'event' }),

        LiteralDefaults: model('LiteralDefaults', {
          fields: {
            id: field.column(int4Column).defaultSql('autoincrement()').id(),
            label: field.column(textColumn).default('draft'),
            score: field.column(int4Column).default(0),
            rating: field.column(float8Column).default(3.14),
            active: field.column(boolColumn).default(true),
            bigCount: field.column(int8Column).default(9007199254740991).column('big_count'),
            metadata: field.column(jsonbColumn).default({ key: 'default' }),
            tags: field.column(jsonbColumn).default(['alpha', 'beta']),
          },
        }).sql({ table: 'literal_defaults' }),

        Embedding: model('Embedding', {
          fields: {
            id: field.column(int4Column).defaultSql('autoincrement()').id(),
            embedding: field.column(vector(1536)),
            profile: field.column(arktypeJson(profileSchema)),
          },
        }).sql({ table: 'embedding' }),
      },
    };
  },
);
