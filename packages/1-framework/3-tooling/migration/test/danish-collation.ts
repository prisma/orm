import { afterEach, beforeEach, expect, vi } from 'vitest';
import type { OnDiskMigrationPackage } from '../src/package';
import { createTestMetadata, createTestOps } from './fixtures';

/**
 * Makes `String.prototype.localeCompare` collate as on a Danish machine, where "aa" sorts after
 * "z", for every test in the enclosing `describe`.
 */
export function collateAsDanishInEachTest(): void {
  const danish = new Intl.Collator('da');

  beforeEach(() => {
    expect(danish.compare('sha256:aa', 'sha256:b0')).toBeGreaterThan(0);
    vi.spyOn(String.prototype, 'localeCompare').mockImplementation(function (
      this: string,
      that: string,
    ) {
      return danish.compare(this, that);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
}

export function pkgWithHash(
  from: string,
  to: string,
  dirName: string,
  migrationHash: string,
  invariants: readonly string[] = [],
): OnDiskMigrationPackage {
  return {
    dirName,
    dirPath: `/migrations/${dirName}`,
    metadata: createTestMetadata({
      from,
      to,
      createdAt: '2026-02-25T14:00:00.000Z',
      migrationHash,
      providedInvariants: invariants,
    }),
    ops: createTestOps(),
  };
}
