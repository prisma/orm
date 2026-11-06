import { defineContract, gen } from '@internal/mongo/contract-builder';

export const contract = defineContract({}, ({ field, model }) => {
  const Event = model('Event', {
    collection: 'events',
    fields: {
      id: field.objectId().mongo({ field: '_id' }),
      kind: field.string(),
      createdAt: field.date().onCreate(gen.now()),
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
          id: field.objectId().mongo({ field: '_id' }),
          title: field.string(),
          createdAt: field.date().onCreate(gen.now()),
          updatedAt: field
            .date()
            .onCreate(gen.now())
            .onUpdate(gen.now())
            .mongo({ field: 'updated_at' }),
          touchedAt: field.date().onUpdate(gen.now()),
        },
      }),
      Counter: model('Counter', {
        collection: 'counters',
        fields: {
          id: field.objectId().mongo({ field: '_id' }),
          key: field.string(),
          tags: field.string().many(),
          scores: field.int32().many(),
          factor: field.double(),
          hits: field.int32(),
          label: field.string().optional(),
          updatedAt: field.date().onCreate(gen.now()).onUpdate(gen.now()),
        },
      }),
      Event,
      Click: model('Click', { collection: 'events', base: Event, fields: { url: field.string() } }),
      View: model('View', { collection: 'events', base: Event, fields: { path: field.string() } }),
    },
  };
});
