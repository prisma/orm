import { defineContract } from '@internal/mongo/contract-builder';

export const contract = defineContract({}, ({ field, model, gen, type }) => {
  const Event = model('Event', {
    collection: 'events',
    fields: {
      id: field.scalar(type.ObjectId()).mongo({ field: '_id' }),
      kind: field.scalar(type.String()),
      createdAt: field.scalar(type.Date()).onCreate(gen.now()),
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
          id: field.scalar(type.ObjectId()).mongo({ field: '_id' }),
          title: field.scalar(type.String()),
          createdAt: field.scalar(type.Date()).onCreate(gen.now()),
          updatedAt: field
            .scalar(type.Date())
            .onCreate(gen.now())
            .onUpdate(gen.now())
            .mongo({ field: 'updated_at' }),
          touchedAt: field.scalar(type.Date()).onUpdate(gen.now()),
        },
      }),
      Counter: model('Counter', {
        collection: 'counters',
        fields: {
          id: field.scalar(type.ObjectId()).mongo({ field: '_id' }),
          key: field.scalar(type.String()),
          tags: field.scalar(type.String()).many(),
          scores: field.scalar(type.Int32()).many(),
          factor: field.scalar(type.Double()),
          hits: field.scalar(type.Int32()),
          label: field.scalar(type.String()).optional(),
          updatedAt: field.scalar(type.Date()).onCreate(gen.now()).onUpdate(gen.now()),
        },
      }),
      Event,
      Click: model('Click', {
        collection: 'events',
        base: Event,
        fields: { url: field.scalar(type.String()) },
      }),
      View: model('View', {
        collection: 'events',
        base: Event,
        fields: { path: field.scalar(type.String()) },
      }),
    },
  };
});
