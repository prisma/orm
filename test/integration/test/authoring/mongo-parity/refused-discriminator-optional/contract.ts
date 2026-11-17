import { defineContract, field, model, type } from '@internal/mongo/contract-builder';

export function buildContract() {
  const Task = model('Task', {
    collection: 'tasks',
    fields: {
      id: field.scalar(type.ObjectId()).mongo({ field: '_id' }),
      type: field.scalar(type.String()).optional(),
    },
    discriminator: { field: 'type', variants: { Bug: { value: 'bug' } } },
  });
  return defineContract({
    models: {
      Task,
      Bug: model('Bug', { base: Task, fields: { severity: field.scalar(type.Int32()) } }),
    },
  });
}
