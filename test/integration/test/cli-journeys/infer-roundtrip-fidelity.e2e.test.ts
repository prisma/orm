/**
 * Infer -> Emit Round-Trip Fidelity (TML-3037 — the instrument)
 *
 * `contract-infer-workflow.e2e.test.ts` already proves infer -> emit -> verify
 * on a two-column table. This journey runs the same shape against a schema
 * that carries the fidelity gaps TML-3037 tracks: an already-plural
 * back-relation target, a 1:1 FK, a 1:N FK, both `GENERATED ... AS IDENTITY`
 * variants plus a `serial` control column, a GIN index, a `USING hash` index,
 * array/jsonb defaults, a foreign key into a schema outside the introspected
 * scope, two foreign keys between the same table pair (one of them unique),
 * and a self-referencing unique foreign key — the two shapes under which
 * infer prints a *named* singular 1:1 back-relation (`@relation(name: ...)`
 * with no `fields`/`references`), as opposed to the bare, unnamed one a
 * single FK between a pair produces.
 *
 * Each `it()` isolates one defect so a single run reports every defect
 * independently instead of stopping at the first failure. Where an
 * unfixed defect would otherwise block `contract emit` before a later
 * defect gets a chance to run, the PSL is surgically reduced (fixing
 * everything except the one thing under test) so that defect's own error
 * surfaces on its own.
 */
import { withClient } from '@repo/test-utils';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  runContractEmit,
  runContractInfer,
  setupJourney,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';
import {
  expectVerifiesCleanAfterPull,
  fixIndexTypes,
  fixOneToOneBackRelation,
  readContractPsl,
  SEED_SQL,
  writeContractPsl,
} from './infer-roundtrip-fidelity/harness';

