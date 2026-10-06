// Integration coverage for M:N nested writes through the junction table.
//
// Two M:N relations on User are exercised:
//
//   User.tags  — pure junction (user_tags: user_id, tag_id).
//                connect / disconnect / create are all supported.
//
//   User.roles — required-payload junction (user_roles: user_id, role_id,
//                level NOT NULL). connect and create both throw a runtime guard
//                error; only disconnect is allowed.
//
// Standard:
//   1. Whole-row toEqual on the readback (via include('tags') / include('roles')).
//   2. Explicit .select() used in most tests.
//   3. At least one implicit/default-selection readback.

import postgresAdapter from '@internal/adapter-postgres/runtime';
import pgvectorRuntime from '@internal/extension-pgvector/runtime';
import { Collection } from '@internal/sql-orm-client';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import type { Char } from '@internal/target-postgres/codec-types';
import postgresTarget from '@internal/target-postgres/runtime';
import { describe, expect, it } from 'vitest';
import { getExecutionDefaultedTagsContract } from './helpers';
import {
  createReturningUsersCollection,
  timeouts,
  withCollectionRuntime,
} from './integration-helpers';
import { seedRoles, seedTags, seedUserRoles, seedUsers, seedUserTags } from './runtime-helpers';

const TAG_RUST = 'tag-rust' as Char<36>;
const TAG_TS = 'tag-typescript' as Char<36>;
const ROLE_ADMIN = 'role-admin' as Char<36>;
const ROLE_EDITOR = 'role-editor' as Char<36>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('integration/mn-nested-write', () => {
  // ===========================================================================
  // connect — create() parent flow
  // ===========================================================================

  it(
    'create(): connect links an existing tag via junction; include("tags") readback reflects the link (explicit select)',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await seedTags(runtime, [{ id: TAG_RUST, name: 'Rust' }]);

        const created = await users
          .select('id', 'name')
          .include('tags', (tags) => tags.select('id', 'name'))
          .create({
            id: 1,
            name: 'Alice',
            email: 'alice@example.com',
            tags: (t) => t.connect({ id: TAG_RUST }),
          });

        expect(created).toEqual({
          id: 1,
          name: 'Alice',
          tags: [{ id: TAG_RUST, name: 'Rust' }],
        });

        const junctionRows = await runtime.query<{ user_id: number; tag_id: string }>(
          'select user_id, tag_id from user_tags',
        );
        expect(junctionRows).toEqual([{ user_id: 1, tag_id: TAG_RUST }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'create(): connect links multiple existing tags; include("tags") readback contains all (explicit select)',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await seedTags(runtime, [
          { id: TAG_RUST, name: 'Rust' },
          { id: TAG_TS, name: 'TypeScript' },
        ]);

        const created = await users
          .select('id', 'name')
          .include('tags', (tags) => tags.select('id', 'name').orderBy((t) => t.name.asc()))
          .create({
            id: 2,
            name: 'Bob',
            email: 'bob@example.com',
            tags: (t) => t.connect([{ id: TAG_RUST }, { id: TAG_TS }]),
          });

        expect(created).toEqual({
          id: 2,
          name: 'Bob',
          tags: [
            { id: TAG_RUST, name: 'Rust' },
            { id: TAG_TS, name: 'TypeScript' },
          ],
        });
      });
    },
    timeouts.spinUpPpgDev,
  );

  // ===========================================================================
  // connect — update() parent flow
  // ===========================================================================

  it(
    'update(): connect links an existing tag to an existing user; include("tags") readback reflects the link (explicit select)',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
        await seedTags(runtime, [{ id: TAG_RUST, name: 'Rust' }]);

        const updated = await users
          .where({ id: 1 })
          .select('id', 'name')
          .include('tags', (tags) => tags.select('id', 'name'))
          .update({
            tags: (t) => t.connect({ id: TAG_RUST }),
          });

        expect(updated).toEqual({
          id: 1,
          name: 'Alice',
          tags: [{ id: TAG_RUST, name: 'Rust' }],
        });

        const junctionRows = await runtime.query<{ user_id: number; tag_id: string }>(
          'select user_id, tag_id from user_tags',
        );
        expect(junctionRows).toEqual([{ user_id: 1, tag_id: TAG_RUST }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'update(): connect to an already-linked tag rejects and preserves the junction link',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
        await seedTags(runtime, [{ id: TAG_RUST, name: 'Rust' }]);
        await seedUserTags(runtime, [{ userId: 1, tagId: TAG_RUST }]);

        await expect(
          users
            .where({ id: 1 })
            .select('id', 'name')
            .include('tags', (tags) => tags.select('id', 'name'))
            .update({
              tags: (t) => t.connect({ id: TAG_RUST }),
            }),
        ).rejects.toThrow(/violated a unique constraint on junction "user_tags"/);

        const junctionRows = await runtime.query<{ user_id: number; tag_id: string }>(
          'select user_id, tag_id from user_tags',
        );
        expect(junctionRows).toEqual([{ user_id: 1, tag_id: TAG_RUST }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'create(): connect to a missing tag rejects and leaves no partial parent or junction write',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await expect(
          users.create({
            id: 1,
            name: 'Alice',
            email: 'alice@example.com',
            tags: (t) => t.connect({ id: TAG_RUST }),
          }),
        ).rejects.toThrow(/did not find a matching row/);

        const userRows = await runtime.query<{ id: number }>('select id from users');
        expect(userRows).toEqual([]);

        const junctionRows = await runtime.query<{ user_id: number; tag_id: string }>(
          'select user_id, tag_id from user_tags',
        );
        expect(junctionRows).toEqual([]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'create(): parent insert failure after a successful connect preflight leaves no junction rows',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
        await seedTags(runtime, [{ id: TAG_RUST, name: 'Rust' }]);

        await expect(
          users.create({
            // Duplicate primary key: the connect preflight resolves the tag
            // successfully, then the parent INSERT fails on the users pkey.
            id: 1,
            name: 'Alpha',
            email: 'alpha@example.com',
            tags: (t) => t.connect({ id: TAG_RUST }),
          }),
        ).rejects.toThrow(/duplicate key|unique constraint/i);

        const userRows = await runtime.query<{ id: number; name: string }>(
          'select id, name from users',
        );
        expect(userRows).toEqual([{ id: 1, name: 'Alice' }]);

        const junctionRows = await runtime.query<{ user_id: number; tag_id: string }>(
          'select user_id, tag_id from user_tags',
        );
        expect(junctionRows).toEqual([]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'create(): nested tag create failing after the parent insert rolls back the parent and junction',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        // Seed the tag so the nested target INSERT collides on the tags pkey.
        // Unlike the connect-preflight cases, this failure happens *after* the
        // parent user is inserted (the target INSERT runs in the apply phase that
        // follows the parent insert), so it exercises transactional rollback of
        // an already-written parent row — not just preflight rejection.
        await seedTags(runtime, [{ id: TAG_RUST, name: 'Rust' }]);

        await expect(
          users.create({
            id: 2,
            name: 'Bob',
            email: 'bob@example.com',
            tags: (t) => t.create([{ id: TAG_RUST, name: 'Rust (duplicate)' }]),
          }),
        ).rejects.toThrow(/duplicate key|unique constraint/i);

        const userRows = await runtime.query<{ id: number }>('select id from users');
        expect(userRows).toEqual([]);

        const junctionRows = await runtime.query<{ user_id: number; tag_id: string }>(
          'select user_id, tag_id from user_tags',
        );
        expect(junctionRows).toEqual([]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  // ===========================================================================
  // disconnect — update() parent flow (only supported path)
  // ===========================================================================

  it(
    'update(): disconnect removes the junction link; include("tags") readback no longer contains the tag (explicit select)',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
        await seedTags(runtime, [
          { id: TAG_RUST, name: 'Rust' },
          { id: TAG_TS, name: 'TypeScript' },
        ]);
        await seedUserTags(runtime, [
          { userId: 1, tagId: TAG_RUST },
          { userId: 1, tagId: TAG_TS },
        ]);

        const updated = await users
          .where({ id: 1 })
          .select('id', 'name')
          .include('tags', (tags) => tags.select('id', 'name'))
          .update({
            tags: (t) => t.disconnect([{ id: TAG_RUST }]),
          });

        expect(updated).toEqual({
          id: 1,
          name: 'Alice',
          tags: [{ id: TAG_TS, name: 'TypeScript' }],
        });

        const junctionRows = await runtime.query<{ user_id: number; tag_id: string }>(
          'select user_id, tag_id from user_tags order by tag_id',
        );
        expect(junctionRows).toEqual([{ user_id: 1, tag_id: TAG_TS }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'update(): disconnect all tags leaves an empty junction; include("tags") returns [] (implicit selection)',
    async () => {
      // Standard requirement: at least one test without .select() on the
      // parent so the full default row shape is asserted.
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
        await seedTags(runtime, [{ id: TAG_RUST, name: 'Rust' }]);
        await seedUserTags(runtime, [{ userId: 1, tagId: TAG_RUST }]);

        const updated = await users
          .where({ id: 1 })
          .include('tags', (tags) => tags.orderBy((t) => t.name.asc()))
          .update({
            tags: (t) => t.disconnect([{ id: TAG_RUST }]),
          });

        // Full User shape + tags: [] (junction row deleted, no .select() on parent).
        expect(updated).toEqual({
          id: 1,
          name: 'Alice',
          email: 'alice@example.com',
          invitedById: null,
          address: null,
          tags: [],
        });

        const junctionRows = await runtime.query<{ user_id: number; tag_id: string }>(
          'select user_id, tag_id from user_tags',
        );
        expect(junctionRows).toEqual([]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'update(): disconnect from a missing tag rejects and preserves existing junction links',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
        await seedTags(runtime, [{ id: TAG_TS, name: 'TypeScript' }]);
        await seedUserTags(runtime, [{ userId: 1, tagId: TAG_TS }]);

        await expect(
          users
            .where({ id: 1 })
            .select('id', 'name')
            .include('tags', (tags) => tags.select('id', 'name'))
            .update({
              tags: (t) => t.disconnect([{ id: TAG_RUST }]),
            }),
        ).rejects.toThrow(/did not find a matching row/);

        const junctionRows = await runtime.query<{ user_id: number; tag_id: string }>(
          'select user_id, tag_id from user_tags',
        );
        expect(junctionRows).toEqual([{ user_id: 1, tag_id: TAG_TS }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  // ===========================================================================
  // nested create — pure junction (User.tags, no required payload columns)
  // ===========================================================================

  it(
    'create(): nested create inserts the Tag row and the junction link; include("tags") readback reflects both (explicit select)',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        const created = await users
          .select('id', 'name')
          .include('tags', (tags) => tags.select('id', 'name'))
          .create({
            id: 1,
            name: 'Alice',
            email: 'alice@example.com',
            tags: (t) => t.create([{ id: TAG_RUST, name: 'Rust' }]),
          });

        expect(created).toEqual({
          id: 1,
          name: 'Alice',
          tags: [{ id: TAG_RUST, name: 'Rust' }],
        });

        const tagRows = await runtime.query<{ id: string; name: string }>(
          'select id, name from tags',
        );
        expect(tagRows).toEqual([{ id: TAG_RUST, name: 'Rust' }]);

        const junctionRows = await runtime.query<{ user_id: number; tag_id: string }>(
          'select user_id, tag_id from user_tags',
        );
        expect(junctionRows).toEqual([{ user_id: 1, tag_id: TAG_RUST }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'update(): nested create inserts Tag rows and junction links; include("tags") readback reflects all (explicit select)',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);

        const updated = await users
          .where({ id: 1 })
          .select('id', 'name')
          .include('tags', (tags) => tags.select('id', 'name').orderBy((t) => t.name.asc()))
          .update({
            tags: (t) =>
              t.create([
                { id: TAG_RUST, name: 'Rust' },
                { id: TAG_TS, name: 'TypeScript' },
              ]),
          });

        expect(updated).toEqual({
          id: 1,
          name: 'Alice',
          tags: [
            { id: TAG_RUST, name: 'Rust' },
            { id: TAG_TS, name: 'TypeScript' },
          ],
        });

        const tagRows = await runtime.query<{ id: string }>('select id from tags order by id');
        expect(tagRows).toEqual([{ id: TAG_RUST }, { id: TAG_TS }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  // ===========================================================================
  // Runtime disable: nested create on required-payload junction (User.roles)
  // ===========================================================================

  it(
    'create(): nested create on User.roles throws because the junction has a required payload column (level)',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await expect(
          users.create({
            id: 1,
            name: 'Alice',
            email: 'alice@example.com',
            // The type gate forbids `create` on a required-payload junction at
            // compile time; cast the arg to bypass it and exercise the runtime
            // guard (defense-in-depth) against a real database.
            roles: (r) => r.create([{ id: ROLE_ADMIN, name: 'Admin' }] as never),
          }),
        ).rejects.toThrow(/required column.*`level`/);

        const userRows = await runtime.query<{ id: number }>('select id from users');
        expect(userRows).toEqual([]);

        const roleRows = await runtime.query<{ id: string }>('select id from roles');
        expect(roleRows).toEqual([]);

        const junctionRows = await runtime.query<{ user_id: number; role_id: string }>(
          'select user_id, role_id from user_roles',
        );
        expect(junctionRows).toEqual([]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'update(): connect on User.roles rejects before the scalar update persists',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
        await seedRoles(runtime, [{ id: ROLE_ADMIN, name: 'Admin' }]);

        await expect(
          users.where({ id: 1 }).update({
            name: 'Alice Updated',
            // The type gate forbids `connect` on a required-payload junction at
            // compile time; cast the arg to bypass it and exercise the runtime
            // guard's preflight ordering (the junction rejection must land
            // before the scalar UPDATE).
            roles: (r) => r.connect({ id: ROLE_ADMIN } as never),
          }),
        ).rejects.toThrow(/required column.*`level`/);

        const userRows = await runtime.query<{ id: number; name: string }>(
          'select id, name from users',
        );
        expect(userRows).toEqual([{ id: 1, name: 'Alice' }]);

        const junctionRows = await runtime.query<{ user_id: number; role_id: string }>(
          'select user_id, role_id from user_roles',
        );
        expect(junctionRows).toEqual([]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  // ===========================================================================
  // connect/disconnect on required-payload junction (User.roles) — must succeed
  // ===========================================================================

  it(
    'create(): connect on User.roles throws because the junction has a required payload column (level)',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await seedRoles(runtime, [{ id: ROLE_ADMIN, name: 'Admin' }]);

        await expect(
          users.create({
            id: 1,
            name: 'Alice',
            email: 'alice@example.com',
            // The type gate forbids `connect` on a required-payload junction at
            // compile time; cast the arg to bypass it and exercise the runtime
            // guard (defense-in-depth).
            roles: (r) => r.connect({ id: ROLE_ADMIN } as never),
          }),
        ).rejects.toThrow(/required column.*`level`/);

        const userRows = await runtime.query<{ id: number }>('select id from users');
        expect(userRows).toEqual([]);

        const roleRows = await runtime.query<{ id: string; name: string }>(
          'select id, name from roles',
        );
        expect(roleRows).toEqual([{ id: ROLE_ADMIN, name: 'Admin' }]);

        const junctionRows = await runtime.query<{ user_id: number; role_id: string }>(
          'select user_id, role_id from user_roles',
        );
        expect(junctionRows).toEqual([]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  // ===========================================================================
  // Execution-defaulted junction payload column — connect must apply defaults
  // ===========================================================================

  it(
    'create(): connect applies an execution-time onCreate default to a junction payload column',
    async () => {
      // Emitted fixture: `user_tags.created_at` is NOT NULL with an execution-time
      // onCreate default and no storage/DB default, so if the junction INSERT
      // fails to apply the execution default the test dies with a NOT NULL
      // violation rather than silently passing via a database default.
      const contract = getExecutionDefaultedTagsContract();

      await withCollectionRuntime(async (runtime) => {
        // The defaults applier closes over the contract the context was
        // created from, so build the context from the same emitted contract.
        const context = createExecutionContext({
          contract,
          stack: createSqlExecutionStack({
            target: postgresTarget,
            adapter: postgresAdapter,
            extensions: [pgvectorRuntime],
          }),
        });
        const users = new Collection({ runtime, context }, 'User', { namespaceId: 'public' });

        await seedTags(runtime, [{ id: TAG_RUST, name: 'Rust' }]);

        const created = await users
          .select('id', 'name')
          .include('tags', (tags) => tags.select('id', 'name'))
          .create({
            id: 1,
            name: 'Alice',
            email: 'alice@example.com',
            tags: (t) => t.connect({ id: TAG_RUST }),
          });

        expect(created).toEqual({
          id: 1,
          name: 'Alice',
          tags: [{ id: TAG_RUST, name: 'Rust' }],
        });

        const junctionRows = await runtime.query<{
          user_id: number;
          tag_id: string;
          created_at: string;
        }>('select user_id, tag_id, created_at from user_tags');
        expect(junctionRows).toEqual([
          {
            user_id: 1,
            tag_id: TAG_RUST,
            created_at: expect.stringMatching(UUID_PATTERN),
          },
        ]);
      }, contract);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'update(): disconnect on User.roles deletes the junction link; include("roles") readback is empty (explicit select)',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
        await seedRoles(runtime, [
          { id: ROLE_ADMIN, name: 'Admin' },
          { id: ROLE_EDITOR, name: 'Editor' },
        ]);
        await seedUserRoles(runtime, [
          { userId: 1, roleId: ROLE_ADMIN, level: 5 },
          { userId: 1, roleId: ROLE_EDITOR, level: 3 },
        ]);

        const updated = await users
          .where({ id: 1 })
          .select('id', 'name')
          .include('roles', (roles) => roles.select('id', 'name'))
          .update({
            roles: (r) => r.disconnect([{ id: ROLE_ADMIN }]),
          });

        expect(updated).toEqual({
          id: 1,
          name: 'Alice',
          roles: [{ id: ROLE_EDITOR, name: 'Editor' }],
        });

        const junctionRows = await runtime.query<{ user_id: number; role_id: string }>(
          'select user_id, role_id from user_roles',
        );
        expect(junctionRows).toEqual([{ user_id: 1, role_id: ROLE_EDITOR }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'update(): an array on a junction relation applies disconnect, connect and create in array order',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
        await seedTags(runtime, [
          { id: TAG_RUST, name: 'Rust' },
          { id: TAG_TS, name: 'TypeScript' },
        ]);
        await seedUserTags(runtime, [{ userId: 1, tagId: TAG_RUST }]);

        const updated = await users
          .where({ id: 1 })
          .select('id', 'name')
          .include('tags', (tags) => tags.select('name').orderBy((t) => t.name.asc()))
          .update({
            tags: (t) => [
              t.disconnect([{ id: TAG_RUST }]),
              t.connect({ id: TAG_TS }),
              t.create({ name: 'Go' }),
              t.connect({ id: TAG_RUST }),
            ],
          });

        expect(updated).toEqual({
          id: 1,
          name: 'Alice',
          tags: [{ name: 'Go' }, { name: 'Rust' }, { name: 'TypeScript' }],
        });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'update(): a later disconnect in the array removes the link an earlier connect made',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
        await seedTags(runtime, [
          { id: TAG_RUST, name: 'Rust' },
          { id: TAG_TS, name: 'TypeScript' },
        ]);
        await seedUserTags(runtime, [{ userId: 1, tagId: TAG_RUST }]);

        const updated = await users
          .where({ id: 1 })
          .select('id', 'name')
          .include('tags', (tags) => tags.select('id', 'name'))
          .update({
            tags: (t) => [t.connect({ id: TAG_TS }), t.disconnect([{ id: TAG_TS }])],
          });

        expect(updated).toEqual({
          id: 1,
          name: 'Alice',
          tags: [{ id: TAG_RUST, name: 'Rust' }],
        });

        const junctionRows = await runtime.query<{ user_id: number; tag_id: string }>(
          'select user_id, tag_id from user_tags',
        );
        expect(junctionRows).toEqual([{ user_id: 1, tag_id: TAG_RUST }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'create(): an array on a junction relation connects and creates tags',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await seedTags(runtime, [{ id: TAG_RUST, name: 'Rust' }]);

        const created = await users
          .select('id', 'name')
          .include('tags', (tags) => tags.select('name').orderBy((t) => t.name.asc()))
          .create({
            id: 1,
            name: 'Alice',
            email: 'alice@example.com',
            tags: (t) => [t.connect({ id: TAG_RUST }), t.create({ name: 'Go' })],
          });

        expect(created).toEqual({
          id: 1,
          name: 'Alice',
          tags: [{ name: 'Go' }, { name: 'Rust' }],
        });
      });
    },
    timeouts.spinUpPpgDev,
  );
});
