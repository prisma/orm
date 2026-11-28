import { createHash } from 'node:crypto';
import { canonicalizeJson } from '@internal/framework-components/utils';
import { describe, expect, it } from 'vitest';
import { computeMigrationHash, verifyMigrationHash } from '../src/hash';
import { createTestMetadata, createTestOps } from './fixtures';

describe('computeMigrationHash', () => {
  it('produces deterministic output', () => {
    const metadata = createTestMetadata();
    const ops = createTestOps();
    const id1 = computeMigrationHash(metadata, ops);
    const id2 = computeMigrationHash(metadata, ops);
    expect(id1).toBe(id2);
  });

  it('returns a bare hex string', () => {
    const id = computeMigrationHash(createTestMetadata(), createTestOps());
    expect(id).toMatch(/^[a-f0-9]{64}$/);
  });

  it('ignores existing migrationHash on metadata', () => {
    const metadata = createTestMetadata();
    const withMigrationHash = createTestMetadata({ migrationHash: 'fakehash' });
    const ops = createTestOps();
    expect(computeMigrationHash(metadata, ops)).toBe(computeMigrationHash(withMigrationHash, ops));
  });

  it('leaves the format version out, as it leaves out migrationHash', () => {
    const metadata = createTestMetadata();
    const ops = createTestOps();
    expect(computeMigrationHash({ formatVersion: 1, ...metadata }, ops)).toBe(
      computeMigrationHash(metadata, ops),
    );
    expect(computeMigrationHash({ formatVersion: 2, ...metadata }, ops)).toBe(
      computeMigrationHash(metadata, ops),
    );
  });

  it('changes when a metadata field changes', () => {
    const ops = createTestOps();
    const id1 = computeMigrationHash(createTestMetadata({ from: null }), ops);
    const id2 = computeMigrationHash(createTestMetadata({ from: 'custom' }), ops);
    expect(id1).not.toBe(id2);
  });

  it('changes when ops change', () => {
    const metadata = createTestMetadata();
    const id1 = computeMigrationHash(metadata, createTestOps());
    const id2 = computeMigrationHash(metadata, []);
    expect(id1).not.toBe(id2);
  });

  it('changes when metadata.from changes', () => {
    const ops = createTestOps();
    const m1 = createTestMetadata({ from: null });
    const m2 = createTestMetadata({ from: 'different' });
    expect(computeMigrationHash(m1, ops)).not.toBe(computeMigrationHash(m2, ops));
  });

  it('changes when metadata.to changes', () => {
    const ops = createTestOps();
    const m1 = createTestMetadata({ to: 'abc123' });
    const m2 = createTestMetadata({ to: 'different' });
    expect(computeMigrationHash(m1, ops)).not.toBe(computeMigrationHash(m2, ops));
  });

  it('uses framed tuple hashing for edge input parts', () => {
    const metadata = createTestMetadata();
    const ops = createTestOps();

    const { migrationHash: _migrationHash, ...strippedMeta } = metadata;

    const canonicalParts = [canonicalizeJson(strippedMeta), canonicalizeJson(ops)];
    const partHashes = canonicalParts.map((part) =>
      createHash('sha256').update(part).digest('hex'),
    );
    const expected = `${createHash('sha256').update(canonicalizeJson(partHashes)).digest('hex')}`;

    const legacy = `${createHash('sha256').update(canonicalParts.join(':')).digest('hex')}`;

    expect(computeMigrationHash(metadata, ops)).toBe(expected);
    expect(computeMigrationHash(metadata, ops)).not.toBe(legacy);
  });

  it('changes when canonical part boundaries change', () => {
    const metadata = createTestMetadata({ from: 'a:b' });
    const baseOps = createTestOps();
    const boundaryShiftedOps = baseOps.map((op) => ({ ...op, label: `${op.label}:suffix` }));

    const baseHash = computeMigrationHash(metadata, baseOps);
    const boundaryShiftedHash = computeMigrationHash(metadata, boundaryShiftedOps);

    expect(baseHash).not.toBe(boundaryShiftedHash);
  });

  it('changes when providedInvariants changes', () => {
    const ops = createTestOps();
    const m1 = createTestMetadata({ providedInvariants: [] }, ops);
    const m2 = createTestMetadata({ providedInvariants: ['phone-backfill'] }, ops);
    expect(computeMigrationHash(m1, ops)).not.toBe(computeMigrationHash(m2, ops));
  });
});

describe('verifyMigrationHash', () => {
  it('reports mismatch for an in-memory tampered package', () => {
    // The on-disk variants of this case are covered by io.test.ts (the
    // loader throws MIGRATION.HASH_MISMATCH). This case keeps the
    // in-memory primitive under test so callers that hold a hand-built
    // package (e.g. the planner before write) still have coverage.
    const ops = createTestOps();
    const baseMetadata = {
      from: null,
      to: 'abc123',
      providedInvariants: [],
      createdAt: '2026-02-25T14:30:00.000Z',
    };
    const storedHash = computeMigrationHash(baseMetadata, ops);
    const tamperedOps = [
      ...ops,
      { id: 'extra', label: 'Extra', operationClass: 'additive' as const },
    ];

    const result = verifyMigrationHash({
      dirName: '20260225T1430_tampered',
      metadata: { ...baseMetadata, migrationHash: storedHash },
      ops: tamperedOps,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('mismatch');
    expect(result.storedHash).toBe(storedHash);
    expect(result.computedHash).not.toBe(storedHash);
  });
});
