import { defineContract, field, index, model, type } from '@internal/mongo/contract-builder';

const Task = model('Task', {
  collection: 'tasks',
  fields: {
    id: field.scalar(type.ObjectId()).mongo({ field: '_id' }),
    type: field.scalar(type.String()),
    title: field.scalar(type.String()),
    assignee: field.scalar(type.String()),
  },
  indexes: [index({ title: 1 })],
  discriminator: {
    field: 'type',
    variants: { Bug: { value: 'bug' }, Feature: { value: 'feature' }, Chore: { value: 'chore' } },
  },
});

export const contract = defineContract({
  models: {
    Task,
    Bug: model('Bug', {
      base: Task,
      fields: { severity: field.scalar(type.Int32()) },
      indexes: [index({ severity: 1 })],
    }),
    Feature: model('Feature', {
      base: Task,
      fields: { priority: field.scalar(type.Int32()) },
      indexes: [index({ priority: 1 }, { partialFilterExpression: { type: 'feature' } })],
    }),
    Chore: model('Chore', { base: Task, fields: { dueOn: field.scalar(type.Date()) } }),
  },
});
