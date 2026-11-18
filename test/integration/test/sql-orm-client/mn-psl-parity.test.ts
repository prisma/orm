// PSL <-> TS-builder parity for the M:N ORM API.
//
// Every other M:N integration file drives the TS-builder fixture
// (`fixtures/contract.ts`). This file drives the PSL-authored fixture
// (`fixtures/mn-psl/contract.prisma`) instead: an explicit `UserTag`
// junction model lowered by the PSL interpreter to `cardinality: 'N:M'` +
// `through` on both sides. Deserializing the emitted JSON below runs the
// full sql contract validation pipeline, so each test also proves the
// PSL-emitted M:N contract round-trips validation.
//
// One representative case per ORM API surface (the exhaustive matrices live
// in mn-include / mn-filter / mn-nested-write against the TS fixture):
//
//   include        — explicit select + implicit default selection
//   filters        — some / none / every
//   nested writes  — connect / disconnect / nested create
//
// Standard:
//   1. Whole-row toEqual assertions on every test.
//   2. Explicit .select() in most tests; one implicit-selection readback.

import pgvectorRuntime from '@internal/extension-pgvector/runtime';
import { Collection } from '@internal/sql-orm-client';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import postgresTarget, { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { describe, expect, it } from 'vitest';
import type { Contract as MnPslContract } from './fixtures/mn-psl/generated/contract';
import mnPslContractJson from './fixtures/mn-psl/generated/contract.json' with { type: 'json' };
import { type IncludeStrategy, includeStrategies, postgresAdapterFor } from './helpers';
import {
  expectPerRelationStatements,
  timeouts,
  withCollectionRuntime,
} from './integration-helpers';
import type { PgIntegrationRuntime } from './runtime-helpers';
import { seedTags, seedUsers, seedUserTags } from './runtime-helpers';

const TAG_RUST = 'tag-rust';
const TAG_TS = 'tag-typescript';

// Deserialization runs the full sql contract validation pipeline
// (structure + domain + storage semantics), so a contract that failed to
// round-trip validation would throw here at module load.
const mnPslContract = new PostgresContractSerializer().deserializeContract(
  mnPslContractJson,
) as MnPslContract;

function mnPslContext(strategy: IncludeStrategy): ExecutionContext<MnPslContract> {
  return createExecutionContext({
    contract: mnPslContract,
    stack: createSqlExecutionStack({
      target: postgresTarget,
      adapter: postgresAdapterFor(strategy),
      extensions: [pgvectorRuntime],
    }),
  });
}

// The emitted PSL contract carries `sql.returning` / `postgres.returning`,
// so mutation readback works without any capability patching.
function createUsersCollection(runtime: PgIntegrationRuntime, strategy: IncludeStrategy) {
  return new Collection({ runtime, context: mnPslContext(strategy) }, 'User', {
    namespaceId: 'public',
  });
}

describe.each(includeStrategies)('integration/mn-psl-parity (%s)', (strategy) => {
  // ===========================================================================
  // include — read through the junction.
  // ===========================================================================

  it(
    'include("tags") with explicit select returns selected fields on user and tags (whole-row toEqual)',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime, strategy);

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' },
        ]);
        await seedTags(runtime, [
          { id: TAG_RUST, name: 'Rust' },
          { id: TAG_TS, name: 'TypeScript' },
        ]);
        await seedUserTags(runtime, [
          { userId: 1, tagId: TAG_RUST },
          { userId: 1, tagId: TAG_TS },
          { userId: 2, tagId: TAG_TS },
        ]);

        runtime.resetExecutions();
        const rows = await users
          .select('id', 'name')
          .orderBy((u) => u.id.asc())
          .include('tags', (tags) => tags.select('id', 'name').orderBy((t) => t.name.asc()))
          .all();
        expectPerRelationStatements(runtime, strategy, 2);

        expect(rows).toEqual([
          {
            id: 1,
            name: 'Alice',
            tags: [
              { id: TAG_RUST, name: 'Rust' },
              { id: TAG_TS, name: 'TypeScript' },
            ],
          },
          {
            id: 2,
            name: 'Bob',
            tags: [{ id: TAG_TS, name: 'TypeScript' }],
          },
        ]);
      }, mnPslContract);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'include("tags") with no .select returns the full default row shape (implicit selection)',
    async () => {
      // The PSL fixture's User carries exactly id/name/email, so the default
      // projection is narrower than the TS fixture's (no invitedById/address).
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime, strategy);

        await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
        await seedTags(runtime, [
          { id: TAG_RUST, name: 'Rust' },
          { id: TAG_TS, name: 'TypeScript' },
        ]);
        await seedUserTags(runtime, [
          { userId: 1, tagId: TAG_RUST },
          { userId: 1, tagId: TAG_TS },
        ]);

        runtime.resetExecutions();
        const rows = await users
          .orderBy((u) => u.id.asc())
          .include('tags', (tags) => tags.orderBy((t) => t.name.asc()))
          .all();
        expectPerRelationStatements(runtime, strategy, 2);

        expect(rows).toEqual([
          {
            id: 1,
            name: 'Alice',
            email: 'alice@example.com',
            tags: [
              { id: TAG_RUST, name: 'Rust' },
              { id: TAG_TS, name: 'TypeScript' },
            ],
          },
        ]);
      }, mnPslContract);
    },
    timeouts.spinUpPpgDev,
  );

  // ===========================================================================
  // Relation filters — some / none / every through junction EXISTS.
  // ===========================================================================

  it(
    'some: returns only users that have at least one matching tag (explicit select, whole-row toEqual)',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime, strategy);

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' },
          { id: 3, name: 'Cara', email: 'cara@example.com' },
        ]);
        await seedTags(runtime, [
          { id: TAG_RUST, name: 'Rust' },
          { id: TAG_TS, name: 'TypeScript' },
        ]);
        // Alice: Rust + TypeScript, Bob: TypeScript only, Cara: no tags.
        await seedUserTags(runtime, [
          { userId: 1, tagId: TAG_RUST },
          { userId: 1, tagId: TAG_TS },
          { userId: 2, tagId: TAG_TS },
        ]);

        const rows = await users
          .select('id', 'name')
          .where((u) => u.tags.some((t) => t.name.eq('Rust')))
          .orderBy((u) => u.id.asc())
          .all();

        // Only Alice has Rust.
        expect(rows).toEqual([{ id: 1, name: 'Alice' }]);
      }, mnPslContract);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'none: returns only users with no tag matching the predicate (explicit select, whole-row toEqual)',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime, strategy);

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' },
          { id: 3, name: 'Cara', email: 'cara@example.com' },
        ]);
        await seedTags(runtime, [
          { id: TAG_RUST, name: 'Rust' },
          { id: TAG_TS, name: 'TypeScript' },
        ]);
        // Alice: Rust only, Bob: TypeScript only, Cara: no tags.
        await seedUserTags(runtime, [
          { userId: 1, tagId: TAG_RUST },
          { userId: 2, tagId: TAG_TS },
        ]);

        const rows = await users
          .select('id', 'name')
          .where((u) => u.tags.none((t) => t.name.eq('Rust')))
          .orderBy((u) => u.id.asc())
          .all();

        // Bob has no Rust tag; Cara has no tags at all (also satisfies none).
        expect(rows).toEqual([
          { id: 2, name: 'Bob' },
          { id: 3, name: 'Cara' },
        ]);
      }, mnPslContract);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'every: returns users whose tags all match the predicate, includes the vacuous case (explicit select)',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime, strategy);

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' },
          { id: 3, name: 'Cara', email: 'cara@example.com' },
        ]);
        await seedTags(runtime, [
          { id: TAG_RUST, name: 'Rust' },
          { id: TAG_TS, name: 'TypeScript' },
        ]);
        // Alice: Rust only — all her tags match → qualifies.
        // Bob: Rust + TypeScript — partial match → excluded.
        // Cara: no tags — vacuously true → qualifies.
        await seedUserTags(runtime, [
          { userId: 1, tagId: TAG_RUST },
          { userId: 2, tagId: TAG_RUST },
          { userId: 2, tagId: TAG_TS },
        ]);

        const rows = await users
          .select('id', 'name')
          .where((u) => u.tags.every((t) => t.name.eq('Rust')))
          .orderBy((u) => u.id.asc())
          .all();

        expect(rows).toEqual([
          { id: 1, name: 'Alice' },
          { id: 3, name: 'Cara' },
        ]);
      }, mnPslContract);
    },
    timeouts.spinUpPpgDev,
  );

  // ===========================================================================
  // Nested writes — connect / disconnect / nested create through the junction.
  // ===========================================================================

  it(
    'update(): connect links an existing tag via the junction; include("tags") readback reflects the link (explicit select)',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime, strategy);

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
      }, mnPslContract);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'update(): disconnect removes the junction link; include("tags") readback no longer contains the tag (explicit select)',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime, strategy);

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
          'select user_id, tag_id from user_tags',
        );
        expect(junctionRows).toEqual([{ user_id: 1, tag_id: TAG_TS }]);
      }, mnPslContract);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'create(): nested create inserts the Tag row and the junction link; include("tags") readback reflects both (explicit select)',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime, strategy);

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
      }, mnPslContract);
    },
    timeouts.spinUpPpgDev,
  );
});
