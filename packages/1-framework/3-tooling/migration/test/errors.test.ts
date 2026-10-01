import { CliStructuredError } from '@internal/errors/control';
import { describe, expect, it } from 'vitest';
import {
  errorBundleNotFoundForGraphNode,
  errorContractDeserializationFailed,
  errorContractSnapshotHashMismatch,
  errorContractSnapshotMissing,
  errorDescribeInvalidMetadata,
  errorDescribeMissingEndContract,
  errorDescriptorHeadHashMismatch,
  errorDirectoryExists,
  errorDuplicateInvariantInEdge,
  errorDuplicateMigrationHash,
  errorDuplicateSpaceId,
  errorHashNotInGraph,
  errorInvalidDestName,
  errorInvalidInvariantId,
  errorInvalidJson,
  errorInvalidManifest,
  errorInvalidOperationEntry,
  errorInvalidRefFile,
  errorInvalidRefName,
  errorInvalidRefs,
  errorInvalidRefValue,
  errorInvalidSlug,
  errorInvalidSpaceId,
  errorMigrationContractViewMissing,
  errorMigrationHashMismatch,
  errorMissingFile,
  errorNoInvariantPath,
  errorOperationsNotArray,
  errorProvidedInvariantsMismatch,
  errorRefNotResolvable,
  errorSameSourceAndTarget,
  errorSpaceHeadRefMissing,
  errorUnknownInvariant,
  MigrationToolsError,
} from '../src/errors';
import type { MigrationGraph } from '../src/graph';

describe('errorNoInvariantPath', () => {
  const baseStructural = [
    {
      dirName: '20260424T0900_add_posts_table',
      migrationHash: 'mh:abc',
      from: 'empty',
      to: 'a94b',
      invariants: [],
    },
  ];

  it('builds a MigrationToolsError tagged with MIGRATION.NO_INVARIANT_PATH', () => {
    const err = errorNoInvariantPath({
      required: ['backfill-user-phone'],
      missing: ['backfill-user-phone'],
      structuralPath: baseStructural,
    });
    expect(MigrationToolsError.is(err)).toBe(true);
    expect(err.code).toBe('MIGRATION.NO_INVARIANT_PATH');
    expect(err.category).toBe('MIGRATION');
  });

  it('puts required, missing, and structuralPath on meta', () => {
    const err = errorNoInvariantPath({
      required: ['X', 'Y'],
      missing: ['Y'],
      structuralPath: baseStructural,
    });
    expect(err.meta).toMatchObject({
      required: ['X', 'Y'],
      missing: ['Y'],
      structuralPath: baseStructural,
    });
  });

  it('includes refName on meta when provided', () => {
    const err = errorNoInvariantPath({
      refName: 'prod',
      required: ['X'],
      missing: ['X'],
      structuralPath: baseStructural,
    });
    expect(err.meta?.['refName']).toBe('prod');
  });

  it('omits refName from meta when not provided', () => {
    const err = errorNoInvariantPath({
      required: ['X'],
      missing: ['X'],
      structuralPath: baseStructural,
    });
    expect(err.meta).not.toHaveProperty('refName');
  });

  it('quotes the missing ids in the why message so a typo is readable', () => {
    const err = errorNoInvariantPath({
      required: ['backfill-user-phone'],
      missing: ['backfill-user-phone'],
      structuralPath: baseStructural,
    });
    expect(err.why).toContain('backfill-user-phone');
  });

  it('fix text names a concrete remediation', () => {
    const err = errorNoInvariantPath({
      required: ['X'],
      missing: ['X'],
      structuralPath: baseStructural,
    });
    expect(err.fix).toMatch(/dataTransform/i);
  });

  it('renders required and missing distinctly under partial coverage', () => {
    // Partial coverage: required covers 3, structuralPath only provides 2.
    // The why message must list the full required set and the missing
    // subset separately so an operator can tell at a glance which ones
    // failed.
    const err = errorNoInvariantPath({
      required: ['a', 'b', 'c'],
      missing: ['c'],
      structuralPath: baseStructural,
    });
    expect(err.why).toContain('required=["a", "b", "c"]');
    expect(err.why).toContain('missing=["c"]');
  });

  it('preserves the structuralPath wire shape exactly', () => {
    // The JSON envelope (meta.structuralPath) is part of the public CLI
    // contract — pin the per-edge key set so adding or dropping a field
    // requires an explicit test update.
    const err = errorNoInvariantPath({
      required: ['X'],
      missing: ['X'],
      structuralPath: baseStructural,
    });
    const path = err.meta?.['structuralPath'] as readonly Record<string, unknown>[];
    expect(path).toHaveLength(1);
    expect(Object.keys(path[0]!).sort()).toEqual([
      'dirName',
      'from',
      'invariants',
      'migrationHash',
      'to',
    ]);
  });
});

