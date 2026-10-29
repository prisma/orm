/**
 * Journey: a schema that wrote the Temporal types under their explicit names moves its fields to the convenience types' defaults, as the upgrade instruction describes. `Date` and `Time` keep the `date` and `time(0)` columns and change only the codec: `migration plan` writes a migration with no operations, and `db update` applies no operations and moves the marker. `DateTime` makes the `timestamptz` column `timestamptz(3)`, which can round stored values, so both `migration plan` and `db update` ask for `--delete Event.at` before they alter it.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'pathe';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  runContractEmit,
  runDbInit,
  runDbUpdate,
  runDbVerify,
  runMigrate,
  runMigrationPlan,
  setupJourney,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';

const schema = (day: string, opens: string, at: string) => `// use prisma-8

model Event {
  id    Int @id
  day   ${day}
  opens ${opens}
  at    ${at}

  @@map("event")
}
`;

const EXPLICIT = schema('DateTemporal', 'TimeTemporal(0)', 'TimestamptzTemporal');
const CODEC_ONLY = schema('Date', 'Time(precision: 0)', 'TimestamptzTemporal');
const PRECISION = schema('Date', 'Time(precision: 0)', 'DateTime');

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

async function expectVerified(ctx: JourneyContext): Promise<void> {
  const verify = await runDbVerify(ctx);
  expect(verify.exitCode, output(verify)).toBe(0);
}

withTempDir(({ createTempDir }) => {
  describe('Journey: moving explicit Temporal fields to the convenience types', () => {
    describe('with migrations', () => {
      const db = useDevDatabase();

      it(
        'writes a migration with no operations for a codec-only change, and a lossy-change consent for the precision',
        async () => {
          const ctx = setupJourney({
            connectionString: db.connectionString,
            createTempDir,
            contractMode: 'psl',
          });
          const explicit = await emit(ctx, EXPLICIT);
          const first = await runMigrationPlan(ctx, ['--name', 'initial']);
          expect(first.exitCode, output(first)).toBe(0);
          const applied = await runMigrate(ctx);
          expect(applied.exitCode, output(applied)).toBe(0);

          const codecOnly = await emit(ctx, CODEC_ONLY);
          const empty = await runMigrationPlan(ctx, ['--from', explicit, '--name', 'codecs']);
          expect(empty.exitCode, output(empty)).toBe(0);
          const appliedEmpty = await runMigrate(ctx);
          expect(appliedEmpty.exitCode, output(appliedEmpty)).toBe(0);
          expect(output(appliedEmpty)).toContain('Applied 1 migration(s) (0 operation(s))');
          await expectVerified(ctx);

          await emit(ctx, PRECISION);
          const unconsented = await runMigrationPlan(ctx, ['--from', codecOnly, '--name', 'at']);
          expect(unconsented.exitCode).toBe(2);
          expect(output(unconsented)).toContain('--delete Event.at');
          const precision = await runMigrationPlan(ctx, [
            '--from',
            codecOnly,
            '--name',
            'precision',
            '--delete',
            'Event.at',
          ]);
          expect(precision.exitCode, output(precision)).toBe(0);
          expect(output(precision)).toContain(
            'ALTER TABLE "public"."event" ALTER COLUMN "at" TYPE timestamptz(3)',
          );
          const appliedPrecision = await runMigrate(ctx);
          expect(appliedPrecision.exitCode, output(appliedPrecision)).toBe(0);
          await expectVerified(ctx);
        },
        timeouts.spinUpPpgDev * 3,
      );
    });

    describe('with db update', () => {
      const db = useDevDatabase();

      it(
        'applies no operations for a codec-only change, and alters the precision with --delete',
        async () => {
          const ctx = setupJourney({
            connectionString: db.connectionString,
            createTempDir,
            contractMode: 'psl',
          });
          await emit(ctx, EXPLICIT);
          const init = await runDbInit(ctx);
          expect(init.exitCode, output(init)).toBe(0);

          await emit(ctx, CODEC_ONLY);
          const codecOnly = await runDbUpdate(ctx);
          expect(codecOnly.exitCode, output(codecOnly)).toBe(0);
          expect(output(codecOnly)).toContain('(no operations)');
          await expectVerified(ctx);

          await emit(ctx, PRECISION);
          const unconsented = await runDbUpdate(ctx);
          expect(unconsented.exitCode).toBe(2);
          expect(output(unconsented)).toContain('Run the command again with --delete Event.at');
          const precision = await runDbUpdate(ctx, ['--delete', 'Event.at']);
          expect(precision.exitCode, output(precision)).toBe(0);
          expect(output(precision)).toContain('Alter type of "event"."at" to timestamptz(3)');
          await expectVerified(ctx);
        },
        timeouts.spinUpPpgDev * 3,
      );
    });
  });
});
