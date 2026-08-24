import { describe, expect, it } from 'vitest';
import { CliStructuredError } from '../src/control';
import {
  errorDestructiveChanges,
  errorHashMismatch,
  errorMarkerMissing,
  errorMarkerReadFailed,
  errorMarkerRequired,
  errorMarkerRowCorrupt,
  errorRunnerFailed,
  errorRuntime,
  errorTargetMismatch,
  parseMarkerRowSafely,
  rethrowMarkerReadError,
  withMarkerReadErrorHandling,
} from '../src/execution';

describe('Runtime Errors', () => {
  it('errorMarkerMissing creates correct error', () => {
    const error = errorMarkerMissing();
    expect(error.code).toBe('CONTRACT.MARKER_MISSING');
    expect(error.message).toBe('Database not signed');
  });

  it('errorMarkerMissing with custom why', () => {
    const error = errorMarkerMissing({ why: 'Custom reason' });
    expect(error.why).toBe('Custom reason');
  });

  it('errorHashMismatch creates correct error', () => {
    const error = errorHashMismatch();
    expect(error.code).toBe('CONTRACT.MARKER_MISMATCH');
    expect(error.message).toBe('Hash mismatch');
  });

  it('errorHashMismatch with expected and actual', () => {
    const error = errorHashMismatch({ expected: 'hash1', actual: 'hash2' });
    expect(error.meta?.['expected']).toBe('hash1');
    expect(error.meta?.['actual']).toBe('hash2');
  });

  it('errorHashMismatch with expected only', () => {
    const error = errorHashMismatch({ expected: 'hash1' });
    expect(error.meta?.['expected']).toBe('hash1');
    expect(error.meta?.['actual']).toBeUndefined();
  });

  it('errorHashMismatch with actual only', () => {
    const error = errorHashMismatch({ actual: 'hash2' });
    expect(error.meta?.['expected']).toBeUndefined();
    expect(error.meta?.['actual']).toBe('hash2');
  });

  it('errorHashMismatch with custom why', () => {
    const error = errorHashMismatch({ why: 'Custom reason' });
    expect(error.why).toBe('Custom reason');
  });

  it('errorTargetMismatch creates correct error', () => {
    const error = errorTargetMismatch('postgres', 'mysql');
    expect(error.code).toBe('CONTRACT.TARGET_MISMATCH');
    expect(error.message).toBe('Target mismatch');
    expect(error.why).toContain('postgres');
    expect(error.why).toContain('mysql');
    expect(error.meta?.['expected']).toBe('postgres');
    expect(error.meta?.['actual']).toBe('mysql');
  });

  it('errorTargetMismatch with custom why', () => {
    const error = errorTargetMismatch('postgres', 'mysql', { why: 'Custom reason' });
    expect(error.why).toBe('Custom reason');
  });

  it('errorMarkerRequired creates correct error', () => {
    const error = errorMarkerRequired();
    expect(error.code).toBe('CONTRACT.MARKER_REQUIRED');
    expect(error.message).toBe('Database must be signed first');
  });

  it('errorMarkerRequired with custom why and fix', () => {
    const error = errorMarkerRequired({ why: 'Custom reason', fix: 'Custom fix' });
    expect(error.why).toBe('Custom reason');
    expect(error.fix).toBe('Custom fix');
  });

  it('errorRunnerFailed creates correct error', () => {
    const error = errorRunnerFailed('Runner failed');
    expect(error.code).toBe('MIGRATION.RUNNER_FAILED');
    expect(error.message).toBe('Runner failed');
  });

  it('errorRunnerFailed with all options', () => {
    const error = errorRunnerFailed('Runner failed', {
      why: 'Custom why',
      fix: 'Custom fix',
      meta: { key: 'value' },
    });
    expect(error.why).toBe('Custom why');
    expect(error.fix).toBe('Custom fix');
    expect(error.meta).toEqual({ key: 'value' });
  });

  it('errorRunnerFailed forwards cause', () => {
    const cause = new Error('underlying failure');
    const error = errorRunnerFailed('Runner failed', { cause });
    expect(error.cause).toBe(cause);
  });

  it('errorDestructiveChanges creates correct error', () => {
    const error = errorDestructiveChanges('Destructive changes detected');
    expect(error.code).toBe('MIGRATION.DESTRUCTIVE_CHANGES');
    expect(error.message).toBe('Destructive changes detected');
  });

  it('errorDestructiveChanges with all options', () => {
    const error = errorDestructiveChanges('Destructive changes detected', {
      why: 'Custom why',
      fix: 'Custom fix',
      meta: { key: 'value' },
    });
    expect(error.why).toBe('Custom why');
    expect(error.fix).toBe('Custom fix');
    expect(error.meta).toEqual({ key: 'value' });
  });

  it('errorRuntime carries the caller-provided code', () => {
    const error = errorRuntime('MIGRATION.SPACE_NOT_FOUND', 'Something failed');
    expect(error.code).toBe('MIGRATION.SPACE_NOT_FOUND');
    expect(error.message).toBe('Something failed');
    expect(error.why).toBeUndefined();
    expect(error.fix).toBeUndefined();
  });

  it('errorRuntime with all options', () => {
    const error = errorRuntime('CONTRACT.VERIFY_FAILED', 'Something failed', {
      why: 'Custom why',
      fix: 'Custom fix',
      meta: { key: 'value' },
    });
    expect(error.code).toBe('CONTRACT.VERIFY_FAILED');
    expect(error.why).toBe('Custom why');
    expect(error.fix).toBe('Custom fix');
    expect(error.meta).toEqual({ key: 'value' });
  });

  it('errorRuntime forwards cause', () => {
    const cause = new Error('underlying failure');
    const error = errorRuntime('DRIVER.CONNECTION_FAILED', 'Something failed', { cause });
    expect(error.cause).toBe(cause);
  });

  it('errorRuntime without cause leaves no own cause property', () => {
    const error = errorRuntime('DRIVER.CONNECTION_FAILED', 'Something failed');
    expect(Object.hasOwn(error, 'cause')).toBe(false);
  });

  it('errorMarkerRowCorrupt creates CONTRACT.MARKER_ROW_CORRUPT envelope', () => {
    const error = errorMarkerRowCorrupt({
      why: 'Invalid contract marker row: invariants must be string[]',
      space: 'app',
      markerLocation: 'prisma_contract.marker',
    });
    expect(error.toEnvelope().code).toBe('CONTRACT.MARKER_ROW_CORRUPT');
    expect(error.message).toBe('Marker row is corrupt or incompatible');
    expect(error.fix).toContain('space "app"');
    expect(error.fix).toContain('{bin} db sign');
  });

  it('errorMarkerReadFailed creates CONTRACT.MARKER_READ_FAILED envelope', () => {
    const error = errorMarkerReadFailed({
      why: 'permission denied for table marker',
      space: 'app',
      markerLocation: 'prisma_contract.marker',
    });
    expect(error.toEnvelope().code).toBe('CONTRACT.MARKER_READ_FAILED');
    expect(error.message).toBe('Database error while reading contract marker');
    expect(error.fix).toContain('space "app"');
    expect(error.fix).toContain('prisma_contract.marker');
    expect(error.meta).toEqual({ space: 'app' });
  });

  it('rethrowMarkerReadError maps parse failures to CONTRACT.MARKER_ROW_CORRUPT', () => {
    expect(() =>
      rethrowMarkerReadError(new Error('Invalid contract marker row: core_hash must be string'), {
        space: 'app',
        markerLocation: 'prisma_contract.marker',
      }),
    ).toThrow(CliStructuredError);

    try {
      rethrowMarkerReadError(new Error('Invalid contract marker row: core_hash must be string'), {
        space: 'app',
        markerLocation: 'prisma_contract.marker',
      });
    } catch (err) {
      expect(CliStructuredError.is(err)).toBe(true);
      expect((err as CliStructuredError).toEnvelope().code).toBe('CONTRACT.MARKER_ROW_CORRUPT');
    }
  });

  it('rethrowMarkerReadError maps driver failures to CONTRACT.MARKER_READ_FAILED', () => {
    const invoke = () =>
      rethrowMarkerReadError(new Error('permission denied for table marker'), {
        space: 'app',
        markerLocation: 'prisma_contract.marker',
      });

    expect(invoke).toThrow(CliStructuredError);

    try {
      invoke();
    } catch (err) {
      expect(CliStructuredError.is(err)).toBe(true);
      if (CliStructuredError.is(err)) {
        expect(err.toEnvelope().code).toBe('CONTRACT.MARKER_READ_FAILED');
        expect(err.meta).toEqual({ space: 'app' });
      }
    }
  });

  it('rethrowMarkerReadError maps legacy marker shape to MIGRATION.RUNNER_FAILED', () => {
    try {
      rethrowMarkerReadError(new Error('column "space" does not exist'), {
        space: 'app',
        markerLocation: 'prisma_contract.marker',
      });
    } catch (err) {
      const envelope = (err as CliStructuredError).toEnvelope();
      expect(envelope.code).toBe('MIGRATION.RUNNER_FAILED');
      expect(envelope.fix).toContain('Legacy marker-table shape detected');
      expect(envelope.fix).toContain('prisma_contract.marker');
      expect(envelope.fix).toContain('{bin} db init');
    }
  });

  it('rethrowMarkerReadError preserves cause on the corrupt-row path', () => {
    const original = new Error('Invalid contract marker row: core_hash must be string');
    expect(() =>
      rethrowMarkerReadError(original, {
        space: 'app',
        markerLocation: 'prisma_contract.marker',
      }),
    ).toThrow(expect.objectContaining({ cause: original }));
  });

  it('rethrowMarkerReadError preserves cause on the read-failed path', () => {
    const original = new Error('permission denied for table marker');
    expect(() =>
      rethrowMarkerReadError(original, {
        space: 'app',
        markerLocation: 'prisma_contract.marker',
      }),
    ).toThrow(expect.objectContaining({ cause: original }));
  });

  it('rethrowMarkerReadError preserves cause on the legacy-shape path', () => {
    const original = new Error('column "space" does not exist');
    expect(() =>
      rethrowMarkerReadError(original, {
        space: 'app',
        markerLocation: 'prisma_contract.marker',
      }),
    ).toThrow(expect.objectContaining({ cause: original }));
  });

  it('rethrowMarkerReadError rethrows existing CliStructuredError', () => {
    const existing = errorMarkerMissing();
    expect(() =>
      rethrowMarkerReadError(existing, {
        space: 'app',
        markerLocation: 'prisma_contract.marker',
      }),
    ).toThrow(existing);
  });

  it('withMarkerReadErrorHandling wraps async query failures', async () => {
    await expect(
      withMarkerReadErrorHandling(
        async () => {
          throw new Error('connection reset');
        },
        { space: 'app', markerLocation: 'prisma_contract.marker' },
      ),
    ).rejects.toMatchObject({ code: 'CONTRACT.MARKER_READ_FAILED' });
  });

  it('parseMarkerRowSafely wraps parse failures', () => {
    expect(() =>
      parseMarkerRowSafely(
        {},
        () => {
          throw new Error('Invalid contract marker row: invariants must be string[]');
        },
        { space: 'ext', markerLocation: '_prisma_marker' },
      ),
    ).toThrow(CliStructuredError);
  });
});
