import { defineContract, field, index, model } from '@internal/mongo/contract-builder';

export const contract = defineContract({
  models: {
    User: model('User', {
      collection: 'users',
      fields: {
        id: field.objectId().mongo({ field: '_id' }),
        email: field.string(),
        name: field.string(),
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
