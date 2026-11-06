import { defineContract, field, index, model } from '@internal/mongo/contract-builder';

const Task = model('Task', {
  collection: 'tasks',
  fields: {
    id: field.objectId().mongo({ field: '_id' }),
    type: field.string(),
    title: field.string(),
    assignee: field.string(),
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
      fields: { severity: field.int32() },
      indexes: [index({ severity: 1 })],
    }),
    Feature: model('Feature', {
      base: Task,
      fields: { priority: field.int32() },
      indexes: [index({ priority: 1 }, { partialFilterExpression: { type: 'feature' } })],
    }),
    Chore: model('Chore', { base: Task, fields: { dueOn: field.date() } }),
  },
});