withTempDir(({ createTempDir }) => {
  describe('Journey: Infer -> Emit Round-Trip Fidelity', () => {
    const db = useDevDatabase({
      onReady: (cs) => withClient(cs, (client) => client.query(SEED_SQL)),
    });

    it(
      'back-relation naming — an already-plural child table does not double-pluralize',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });

        const infer = await runContractInfer(ctx);
        expect(infer.exitCode, `contract infer\n${stripAnsi(infer.stderr)}`).toBe(0);

        const psl = readContractPsl(ctx);
        expect(
          psl,
          'Users back-relation to the plural "sessions" table is "sessions", not "sessionses"',
        ).toMatch(/\bsessions\s+Sessions\[\]/);
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'the interpreter accepts the 1:1 back-relation infer prints for a unique FK',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });

        const infer = await runContractInfer(ctx);
        expect(infer.exitCode, `contract infer\n${stripAnsi(infer.stderr)}`).toBe(0);

        // Isolate the 1:1 back-relation defect: fix the one remaining
        // unrelated emit-blocker (non-btree index types) so any failure here
        // is attributable to the 1:1 back-relation alone.
        const reduced = fixIndexTypes(readContractPsl(ctx));
        writeContractPsl(ctx, reduced);

        const emit = await runContractEmit(ctx);
        expect(
          emit.exitCode,
          `contract emit should accept the bare "identities Identities?" 1:1 back-relation ` +
            `field; instead got:\n${stripAnsi(emit.stderr)}\n${stripAnsi(emit.stdout)}`,
        ).toBe(0);
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'the interpreter accepts a named 1:1 back-relation for two FKs sharing a table pair',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });

        const infer = await runContractInfer(ctx);
        expect(infer.exitCode, `contract infer\n${stripAnsi(infer.stderr)}`).toBe(0);

        const psl = readContractPsl(ctx);
        // `accounts` has two FKs to `users` (`primary_user_id` is unique,
        // `backup_user_id` isn't), so infer names both relations to
        // disambiguate and prints the 1:1 back side on Users as a singular
        // field carrying only a relation name — no fields/references — a
        // distinct shape from the unnamed singular back-relation a
        // single-FK table pair produces.
        expect(psl, 'Users carries a named singular back-relation to Accounts').toMatch(
          /\w+\s+Accounts\?\s+@relation\(name: "[^"]+"\)\s*$/m,
        );

        // Isolate the named-back-relation defect: fix the one remaining
        // unrelated emit-blocker (non-btree index types).
        const reduced = fixIndexTypes(psl);
        writeContractPsl(ctx, reduced);

        const emit = await runContractEmit(ctx);
        expect(
          emit.exitCode,
          'contract emit should accept the named singular 1:1 back-relation field on Users; ' +
            `instead got:\n${stripAnsi(emit.stderr)}\n${stripAnsi(emit.stdout)}`,
        ).toBe(0);
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'the interpreter accepts a named 1:1 back-relation for a self-referencing unique FK',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });

        const infer = await runContractInfer(ctx);
        expect(infer.exitCode, `contract infer\n${stripAnsi(infer.stderr)}`).toBe(0);

        const psl = readContractPsl(ctx);
        // `categories.parent_id` is a unique, self-referencing FK. A
        // self-relation always needs a name to disambiguate its two sides, so
        // infer prints the 1:1 back side as a singular `Categories?` field
        // carrying only a relation name, same as the two-FK case above.
        expect(psl, 'Categories carries a named singular self-referencing back-relation').toMatch(
          /\w+\s+Categories\?\s+@relation\(name: "[^"]+"\)\s*$/m,
        );

        const reduced = fixIndexTypes(psl);
        writeContractPsl(ctx, reduced);

        const emit = await runContractEmit(ctx);
        expect(
          emit.exitCode,
          'contract emit should accept the named singular self-referencing 1:1 back-relation ' +
            `field on Categories; instead got:\n${stripAnsi(emit.stderr)}\n${stripAnsi(emit.stdout)}`,
        ).toBe(0);
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'infer prints the empty-array default on tags as a PSL literal list, and it round-trips clean',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });

        const infer = await runContractInfer(ctx);
        expect(infer.exitCode, `contract infer\n${stripAnsi(infer.stderr)}`).toBe(0);

        const psl = readContractPsl(ctx);
        expect(psl, 'Users.tags carries a PSL literal-list default, not dbgenerated').toMatch(
          /tags\s+String\[\]\s+@default\(\[\]\)/,
        );
        expect(psl, 'Users.tags waives the element check its source database never had').toMatch(
          /tags\s+String\[\][^\n]*@noCheck\(elementNotNull\)/,
        );

        // Isolate the list-default defect: fix the one remaining unrelated
        // emit-blocker (1:1 back-relation). The gin/hash index types are left
        // exactly as infer printed them — postgres already registers those
        // access methods (TML-3037) — so verify below also proves that fix
        // stays clean alongside this one.
        const reduced = fixOneToOneBackRelation(psl);
        writeContractPsl(ctx, reduced);

        const emit = await runContractEmit(ctx);
        expect(
          emit.exitCode,
          'contract emit should accept @default([]) on Users.tags; ' +
            `instead got:\n${stripAnsi(emit.stderr)}\n${stripAnsi(emit.stdout)}`,
        ).toBe(0);

        await expectVerifiesCleanAfterPull(ctx, 'Users.tags');
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'infer prints a nullable text[] column as String[]? with its default, and it round-trips clean',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });

        const infer = await runContractInfer(ctx);
        expect(infer.exitCode, `contract infer\n${stripAnsi(infer.stderr)}`).toBe(0);

        const psl = readContractPsl(ctx);
        expect(psl, 'Users.labels is a nullable list with a literal-list default').toMatch(
          /labels\s+String\[\]\?\s+@default\(\[\]\)/,
        );

        const reduced = fixOneToOneBackRelation(psl);
        writeContractPsl(ctx, reduced);

        const emit = await runContractEmit(ctx);
        expect(
          emit.exitCode,
          'contract emit should accept String[]? @default([]) on Users.labels; ' +
            `instead got:\n${stripAnsi(emit.stderr)}\n${stripAnsi(emit.stdout)}`,
        ).toBe(0);

        await expectVerifiesCleanAfterPull(ctx, 'Users.labels');
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'postgres registers the gin and hash index types infer already prints',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });

        const infer = await runContractInfer(ctx);
        expect(infer.exitCode, `contract infer\n${stripAnsi(infer.stderr)}`).toBe(0);

        // Isolate the index-type defect: fix the one remaining unrelated
        // emit-blocker (1:1 back-relation).
        const reduced = fixOneToOneBackRelation(readContractPsl(ctx));
        writeContractPsl(ctx, reduced);

        const emit = await runContractEmit(ctx);
        expect(
          emit.exitCode,
          `contract emit should accept @@index(..., type: "gin"/"hash"); instead got:\n` +
            `${stripAnsi(emit.stderr)}\n${stripAnsi(emit.stdout)}`,
        ).toBe(0);
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'a foreign key outside the introspected schema surfaces an explanatory comment',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });

        const infer = await runContractInfer(ctx);
        expect(infer.exitCode, `contract infer\n${stripAnsi(infer.stderr)}`).toBe(0);

        const psl = readContractPsl(ctx);
        // sessions.owner_ref points at secure.owners, outside the introspected
        // `public` schema — the scalar column must survive...
        expect(psl, 'dangling FK keeps its scalar column').toContain('ownerRef');
        // ...and the model must explain why the relation is missing, the same
        // way infer already documents a table with no primary key.
        expect(psl, 'Sessions documents the dropped cross-schema relation with a comment').toMatch(
          /\/\/[^\n]*\n\s*model Sessions \{/,
        );
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'identity columns (both GENERATED variants) round-trip as autoincrement(); serial keeps working',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });

        const infer = await runContractInfer(ctx);
        expect(infer.exitCode, `contract infer\n${stripAnsi(infer.stderr)}`).toBe(0);

        const psl = readContractPsl(ctx);
        expect(psl, 'serial column already carries autoincrement() (control)').toMatch(
          /id\s+Int\s+@id\(map: "identities_pkey"\)\s+@default\(autoincrement\(\)\)/,
        );
        expect(psl, 'GENERATED ALWAYS AS IDENTITY (users.id) carries autoincrement()').toMatch(
          /id\s+Int\s+@id\(map: "users_pkey"\)\s+@default\(autoincrement\(\)\)/,
        );
        expect(
          psl,
          'GENERATED BY DEFAULT AS IDENTITY (sessions.id) carries autoincrement()',
        ).toMatch(/id\s+Int\s+@id\(map: "sessions_pkey"\)\s+@default\(autoincrement\(\)\)/);
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'a jsonb, numeric and temporal literal default round-trip clean through db verify --schema-only',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });

        const infer = await runContractInfer(ctx);
        expect(infer.exitCode, `contract infer\n${stripAnsi(infer.stderr)}`).toBe(0);

        // Each default prints as the literal its codec reads back: a jsonb
        // document as a `json` tag, a numeric keeping the trailing zero it was
        // stored with, and a timestamp as the text its codec parses.
        const printed = readContractPsl(ctx);
        expect(printed).toContain('@default(json`{}`)');
        expect(printed).toContain('@default(1.50)');
        expect(printed).toContain('@default("2024-01-01 00:00:00")');

        // Fix the one remaining unrelated emit-blocker (1:1 back-relation) so
        // emit succeeds and verify can run. Everything else is left exactly as
        // infer printed it.
        writeContractPsl(ctx, fixOneToOneBackRelation(printed));

        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, `contract emit\n${stripAnsi(emit.stderr)}`).toBe(0);

        await expectVerifiesCleanAfterPull(ctx, 'Users.metadata, Users.fee, Users.joinedAt');
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'an expression index infers with expression: and map:, body as the live reprint',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        const infer = await runContractInfer(ctx);
        expect(infer.exitCode, `contract infer\n${stripAnsi(infer.stderr)}`).toBe(0);
        expect(readContractPsl(ctx)).toContain(
          '@@index(expression: "lower(email)", map: "users_email_lower_idx")',
        );
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'a partial index infers with its where: predicate verbatim',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        const infer = await runContractInfer(ctx);
        expect(infer.exitCode, `contract infer\n${stripAnsi(infer.stderr)}`).toBe(0);
        expect(readContractPsl(ctx)).toContain(
          '@@index([email], map: "users_email_active_idx", where: "(birth_date IS NULL)")',
        );
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'a unique expression index infers with unique: true instead of being dropped',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        const infer = await runContractInfer(ctx);
        expect(infer.exitCode, `contract infer\n${stripAnsi(infer.stderr)}`).toBe(0);
        const psl = readContractPsl(ctx);
        expect(psl).toContain(
          '@@index(expression: "lower(email)", map: "users_email_ci_key", unique: true)',
        );
        expect(psl).toContain('@@index([email], map: "users_email_plain_key", unique: true)');
      },
      timeouts.spinUpPpgDev,
    );

    it(
      "a default-method index with reloptions infers as explicit type: 'btree' + options:",
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        const infer = await runContractInfer(ctx);
        expect(infer.exitCode, `contract infer\n${stripAnsi(infer.stderr)}`).toBe(0);
        expect(readContractPsl(ctx)).toContain(
          '@@index([email], map: "users_email_ff_idx", type: "btree", options: { fillfactor: "70" })',
        );
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'an RLS-enabled table infers @@rls and a permissive policy infers a policy block with @@map',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        const infer = await runContractInfer(ctx);
        expect(infer.exitCode, `contract infer\n${stripAnsi(infer.stderr)}`).toBe(0);
        const psl = readContractPsl(ctx);
        expect(psl).toContain('@@rls');
        expect(psl).toContain('policy_select users_owner_read {');
        expect(psl).toContain('roles = [fidelity_app_user]');
        expect(psl).toContain('using = "(id = 1)"');
        expect(psl).toContain('@@map("users_owner_read")');
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'a RESTRICTIVE multi-role policy infers permissive = false with withCheck verbatim',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        const infer = await runContractInfer(ctx);
        expect(infer.exitCode, `contract infer\n${stripAnsi(infer.stderr)}`).toBe(0);
        const psl = readContractPsl(ctx);
        expect(psl).toContain('policy_update Users_restrictive_write {');
        expect(psl).toContain('roles = [fidelity_app_user, fidelity_auditor]');
        expect(psl).toContain('withCheck = "(id = 2)"');
        expect(psl).toContain('permissive = false');
        expect(psl).toContain('@@map("Users restrictive write")');
      },
      timeouts.spinUpPpgDev,
    );
  });
});
