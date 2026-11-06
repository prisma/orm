import { structuredError } from '@internal/utils/structured-error';
import { describe, expect, it } from 'vitest';
import { CliStructuredError } from '../src/control';
import {
  errorHashMismatch,
  errorMarkerMissing,
  errorMarkerPoliciesCorrupt,
  errorMarkerReadFailed,
  errorMarkerRequired,
  errorMarkerRowCorrupt,
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

  it('errorMarkerPoliciesCorrupt keeps the marker, whatever the database stores it in', () => {
    const error = errorMarkerPoliciesCorrupt({
      why: 'meta.policies is not a valid policy declaration',
      space: 'app',
      markerLocation: '_prisma_migrations',
    });
    expect({
      code: error.code,
      message: error.message,
      fix: error.fix,
      nextActions: error.nextActions,
      meta: error.meta,
    }).toEqual({
      code: 'CONTRACT.MARKER_ROW_CORRUPT',
      message: "The marker's policies cannot be read",
      fix: 'Ask whoever owns this database to correct meta.policies in the marker; do not delete the marker. The marker for space "app" in _prisma_migrations also records the database\'s contract and invariants.',
      nextActions: [
        {
          kind: 'user-choice',
          label:
            'Ask whoever owns this database to correct meta.policies in the marker; do not delete the marker.',
        },
      ],
      meta: { space: 'app' },
    });
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

  it('rethrowMarkerReadError maps a CONTRACT.MARKER_ROW_CORRUPT error to the corrupt-row error, whatever its message', () => {
    const corrupt = structuredError('CONTRACT.MARKER_ROW_CORRUPT', 'the marker is broken');

    expect(() =>
      rethrowMarkerReadError(corrupt, { space: 'app', markerLocation: 'prisma_contract.marker' }),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.MARKER_ROW_CORRUPT',
        why: 'the marker is broken',
        cause: corrupt,
      }),
    );
  });

  it('rethrowMarkerReadError reads a plain Error as a read failure, even when its message names a corrupt row', () => {
    const plain = new Error('Invalid contract marker row: core_hash must be string');

    expect(() =>
      rethrowMarkerReadError(plain, { space: 'app', markerLocation: 'prisma_contract.marker' }),
    ).toThrow(expect.objectContaining({ code: 'CONTRACT.MARKER_READ_FAILED', cause: plain }));
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

  it('rethrowMarkerReadError preserves cause on the corrupt-row path', () => {
    const original = structuredError('CONTRACT.MARKER_ROW_CORRUPT', 'core_hash must be string');
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

  it('rethrowMarkerReadError rethrows existing CliStructuredError', () => {
    const existing = errorMarkerMissing();
    expect(() =>
      rethrowMarkerReadError(existing, {
        space: 'app',
        markerLocation: 'prisma_contract.marker',
      }),
    ).toThrow(existing);
  });

  it('rethrowMarkerReadError passes a DRIVER error through unchanged', () => {
    const driverError = Object.assign(new Error('Postgres driver is closed'), {
      code: 'DRIVER.NOT_CONNECTED',
      category: 'DRIVER',
      severity: 'error',
    });
    const invoke = () =>
      rethrowMarkerReadError(driverError, {
        space: 'app',
        markerLocation: 'prisma_contract.marker',
      });

    expect(invoke).toThrow(
      expect.objectContaining({
        code: 'DRIVER.NOT_CONNECTED',
        category: 'DRIVER',
        message: 'Postgres driver is closed',
      }),
    );
    expect(invoke).not.toThrow(CliStructuredError);
  });

  it('withMarkerReadErrorHandling passes a DRIVER error through unchanged', async () => {
    const driverError = Object.assign(new Error('connection lost'), {
      code: 'DRIVER.NOT_CONNECTED',
      category: 'DRIVER',
    });

    await expect(
      withMarkerReadErrorHandling(
        async () => {
          throw driverError;
        },
        { space: 'app', markerLocation: 'prisma_contract.marker' },
      ),
    ).rejects.toBe(driverError);
  });

  it('rethrowMarkerReadError passes a DRIVER-namespace structured error without a category through unchanged', () => {
    const closed = structuredError('DRIVER.NOT_CONNECTED', 'Runtime is closed');

    expect(() =>
      rethrowMarkerReadError(closed, { space: 'app', markerLocation: 'prisma_contract.marker' }),
    ).toThrow(closed);
  });

  it('rethrowMarkerReadError wraps a structured error outside the DRIVER namespace', () => {
    const other = structuredError('RUNTIME.ENCODE_FAILED', 'encode failed');

    expect(() =>
      rethrowMarkerReadError(other, { space: 'app', markerLocation: 'prisma_contract.marker' }),
    ).toThrow(expect.objectContaining({ code: 'CONTRACT.MARKER_READ_FAILED', cause: other }));
  });

  it('rethrowMarkerReadError wraps a plain Error', () => {
    const plain = new Error('socket reset');

    expect(() =>
      rethrowMarkerReadError(plain, { space: 'app', markerLocation: 'prisma_contract.marker' }),
    ).toThrow(expect.objectContaining({ code: 'CONTRACT.MARKER_READ_FAILED', cause: plain }));
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
          throw structuredError('CONTRACT.MARKER_ROW_CORRUPT', 'invariants must be string[]');
        },
        { space: 'ext', markerLocation: '_prisma_marker' },
      ),
    ).toThrow(expect.objectContaining({ code: 'CONTRACT.MARKER_ROW_CORRUPT' }));
  });
});
