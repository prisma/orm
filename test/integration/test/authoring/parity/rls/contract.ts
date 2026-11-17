import { int4Column, textColumn } from '@internal/adapter-postgres/column-types';
import {
  defineContract,
  field,
  model,
  policyAll,
  policyDelete,
  policyInsert,
  policySelect,
  policyUpdate,
  rlsEnabled,
  role,
  sql,
} from '@internal/postgres/contract-builder';

const anon = role('anon');
const authenticated = role('authenticated');

const ownerPredicate = sql`"userId"::uuid = auth.uid()`;

const Profile = model('Profile', {
  fields: {
    id: field.column(int4Column).id(),
    userId: field.column(textColumn),
  },
}).sql({ table: 'profile' });

const AuditLog = model('AuditLog', {
  fields: {
    id: field.column(int4Column).id(),
  },
}).sql({ table: 'audit_log' });

export const contract = defineContract({
  models: { Profile, AuditLog },
  entities: [
    rlsEnabled(Profile),
    rlsEnabled(AuditLog),
    policySelect(Profile, {
      name: 'profile_owner_read',
      roles: [authenticated],
      using: ownerPredicate,
    }),
    policySelect(Profile, { name: 'profile_public_read', roles: [anon], using: sql`true` }),
    policyUpdate(Profile, {
      name: 'profile_owner_write',
      roles: [authenticated],
      using: ownerPredicate,
      withCheck: ownerPredicate,
    }),
    policyInsert(Profile, {
      name: 'profile_owner_insert',
      roles: [authenticated],
      withCheck: ownerPredicate,
    }),
    policyDelete(Profile, {
      name: 'profile_owner_delete',
      roles: [authenticated],
      using: ownerPredicate,
    }),
    policyAll(Profile, {
      name: 'profile_admin_all',
      roles: [anon, authenticated],
      using: sql`true`,
      withCheck: sql`true`,
    }),
    policyUpdate(Profile, {
      name: 'profile_touch_write',
      roles: [authenticated],
      using: ownerPredicate,
    }),
    policySelect(AuditLog, { name: 'audit_read', roles: [authenticated], using: sql`true` }),
    role('app_role'),
  ],
});
