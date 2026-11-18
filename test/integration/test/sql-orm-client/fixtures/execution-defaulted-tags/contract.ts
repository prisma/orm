import { charColumn, int4Column, textColumn } from '@internal/adapter-postgres/column-types';
import { defineContract, field, gen, model, rel, type } from '@internal/postgres/contract-builder';

// A pure-junction M:N (User.tags through user_tags) whose junction payload column
// `created_at` carries an execution-time onCreate default (uuidv4) instead of a
// storage default. Connect/create on User.tags must apply that execution default
// when inserting the junction row — the column is NOT NULL with no DB default,
// so a missed application surfaces as a NOT NULL violation. Emitted (not a
// hand-patched contract) so the scenario comes from a shape the authoring
// surface can actually produce.

const Tag = model('Tag', {
  fields: {
    id: field.column(type.Char(36)).onCreate(gen.uuid()).id(),
    name: field.column(textColumn).unique(),
  },
}).sql({ table: 'tags' });

const UserTag = model('UserTag', {
  fields: {
    userId: field.column(int4Column).column('user_id'),
    tagId: field.column(charColumn(36)).column('tag_id'),
    created_at: field.column(type.Char(36)).onCreate(gen.uuid()),
  },
})
  .attributes(({ fields, constraints }) => ({
    id: constraints.id([fields.userId, fields.tagId]),
  }))
  .sql({ table: 'user_tags' });

const User = model('User', {
  fields: {
    id: field.column(int4Column).id(),
    name: field.column(textColumn),
    email: field.column(textColumn).unique(),
  },
})
  .relations({
    tags: rel.manyToMany(() => Tag, {
      through: () => UserTag,
      from: 'userId',
      to: 'tagId',
    }),
  })
  .sql({ table: 'users' });

export const contract = defineContract({
  models: { User, Tag, UserTag },
});
