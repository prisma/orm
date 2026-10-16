import type { VerifyDatabaseSchemaResult } from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import type { CliStructuredError } from '../src/control';
import { errorConfigFileNotFound, errorContractValidationFailed } from '../src/control';
import {
  errorMarkerMissing,
  errorMarkerRequired,
  errorMarkerRowCorrupt,
  errorSchemaVerificationFailed,
  rethrowMarkerReadError,
} from '../src/execution';
import { errorMigrationFileMissing } from '../src/migration';

const driftedSchema: VerifyDatabaseSchemaResult = {
  ok: false,
  summary: 'Schema drift detected',
  contract: { storageHash: 'a'.repeat(64) },
  target: { expected: 'postgres' },
  schema: { issues: [] },
  timings: { total: 0 },
};

/**
 * Every converted factory in this package, paired with the remediation it used
 * to carry as `fix` prose. `fix` is still asserted: both fields exist while the
 * remaining raise sites convert.
 */
describe('converted factories carry typed nextActions', () => {
  it('errorConfigFileNotFound', () => {
    const error = errorConfigFileNotFound();

    expect(error.fix).toBe("Run '{bin} orm init' to create a config file");
    expect(error.nextActions).toEqual([
      { kind: 'run-command', label: 'Create a config file', command: '{bin} orm init' },
    ]);
  });

  it('errorContractValidationFailed', () => {
    const error = errorContractValidationFailed('storage hash mismatch');

    expect(error.fix).toBe(
      'If an earlier release emitted this contract, follow the app upgrade instructions of each release since, which rewrite the contract and its migration snapshots: https://github.com/prisma/orm/tree/main/skills/prisma-8/upgrading/app. If this release emitted it, re-run `{bin} contract emit`, or fix the contract file if you edited it, and try again',
    );
    expect(error.nextActions).toEqual([
      {
        kind: 'open-url',
        label: 'If an earlier release emitted the contract, follow the app upgrade instructions',
        url: 'https://github.com/prisma/orm/tree/main/skills/prisma-8/upgrading/app',
      },
      {
        kind: 'run-command',
        label: 'If this release emitted the contract, re-emit it',
        command: '{bin} contract emit',
      },
      {
        kind: 'edit-file',
        label: 'Fix the contract file, then re-run the command',
        reason: 'storage hash mismatch',
      },
    ]);
  });

  it('errorMarkerMissing', () => {
    const error = errorMarkerMissing();

    expect(error.fix).toBe('Run `{bin} db sign --db <url>` to sign the database');
    expect(error.nextActions).toEqual([
      { kind: 'run-command', label: 'Sign the database', command: '{bin} db sign --db <url>' },
    ]);
  });

  it('errorMarkerRowCorrupt', () => {
    const error = errorMarkerRowCorrupt({
      why: 'core_hash must be a string',
      space: 'app',
      markerLocation: 'prisma_contract.marker',
    });

    expect(error.nextActions).toEqual([
      {
        kind: 'run-command',
        label: 'Write a fresh marker',
        command: '{bin} db sign --db <url>',
        reason:
          'Delete the invalid prisma_contract.marker row for space "app" first — this command then writes a valid one.',
      },
    ]);
  });

  it('errorMarkerRequired defaults to signing the database', () => {
    const error = errorMarkerRequired();

    expect(error.fix).toBe('Run `{bin} db init` first to sign the database');
    expect(error.nextActions).toEqual([
      { kind: 'run-command', label: 'Sign the database', command: '{bin} db init' },
    ]);
  });

  it('errorMarkerRequired lets a caller replace the default actions', () => {
    const nextActions = [{ kind: 'done', label: 'Nothing to do' }] as const;
    const error = errorMarkerRequired({ nextActions });

    expect(error.nextActions).toEqual(nextActions);
  });

  it('errorSchemaVerificationFailed', () => {
    const error = errorSchemaVerificationFailed({
      summary: 'Schema drift detected',
      verificationResult: driftedSchema,
    });

    expect(error.fix).toBe(
      'Run `{bin} db update` to reconcile, or adjust your contract to match the database',
    );
    expect(error.nextActions).toEqual([
      { kind: 'run-command', label: 'Reconcile the database', command: '{bin} db update' },
      { kind: 'edit-file', label: 'Adjust your contract to match the database' },
    ]);
  });

  it('errorMigrationFileMissing', () => {
    const error = errorMigrationFileMissing('migrations/0001_init');

    expect(error.fix).toBe('Scaffold one with `{bin} migration new` or `{bin} migration plan`.');
    expect(error.nextActions).toEqual([
      {
        kind: 'run-command',
        label: 'Scaffold an empty migration',
        command: '{bin} migration new',
      },
      {
        kind: 'run-command',
        label: 'Scaffold a migration from a contract diff',
        command: '{bin} migration plan',
      },
    ]);
  });

  it('the legacy marker-table shape maps to a runner failure carrying nextActions', () => {
    let thrown: CliStructuredError | undefined;
    try {
      rethrowMarkerReadError(new Error('column "space" does not exist'), {
        space: 'app',
        markerLocation: 'prisma_contract.marker',
      });
    } catch (error) {
      thrown = error as CliStructuredError;
    }

    expect(thrown?.code).toBe('MIGRATION.RUNNER_FAILED');
    expect(thrown?.nextActions).toEqual([
      {
        kind: 'run-command',
        label: 'Reinitialise the marker table from a clean baseline',
        command: '{bin} db init',
        reason:
          'Drop `prisma_contract.marker` first — it has the legacy shape (no `space` column) and this command recreates it with the current per-space schema.',
      },
    ]);
  });
});
