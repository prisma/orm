import { defineContract, field, index, model, type } from '@internal/mongo/contract-builder';

export const contract = defineContract({
  models: {
    User: model('User', {
      collection: 'users',
      fields: {
        id: field.scalar(type.ObjectId()).mongo({ field: '_id' }),
        email: field.scalar(type.String()),
        name: field.scalar(type.String()),
      },
      indexes: [
        index({ email: 1 }, { unique: true, name: 'User_email_key' }),
        index({ email: 1 }, { name: 'User_email_idx' }),
        index({ email: 1 }, { sparse: true, name: 'email_sparse' }),
        index({ name: 1 }),
      ],
    }),
  },
});
