import { defineContract, field, model } from '@internal/mongo/contract-builder';

/** A collation as a JavaScript caller can write it, without the locale the type requires. */
const collationWithoutLocale = JSON.parse('{"strength":2}');

export function buildContract() {
  return defineContract({
    models: {
      Doc: model('Doc', {
        collection: 'docs',
        fields: { id: field.objectId().mongo({ field: '_id' }), a: field.string() },
        indexes: [{ fields: { a: 1 }, options: { collation: collationWithoutLocale } }],
      }),
    },
  });
}
