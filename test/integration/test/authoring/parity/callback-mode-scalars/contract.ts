import * as pg from '@internal/adapter-postgres/column-types';
import pgvector from '@internal/extension-pgvector/pack';
import { defineContract, rel } from '@internal/postgres/contract-builder';

export const contract = defineContract({ extensions: { pgvector } }, ({ field, model, type }) => {
  const types = {
    Embedding: type.pgvector.Vector(1536),
  } as const;
  const User = model('User', {
    fields: {
      id: field.column(pg.int4Column).defaultSql('autoincrement()').id(),
      email: field.column(pg.textColumn).unique(),
      age: field.column(pg.int4Column),
      isActive: field.column(pg.boolColumn).default(true),
      score: field.column(pg.float8Column).optional(),
      profile: field.column(pg.jsonbColumn).optional(),
      embedding: field.namedType(types.Embedding).optional(),
      createdAt: field.column(pg.timestamptzTemporalColumn).defaultSql('now()'),
    },
  }).sql({ table: 'user' });
  const Post = model('Post', {
    fields: {
      id: field.column(pg.int4Column).defaultSql('autoincrement()').id(),
      userId: field.column(pg.int4Column),
      title: field.column(pg.textColumn),
      rating: field.column(pg.float8Column).optional(),
    },
    relations: {
      user: rel
        .belongsTo(User, { from: 'userId', to: 'id' })
        .sql({ fk: { onDelete: 'cascade', onUpdate: 'cascade' } }),
    },
  }).sql({ table: 'post' });
  return { types, models: { User, Post } };
});
