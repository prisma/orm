import { int4Column, textColumn } from '@internal/adapter-postgres/column-types';
import { defineContract, field, gen, model, rel, type } from '@internal/postgres/contract-builder';

// Two domain namespaces (`public` + `shadow`) each declare the SAME junction
// table `user_roles` with the SAME payload column `token`, but only the
// `public` junction carries an execution-time onCreate default for it.
// Execution-default refs are namespace-scoped, so the junction-payload type gate
// must match `(namespace, table, column)`: `shadow.user_roles.token` is a
// required payload column with no default and must NOT borrow `public`'s
// default. Emitted (not DSL-`typeof`) so the gate's `NamespaceModelsOf`
// resolution has literal namespace keys to work against.

const PublicRole = model('Role', {
  fields: {
    id: field.column(textColumn).id(),
    name: field.column(textColumn).unique(),
  },
}).sql({ table: 'roles' });

const PublicUserRole = model('UserRole', {
  fields: {
    userId: field.column(int4Column).column('user_id'),
    roleId: field.column(textColumn).column('role_id'),
    token: field.column(type.Char(36)).onCreate(gen.uuid()),
  },
})
  .attributes(({ fields, constraints }) => ({
    id: constraints.id([fields.userId, fields.roleId]),
  }))
  .sql({ table: 'user_roles' });

const PublicUser = model('User', {
  fields: {
    id: field.column(int4Column).id(),
    name: field.column(textColumn),
    email: field.column(textColumn).unique(),
  },
})
  .relations({
    roles: rel.manyToMany(() => PublicRole, {
      through: () => PublicUserRole,
      from: 'userId',
      to: 'roleId',
    }),
  })
  .sql({ table: 'users' });

const ShadowRole = model('ShadowRole', {
  namespace: 'shadow',
  fields: {
    id: field.column(textColumn).id(),
    name: field.column(textColumn).unique(),
  },
}).sql({ table: 'roles' });

const ShadowUserRole = model('ShadowUserRole', {
  namespace: 'shadow',
  fields: {
    userId: field.column(int4Column).column('user_id'),
    roleId: field.column(textColumn).column('role_id'),
    // Required NOT NULL payload column with NO default in the `shadow`
    // namespace — the arm that must keep create/connect disabled.
    token: field.column(textColumn),
  },
})
  .attributes(({ fields, constraints }) => ({
    id: constraints.id([fields.userId, fields.roleId]),
  }))
  .sql({ table: 'user_roles' });

const ShadowUser = model('ShadowUser', {
  namespace: 'shadow',
  fields: {
    id: field.column(int4Column).id(),
    name: field.column(textColumn),
    email: field.column(textColumn).unique(),
  },
})
  .relations({
    roles: rel.manyToMany(() => ShadowRole, {
      through: () => ShadowUserRole,
      from: 'userId',
      to: 'roleId',
    }),
  })
  .sql({ table: 'users' });

export const contract = defineContract({
  namespaces: ['shadow'],
  models: {
    User: PublicUser,
    Role: PublicRole,
    UserRole: PublicUserRole,
    ShadowUser: ShadowUser,
    ShadowRole: ShadowRole,
    ShadowUserRole: ShadowUserRole,
  },
});
