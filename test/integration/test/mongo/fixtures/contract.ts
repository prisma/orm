// Intentionally uses verbose mongo-contract-ts import: the mongo facade's defineContract
// has a type inference regression for discriminated union contracts with embedded relations
// (the intersection-based return type loses type precision compared to the base overload).
// Tracked at https://linear.app/prisma-company/issue/TML-2633 — migrate to the facade form
// once TML-2633 lands.
import mongoFamily from '@internal/family-mongo/pack';
import { type } from '@internal/mongo/contract-builder';
import {
  defineContract,
  field,
  index,
  model,
  rel,
} from '@internal/mongo-contract-ts/contract-builder';
import mongoTarget from '@internal/target-mongo/pack';

const User = model('User', {
  collection: 'users',
  storageRelations: {
    addresses: { field: 'addresses' },
  },
  fields: {
    _id: field.scalar(type.ObjectId()),
    name: field.scalar(type.String()),
    email: field.scalar(type.String()),
  },
  indexes: [index({ email: 1 }, { unique: true })],
  collectionOptions: {
    collation: { locale: 'en', strength: 2 },
  },
  relations: {
    addresses: rel.hasMany('Address'),
  },
});

const Task = model('Task', {
  collection: 'tasks',
  storageRelations: {
    comments: { field: 'comments' },
  },
  fields: {
    _id: field.scalar(type.ObjectId()),
    title: field.scalar(type.String()),
    type: field.scalar(type.String()),
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
      Feature: { value: 'feature' },
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

const Feature = model('Feature', {
  collection: 'tasks',
  base: Task,
  fields: {
    priority: field.scalar(type.String()),
    targetRelease: field.scalar(type.String()),
  },
});

const Address = model('Address', {
  owner: User,
  fields: {
    street: field.scalar(type.String()),
    city: field.scalar(type.String()),
    zip: field.scalar(type.String()),
  },
});

const Comment = model('Comment', {
  owner: Task,
  fields: {
    _id: field.scalar(type.ObjectId()),
    text: field.scalar(type.String()),
    createdAt: field.scalar(type.Date()),
  },
});

export const contract = defineContract({
  family: mongoFamily,
  target: mongoTarget,
  models: {
    Task,
    Bug,
    Feature,
    User,
    Address,
    Comment,
  },
});
