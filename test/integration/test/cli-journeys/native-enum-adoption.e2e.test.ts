/**
 * Native Enum Adoption round trip (slice DoD, projects/native-postgres-enums)
 *
 * A live database containing native Postgres enum types + enum-typed columns
 * round-trips: `contract infer` writes a contract.prisma that parses and
 * builds via `contract emit`, and the built contract passes
 * `db verify --schema-only` against the SOURCE database. Columns type as the
 * member value union on the emitted path (contract.json valueSet).
 *
 * Two shapes:
 *  - public: the full CLI chain (infer → emit → verify).
 *  - auth (the Supabase `auth.aal_level` pattern): `contract infer`'s CLI
 *    entry introspects only the default schema (it passes no contract to
 *    introspection), so the auth-shaped inference drives the family instance
 *    with an auth-declaring contract — the same introspect→infer path — and
 *    then feeds the emitted PSL through the SAME CLI emit + verify chain.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { withClient } from '@repo/test-utils';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  runContractEmit,
  runContractInfer,
  runDbVerify,
  setupJourney,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';
import { inferPostgresNamespacePsl } from '../utils/journey-workspace-helpers';

const SEED_SQL = `
  CREATE TYPE ticket_status AS ENUM ('draft', 'review', 'done');
  CREATE TABLE ticket (
    id int4 PRIMARY KEY,
    status ticket_status NOT NULL,
    note text
  );
  CREATE SCHEMA auth;
  CREATE TYPE auth.aal_level AS ENUM ('aal1', 'aal2', 'aal3');
  CREATE TABLE auth.sessions (
    id int4 PRIMARY KEY,
    aal auth.aal_level
  );
`;

function writeContract(ctx: JourneyContext, psl: string): void {
  writeFileSync(join(ctx.testDir, 'contract.prisma'), psl, 'utf-8');
}

function readEmittedContractJson(ctx: JourneyContext): {
  storage: {
    namespaces: Record<string, { entries: Record<string, Record<string, { values?: unknown }>> }>;
  };
} {
  return JSON.parse(readFileSync(join(ctx.testDir, 'contract.json'), 'utf-8'));
}

withTempDir(({ createTempDir }) => {
  describe('Journey: Native Enum Adoption round trip', () => {
    const db = useDevDatabase({
      onReady: (cs) => withClient(cs, (client) => client.query(SEED_SQL)),
    });

    it(
      'public schema: infer → emit → db verify against the source database',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });

        const infer = await runContractInfer(ctx);
        expect(infer.exitCode, `NE.01: contract infer\n${stripAnsi(infer.stderr)}`).toBe(0);
        const psl = readFileSync(join(ctx.testDir, 'contract.prisma'), 'utf-8');
        expect(psl, 'NE.01: enum-bearing output is namespace-wrapped').toContain(
          'namespace public {',
        );
        expect(psl, 'NE.01: native_enum block emitted').toContain('native_enum TicketStatus {');
        expect(psl, 'NE.01: @@map carries the type name').toContain('@@map("ticket_status")');
        expect(psl, 'NE.01: enum column uses the call syntax').toContain('pg.enum(TicketStatus)');

        // Members in declaration order — not alphabetical.
        const draftAt = psl.indexOf('draft = "draft"');
        const reviewAt = psl.indexOf('review = "review"');
        const doneAt = psl.indexOf('done = "done"');
        expect(draftAt, 'NE.01: draft member present').toBeGreaterThan(-1);
        expect(draftAt, 'NE.01: declaration order').toBeLessThan(reviewAt);
        expect(reviewAt, 'NE.01: declaration order').toBeLessThan(doneAt);

        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, `NE.02: contract emit\n${stripAnsi(emit.stderr)}`).toBe(0);

        // The emitted path carries the member value union: the valueSet entry
        // is what contract.d.ts renders as 'draft' | 'review' | 'done'.
        const contractJson = readEmittedContractJson(ctx);
        expect(
          contractJson.storage.namespaces['public']?.entries['valueSet']?.['TicketStatus'],
          'NE.02: valueSet carries the ordered member union',
        ).toMatchObject({ values: ['draft', 'review', 'done'] });

        const verify = await runDbVerify(ctx, ['--schema-only']);
        expect(
          verify.exitCode,
          `NE.03: db verify --schema-only\n${stripAnsi(verify.stderr)}\n${stripAnsi(verify.stdout)}`,
        ).toBe(0);

        const inferAgain = await runContractInfer(ctx);
        expect(inferAgain.exitCode, 'NE.04: contract infer again').toBe(0);
        const pslAgain = readFileSync(join(ctx.testDir, 'contract.prisma'), 'utf-8');
        expect(pslAgain, 'NE.04: infer-twice is stable').toBe(psl);
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'auth schema (the auth.aal_level shape): infer → emit → db verify against the source database',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });

        const psl = await inferPostgresNamespacePsl(db.connectionString, 'auth');
        expect(psl, 'NA.01: auth output is namespace-wrapped').toContain('namespace auth {');
        expect(psl, 'NA.01: native_enum block emitted').toContain('native_enum AalLevel {');
        expect(psl, 'NA.01: @@map carries the bare type name').toContain('@@map("aal_level")');
        expect(psl, 'NA.01: nullable enum column').toContain('pg.enum(AalLevel)?');
        writeContract(ctx, psl);

        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, `NA.02: contract emit\n${stripAnsi(emit.stderr)}`).toBe(0);

        const contractJson = readEmittedContractJson(ctx);
        expect(
          contractJson.storage.namespaces['auth']?.entries['valueSet']?.['AalLevel'],
          'NA.02: valueSet carries the ordered member union',
        ).toMatchObject({ values: ['aal1', 'aal2', 'aal3'] });

        const verify = await runDbVerify(ctx, ['--schema-only']);
        expect(
          verify.exitCode,
          `NA.03: db verify --schema-only\n${stripAnsi(verify.stderr)}\n${stripAnsi(verify.stdout)}`,
        ).toBe(0);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
