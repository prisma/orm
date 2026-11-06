import { defineContract, field, model } from '@internal/mongo/contract-builder';

const Task = model('Task', {
  collection: 'tasks',
  fields: {
    id: field.objectId().mongo({ field: '_id' }),
    type: field.string(),
    title: field.string().mongo({ field: 't' }),
  },
  discriminator: { field: 'type', variants: { Bug: { value: 'bug' } } },
});

export const contract = defineContract({
  models: {
    Task,
    Bug: model('Bug', {
      base: Task,
      fields: {
        id: field.objectId().mongo({ field: '_id' }),
        title: field.string().mongo({ field: 't' }),
        sev: field.string(),
      },
    }),
  },
});
