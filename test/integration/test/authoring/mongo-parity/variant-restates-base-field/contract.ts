import { defineContract, field, model, type } from '@internal/mongo/contract-builder';

const Task = model('Task', {
  collection: 'tasks',
  fields: {
    id: field.scalar(type.ObjectId()).mongo({ field: '_id' }),
    type: field.scalar(type.String()),
    title: field.scalar(type.String()).mongo({ field: 't' }),
  },
  discriminator: { field: 'type', variants: { Bug: { value: 'bug' } } },
});

export const contract = defineContract({
  models: {
    Task,
    Bug: model('Bug', {
      base: Task,
      fields: {
        id: field.scalar(type.ObjectId()).mongo({ field: '_id' }),
        title: field.scalar(type.String()).mongo({ field: 't' }),
        sev: field.scalar(type.String()),
      },
    }),
  },
});
