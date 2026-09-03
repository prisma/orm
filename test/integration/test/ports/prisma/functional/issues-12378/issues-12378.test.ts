import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/issues/12378
// (postgres matrix entry; sqlite/mongodb opted-out upstream).
//
// Verifies that updating a User field after creating a Workspace with a nested
// join-table connection does not throw.
//
// Upstream: `workspace.create({ data: { name, users: { create: [{ user: { connect: { id } } }] } } })`
// creates the workspace with a nested UsersOnWorkspaces create that connects
// the existing user via the join model. The faithful port uses the same
// nested mutation shape through the ORM's nested create + connect path.

describe('ports/prisma/functional/issues-12378', () => {
  it(
    'issue 12378',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        const user = await db.public.User.create({
          email: 'user@example.com',
          name: 'Max',
        });
        expect(user.email).toBe('user@example.com');
        expect(user.name).toBe('Max');
        expect(user.id).toBeTruthy();

        // Faithful port: create the workspace with nested UsersOnWorkspaces
        // create that connects the existing user — matching upstream's
        // `users: { create: [{ user: { connect: { id } } }] }` shape.
        const workspace = await db.public.Workspace.select('id', 'name').create({
          name: 'workspace',
          users: (u) => u.create([{ user: (usr) => usr.connect({ id: user.id }) }]),
        });
        expect(workspace.name).toBe('workspace');
        expect(workspace.id).toBeTruthy();

        const userAsBob = await db.public.User.select('id', 'email', 'name')
          .where({ id: user.id })
          .update({ name: 'Bob' });
        expect(userAsBob).not.toBeNull();
        expect(userAsBob!.email).toBe('user@example.com');
        expect(userAsBob!.name).toBe('Bob');
        expect(userAsBob!.id).toBeTruthy();
        expect(user.id).toMatch(userAsBob!.id);
      }),
    timeouts.spinUpPpgDev,
  );
});
