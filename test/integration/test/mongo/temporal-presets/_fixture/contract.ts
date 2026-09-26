import { defineContract } from '@internal/mongo/contract-builder';

export const contract = defineContract({}, ({ field, model }) => {
  const Event = model('Event', {
    collection: 'events',
    fields: {
      _id: field.objectId(),
      kind: field.string(),
      createdAt: field.temporal.createdAt(),
    },
    discriminator: {
      field: 'kind',
      variants: { Click: { value: 'click' }, View: { value: 'view' } },
    },
  });
  return {
    models: {
      Post: model('Post', {
        collection: 'posts',
        fields: {
          _id: field.objectId(),
          title: field.string(),
          createdAt: field.temporal.createdAt(),
          updated_at: field.temporal.updatedAt(),
          touchedAt: field.temporal.timestamp(undefined, 'now'),
        },
      }),
      Event,
      Click: model('Click', { collection: 'events', base: Event, fields: { url: field.string() } }),
      View: model('View', { collection: 'events', base: Event, fields: { path: field.string() } }),
    },
  };
});
