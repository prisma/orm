import { defineContract, field, index, model, rel, type } from '@internal/mongo/contract-builder';

const User = model('User', {
  collection: 'users',
  fields: {
    _id: field.scalar(type.ObjectId()),
    email: field.scalar(type.String()),
  },
  indexes: [index({ email: 1 }, { unique: true })],
  collectionOptions: {
    collation: { locale: 'en', strength: 2 },
  },
});

const Task = model('Task', {
  collection: 'tasks',
  storageRelations: {
    comments: { field: 'comments' },
  },
  fields: {
    _id: field.scalar(type.ObjectId()),
    type: field.scalar(type.String()),
    title: field.scalar(type.String()),
    assigneeId: field.scalar(type.ObjectId()),
  },
  relations: {
    assignee: rel.belongsTo(User, {
      from: 'assigneeId',
      to: User.ref('_id'),
    }),
    comments: rel.hasMany('Comment'),
  },
  discriminator: {
    field: 'type',
    variants: {
      Bug: { value: 'bug' },
    },
  },
});

const Bug = model('Bug', {
  collection: 'tasks',
  base: Task,
  fields: {
    severity: field.scalar(type.String()),
  },
});

const Comment = model('Comment', {
  owner: Task,
  fields: {
    _id: field.scalar(type.ObjectId()),
    text: field.scalar(type.String()),
  },
});

export const contract = defineContract({
  models: {
    Task,
    Bug,
    User,
    Comment,
  },
});
