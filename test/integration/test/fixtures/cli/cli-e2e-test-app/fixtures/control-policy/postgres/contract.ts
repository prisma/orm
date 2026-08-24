import {
  int4Column,
  textColumn,
  timestamptzTemporalColumn,
} from '@internal/adapter-postgres/column-types';
import { defineContract, field, model } from '@internal/postgres/contract-builder';

export const contract = defineContract({
  models: {
    AppUsers: model('AppUsers', {
      fields: {
        id: field.column(int4Column).id(),
        email: field.column(textColumn),
      },
    }).sql({ table: 'app_users' }),

    AuditLog: model('AuditLog', {
      fields: {
        id: field.column(int4Column).id(),
        ts: field.column(timestamptzTemporalColumn),
      },
    }).sql({ table: 'audit_log', control: 'tolerated' }),

    LegacyJobs: model('LegacyJobs', {
      fields: {
        id: field.column(int4Column).id(),
        status: field.column(textColumn),
      },
    }).sql({ table: 'legacy_jobs', control: 'observed' }),

    AuthUsers: model('AuthUsers', {
      fields: {
        id: field.column(int4Column).id(),
        email: field.column(textColumn),
      },
    }).sql({ table: 'auth_users', control: 'external' }),
  },
});
