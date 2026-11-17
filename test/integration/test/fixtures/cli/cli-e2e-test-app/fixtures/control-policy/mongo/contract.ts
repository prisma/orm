import { defineContract, field, index, model, type } from '@internal/mongo/contract-builder';

export const contract = defineContract({
  models: {
    Catalog: model('Catalog', {
      collection: 'catalog',
      controlPolicy: 'managed',
      fields: {
        _id: field.scalar(type.ObjectId()),
        sku: field.scalar(type.String()),
      },
      indexes: [index({ sku: 1 }, { unique: true })],
    }),

    AuditLog: model('AuditLog', {
      collection: 'audit_log',
      controlPolicy: 'tolerated',
      fields: {
        _id: field.scalar(type.ObjectId()),
        ts: field.scalar(type.String()),
      },
      indexes: [index({ ts: 1 })],
    }),

    AuthUsers: model('AuthUsers', {
      collection: 'auth_users',
      controlPolicy: 'external',
      fields: {
        _id: field.scalar(type.ObjectId()),
        email: field.scalar(type.String()),
      },
      indexes: [index({ email: 1 }, { unique: true })],
    }),

    LegacyJobs: model('LegacyJobs', {
      collection: 'legacy_jobs',
      controlPolicy: 'observed',
      fields: {
        _id: field.scalar(type.ObjectId()),
        status: field.scalar(type.String()),
      },
      indexes: [index({ status: 1 })],
    }),
  },
});
