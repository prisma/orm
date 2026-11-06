import { defineContract, field, model } from '@internal/mongo/contract-builder';

export function buildContract() {
  const Task = model('Task', {
    collection: 'tasks',
    fields: {
      id: field.objectId().mongo({ field: '_id' }),
      type: field.string(),
      title: field.string(),
      note: field.string(),
    },
    discriminator: { field: 'type', variants: { Bug: { value: 'bug' } } },
  });
  return defineContract({
    models: {
      Task,
      Bug: model('Bug', {
        base: Task,
        fields: { title: field.int32().mongo({ field: 't' }), note: field.string().optional() },
      }),
    },
  });
}