describe('errorUnknownInvariant', () => {
  it('builds a MigrationToolsError tagged with MIGRATION.UNKNOWN_INVARIANT', () => {
    const err = errorUnknownInvariant({
      unknown: ['backfill-user-status'],
      declared: ['backfill-user-phone'],
    });
    expect(MigrationToolsError.is(err)).toBe(true);
    expect(err.code).toBe('MIGRATION.UNKNOWN_INVARIANT');
    expect(err.category).toBe('MIGRATION');
  });

  it('puts unknown and declared on meta', () => {
    const err = errorUnknownInvariant({
      unknown: ['typo-id'],
      declared: ['real-id-1', 'real-id-2'],
    });
    expect(err.meta).toMatchObject({
      unknown: ['typo-id'],
      declared: ['real-id-1', 'real-id-2'],
    });
  });

  it('includes refName on meta when provided', () => {
    const err = errorUnknownInvariant({
      refName: 'prod',
      unknown: ['x'],
      declared: [],
    });
    expect(err.meta?.['refName']).toBe('prod');
  });

  it('quotes unknown ids in the why message so a typo is readable', () => {
    const err = errorUnknownInvariant({
      unknown: ['backfill-user-status'],
      declared: ['backfill-user-phone'],
    });
    expect(err.why).toContain('backfill-user-status');
  });

  it('fix text names typo-or-unattested as the two failure modes', () => {
    const err = errorUnknownInvariant({
      unknown: ['x'],
      declared: [],
    });
    expect(err.fix).toMatch(/typo|attest/i);
  });
});

describe('MigrationToolsError base type', () => {
  const graph = { nodes: new Set(['aaa']) } as unknown as MigrationGraph;

  const structuralEdge = {
    dirName: '20260424T0900_add_posts_table',
    migrationHash: 'mh:abc',
    from: 'empty',
    to: 'a94b',
    invariants: [],
  };

  const factoryInstances: ReadonlyArray<MigrationToolsError> = [
    errorDirectoryExists('/tmp/m/20260101_init'),
    errorMissingFile('ops.json', '/tmp/m/20260101_init'),
    errorInvalidJson('/tmp/m/20260101_init/migration.json', 'Unexpected token'),
    errorInvalidManifest('/tmp/m/20260101_init/migration.json', 'missing to'),
    errorDescribeMissingEndContract(),
    errorDescribeInvalidMetadata('bad shape'),
    errorOperationsNotArray(),
    errorSpaceHeadRefMissing('app'),
    errorInvalidOperationEntry(0, 'missing id'),
    errorInvalidSlug('!!!'),
    errorInvalidDestName('../outside.json'),
    errorInvalidSpaceId('Bad Space'),
    errorDescriptorHeadHashMismatch({
      extensionId: 'ext',
      recomputedHash: 'a'.repeat(64),
      headRefHash: 'b'.repeat(64),
    }),
    errorDuplicateSpaceId('app'),
    errorSameSourceAndTarget('/tmp/m/20260101_init', 'a'.repeat(64)),
    errorInvalidRefs('/tmp/m/refs.json', 'not an object'),
    errorInvalidRefFile('/tmp/m/refs/prod.json', 'not an object'),
    errorInvalidRefName('BAD NAME'),
    errorInvalidRefValue('not-a-hash'),
    errorDuplicateMigrationHash('mh:abc'),
    errorInvalidInvariantId('has a space'),
    errorDuplicateInvariantInEdge('shared'),
    errorProvidedInvariantsMismatch('/tmp/m/20260101_init/migration.json', ['a'], ['b']),
    errorNoInvariantPath({ required: ['x'], missing: ['x'], structuralPath: [structuralEdge] }),
    errorUnknownInvariant({ unknown: ['x'], declared: [] }),
    errorMigrationHashMismatch('/tmp/m/20260101_init', 'a'.repeat(64), 'b'.repeat(64)),
    errorRefNotResolvable('prod'),
    errorBundleNotFoundForGraphNode('a'.repeat(64)),
    errorContractDeserializationFailed('/tmp/m/snapshots/x/contract.json', 'bad shape'),
    errorHashNotInGraph('bbb', graph),
    errorContractSnapshotMissing('a'.repeat(64), '/tmp/m/snapshots/x/contract.json'),
    errorContractSnapshotHashMismatch('a'.repeat(64), 'b'.repeat(64), '/tmp/m/snapshots/x'),
    errorMigrationContractViewMissing('MyMigration', 'endContract', 'endContractJson'),
  ];

  it('is a CliStructuredError and keeps the parent name for boundary duck-typing', () => {
    const err = errorDirectoryExists('/tmp/m/20260101_init');
    expect(err).toBeInstanceOf(CliStructuredError);
    expect(err.name).toBe('CliStructuredError');
    expect(CliStructuredError.is(err)).toBe(true);
    expect(MigrationToolsError.is(err)).toBe(true);
  });

  it('exposes toEnvelope() with code, summary, why, fix, nextActions, and meta', () => {
    const err = errorDirectoryExists('/tmp/m/20260101_init');
    expect(err.toEnvelope()).toEqual({
      ok: false,
      code: 'MIGRATION.DIR_EXISTS',
      severity: 'error',
      summary: 'Migration directory already exists',
      why: err.why,
      fix: err.fix,
      nextActions: [],
      meta: { dir: '/tmp/m/20260101_init' },
    });
  });

  it('is() rejects a plain CliStructuredError outside the MIGRATION namespace', () => {
    const err = new CliStructuredError('CONFIG.FILE_NOT_FOUND', 'Config file not found');
    expect(MigrationToolsError.is(err)).toBe(false);
  });

  it('no factory passes identical why and fix, so the parent never drops fix', () => {
    // `CliStructuredError` normalizes `fix` to undefined when it equals
    // `why`; the `declare` narrows on this class assume that never fires.
    for (const err of factoryInstances) {
      expect(err.why).toBeTypeOf('string');
      expect(err.fix).toBeTypeOf('string');
      expect(err.fix).not.toBe(err.why);
    }
  });
});
