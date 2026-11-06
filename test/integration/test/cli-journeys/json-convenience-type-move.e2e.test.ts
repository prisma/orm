/**
 * Journey: a database built when PostgreSQL's `Json` meant a `json` column, and a schema that still writes a bare `Json`, which now stores `jsonb`. `db verify --schema-only` reports the column, `migration plan` asks for `--delete Event.payload` before it alters the column, and the answered plan applies and verifies clean.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'pathe';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  runContractEmit,
  runDbVerify,
  runMigrate,
  runMigrationPlan,
  setupJourney,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';

const schema = (payload: string) => `// use prisma-8

model Event {
  id      Int @id
  payload ${payload}

  @@map("event")
}
`;

function output(result: { readonly stdout: string; readonly stderr: string }): string {
  return `${stripAnsi(result.stderr)}\n${stripAnsi(result.stdout)}`;
}

async function emit(ctx: JourneyContext, text: string): Promise<string> {
  writeFileSync(join(ctx.testDir, 'contract.prisma'), text, 'utf-8');
  const emitted = await runContractEmit(ctx);
  expect(emitted.exitCode, output(emitted)).toBe(0);
  const contract: { readonly storage: { readonly storageHash: string } } = JSON.parse(
    readFileSync(join(ctx.testDir, 'contract.json'), 'utf-8'),
  );
  return contract.storage.storageHash;
}

withTempDir(({ createTempDir }) => {
  describe('Journey: a bare Json field moves a json column to jsonb', () => {
    const db = useDevDatabase();

    it(
      'reports the column, asks before altering it, and applies the answered plan',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        const plain = await emit(ctx, schema('Json(storage: json)'));
        const first = await runMigrationPlan(ctx, ['--name', 'initial']);
        expect(first.exitCode, output(first)).toBe(0);
        const applied = await runMigrate(ctx);
        expect(applied.exitCode, output(applied)).toBe(0);

        const jsonb = await emit(ctx, schema('Json'));
        expect(jsonb).not.toBe(plain);
        const drifted = await runDbVerify(ctx, ['--schema-only']);
        expect(drifted.exitCode).not.toBe(0);
        expect(output(drifted)).toContain('payload');

        const unconsented = await runMigrationPlan(ctx, ['--from', plain, '--name', 'jsonb']);
        expect(unconsented.exitCode).toBe(2);
        expect(output(unconsented)).toContain('--delete Event.payload');
        const consented = await runMigrationPlan(ctx, [
          '--from',
          plain,
          '--name',
          'jsonb',
          '--delete',
          'Event.payload',
        ]);
        expect(consented.exitCode, output(consented)).toBe(0);
        expect(output(consented)).toContain('ALTER COLUMN "payload" TYPE jsonb');
        const appliedJsonb = await runMigrate(ctx);
        expect(appliedJsonb.exitCode, output(appliedJsonb)).toBe(0);
        const verified = await runDbVerify(ctx);
        expect(verified.exitCode, output(verified)).toBe(0);
      },
      timeouts.spinUpPpgDev * 3,
    );
  });
});
