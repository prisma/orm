import { defineContract, field, index, model, type } from '@internal/mongo/contract-builder';

export const contract = defineContract({
  models: {
    User: model('User', {
      collection: 'users',
      fields: {
        id: field.scalar(type.ObjectId()).mongo({ field: '_id' }),
        email: field.scalar(type.String()),
        tenantId: field.scalar(type.String()),
        name: field.scalar(type.String()),
        expiresAt: field.scalar(type.Date()),
        status: field.scalar(type.String()),
        metadata: field.scalar(type.Json()),
        title: field.scalar(type.String()),
        body: field.scalar(type.String()),
      },
      indexes: [
        index({ email: 1 }, { unique: true }),
        index({ tenantId: 1, email: 1 }, { unique: true }),
        index({ name: -1 }),
        index({ 'metadata.$**': 1 }),
        index({ expiresAt: 1 }, { expireAfterSeconds: 3600 }),
        index({ status: 1 }, { collation: { locale: 'fr', strength: 2 } }),
        index({ name: 1 }, { partialFilterExpression: { status: 'active' } }),
        index({ title: 'text', body: 'text' }, { weights: { title: 10, body: 1 } }),
      ],
    }),
  },
});
