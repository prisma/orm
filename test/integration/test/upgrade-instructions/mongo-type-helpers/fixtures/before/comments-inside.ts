import { defineContract } from '@internal/mongo/contract-builder';

export const contract = defineContract({}, ({ field, model }) => ({
  models: {
    Doc: model('Doc', {
      collection: 'docs',
      fields: {
        _id: field.objectId(/* primary key */),
        title: field.scalar(
          'mongo/string@1', // the title
        ),
        body: field.string(),
      },
    }),
  },
}));
