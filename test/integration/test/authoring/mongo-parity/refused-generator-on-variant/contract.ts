import { defineContract } from '@internal/mongo/contract-builder';

export function buildContract() {
  return defineContract({}, ({ field, gen, model }) => {
    const Task = model('Task', {
      collection: 'tasks',
      fields: { id: field.objectId().mongo({ field: '_id' }), type: field.string() },
      discriminator: { field: 'type', variants: { Bug: { value: 'bug' } } },
    });
    return {
      models: {
        Task,
        Bug: model('Bug', { base: Task, fields: { seenAt: field.date().onCreate(gen.now()) } }),
      },
    };
  });
}
