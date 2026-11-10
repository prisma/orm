import { describe, expect, it } from 'vitest';
import { mapIntegrityViolations } from '../../src/control-api/operations/contract-space-aggregate-loader';

describe('mapIntegrityViolations', () => {
  it('emits union kinds in meta.violations for contractUnreadable', () => {
    const error = mapIntegrityViolations(
      [
        {
          kind: 'contractUnreadable',
          spaceId: 'ext',
          detail: 'invalid json',
        },
      ],
      'migrations',
    );
    expect(error?.meta?.['violations']).toEqual([
      { kind: 'contractUnreadable', spaceId: 'ext', detail: 'invalid json' },
    ]);
  });

  it('emits union kinds in meta.violations for structural hashMismatch', () => {
    const error = mapIntegrityViolations(
      [
        {
          kind: 'hashMismatch',
          spaceId: 'app',
          dirName: '20260101T0000_init',
          stored: 'old',
          computed: 'new',
        },
      ],
      'migrations',
    );
    expect(error?.meta?.['violations']).toEqual([
      {
        kind: 'hashMismatch',
        spaceId: 'app',
        dirName: '20260101T0000_init',
        stored: 'old',
        computed: 'new',
      },
    ]);
  });

  it('interpolates the configured migrations dir into layout violation text', () => {
    const error = mapIntegrityViolations(
      [{ kind: 'orphanSpaceDir', spaceId: 'snapshots' }],
      'migrations-postgres',
    );
    expect(error?.why).toContain('migrations-postgres/');
    expect(error?.fix).toBe(
      'For a directory no extension declares, declare its extension in `extensions` or remove `migrations-postgres/<space>/`.',
    );
    expect(error?.why).not.toContain('`migrations/`');
  });

  it('names the commands that write a declared pack space when its directory is missing', () => {
    const error = mapIntegrityViolations(
      [{ kind: 'declaredButUnmigrated', spaceId: 'pgvector' }],
      'migrations',
    );
    expect(error?.fix).toBe(
      'Run `prisma contract emit` or `prisma migration plan` to write the pinned files of each declared extension pack under `migrations/<space>/`.',
    );
  });

  it('names both remedies when one space is orphaned and another is missing', () => {
    const error = mapIntegrityViolations(
      [
        { kind: 'orphanSpaceDir', spaceId: 'old' },
        { kind: 'declaredButUnmigrated', spaceId: 'pgvector' },
      ],
      'migrations',
    );
    expect(error?.fix).toBe(
      'Run `prisma contract emit` or `prisma migration plan` to write the pinned files of each declared extension pack under `migrations/<space>/`. For a directory no extension declares, declare its extension in `extensions` or remove `migrations/<space>/`.',
    );
  });

  it('interpolates the configured migrations dir into structural violation fix text', () => {
    const error = mapIntegrityViolations(
      [
        {
          kind: 'hashMismatch',
          spaceId: 'app',
          dirName: '20260101T0000_init',
          stored: 'old',
          computed: 'new',
        },
      ],
      'migrations-postgres',
    );
    expect(error?.fix).toContain('migrations-postgres');
    expect(error?.fix).not.toContain('`migrations/`');
  });
});
