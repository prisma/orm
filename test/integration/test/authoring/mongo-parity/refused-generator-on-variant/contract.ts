import { defineContract } from '@internal/mongo/contract-builder';

export function buildContract() {
  return defineContract({}, ({ field, gen, model, type }) => {
    const Task = model('Task', {
      collection: 'tasks',
      fields: {
        id: field.scalar(type.ObjectId()).mongo({ field: '_id' }),
        type: field.scalar(type.String()),
      },
      discriminator: { field: 'type', variants: { Bug: { value: 'bug' } } },
    });
    return {
      models: {
        Task,
        Bug: model('Bug', {
          base: Task,
          fields: { seenAt: field.scalar(type.DateTime()).onCreate(gen.now()) },
        }),
      },
    };
  });
}
