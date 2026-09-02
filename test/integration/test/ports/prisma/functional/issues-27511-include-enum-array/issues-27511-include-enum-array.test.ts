import type { Varchar } from '@internal/target-postgres/codec-types';
import { blindCast } from '@internal/utils/casts';
import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/issues/27511-include-enum-array
// (postgres only).
//
// Subject: findMany with include over a M:N relation when a model has an
// enum-array column (`permissions workspace_permission[]`) returns the correct data.
//
// Schema note: upstream uses implicit M:N (workspace_member.roles / workspace_role.members).
// prisma-next requires explicit junction models; the faithful port introduces
// `workspace_member_role` as the junction table.
//
// `workspace_role.permissions` is a `workspace_permission[]` (text-backed enum
// list). That column used to lower to `CHECK (permissions IN ('HELLO','WORLD'))`,
// which Postgres rejects for an array column, so the push failed before any ORM
// query ran. The membership check is now array containment.
//
// The id fields are VarChar(30) → Varchar<30> branded type. blindCast is used
// to pass literal strings as the correct branded type.

describe('ports/prisma/functional/issues-27511-include-enum-array', () => {
  it(
    'findMany with include on many-to-many relationship with enum array should work',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        const roleId = blindCast<Varchar<30>, 'varchar id literal'>('role-1');
        const memberId = blindCast<Varchar<30>, 'varchar id literal'>('member-1');

        await db.public.workspace_role.create({
          id: roleId,
          name: 'Editor',
          permissions: ['HELLO', 'WORLD'],
        });
        await db.public.workspace_member.create({ id: memberId });
        await db.public.workspace_member_role.create({
          memberId,
          roleId,
        });

        const result = await db.public.workspace_member
          .include('roles', (roles) =>
            roles.include('role', (role) => role.select('name', 'permissions')),
          )
          .all();

        expect(result).toMatchObject([
          {
            roles: [
              {
                role: {
                  name: 'Editor',
                  permissions: ['HELLO', 'WORLD'],
                },
              },
            ],
          },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );
});
