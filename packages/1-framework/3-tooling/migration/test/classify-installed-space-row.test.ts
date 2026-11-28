import type { ContractSpace, MigrationPackage } from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import {
  classificationNeedsLedger,
  classifyInstalledSpaceRow,
} from '../src/classify-installed-space-row';
import { createTestContract, createTestMetadata } from './fixtures';

const ops = [{ id: 'create.marker', label: 'Create marker', operationClass: 'additive' }] as const;

function migrationPackage(
  from: string | null,
  to: string,
  providedInvariants: readonly string[] = [],
): MigrationPackage {
  return {
    dirName: `to-${to}`,
    metadata: createTestMetadata({ from, to, providedInvariants }, ops),
    ops,
  };
}

const installed: ContractSpace = {
  contractJson: createTestContract(),
  migrations: [
    migrationPackage(null, 'hash-1', ['_prisma:major-8']),
    migrationPackage('hash-1', 'hash-2'),
  ],
  headRef: { hash: 'hash-2', invariants: ['_prisma:major-8'] },
};

function row(storageHash: string, invariants: readonly string[] = ['_prisma:major-8']) {
  return { storageHash, invariants };
}

function ledgerTo(...hashes: readonly string[]) {
  return hashes.map((to) => ({ to }));
}

describe('classifyInstalledSpaceRow', () => {
  it('is at the head when the row records the head and its invariants', () => {
    expect(
      classifyInstalledSpaceRow({ contractSpace: installed, row: row('hash-2'), ledger: [] }),
    ).toEqual({ kind: 'atHead' });
  });

  it('is behind when there is no row', () => {
    expect(classifyInstalledSpaceRow({ contractSpace: installed, row: null, ledger: [] })).toEqual({
      kind: 'behind',
    });
  });

  it('is behind when the row records a contract the migrations lead on from', () => {
    expect(
      classifyInstalledSpaceRow({ contractSpace: installed, row: row('hash-1'), ledger: [] }),
    ).toEqual({ kind: 'behind' });
  });

  it('is behind when the row records the head without an invariant the head requires', () => {
    expect(
      classifyInstalledSpaceRow({ contractSpace: installed, row: row('hash-2', []), ledger: [] }),
    ).toEqual({ kind: 'behind' });
  });

  it('is ahead when the row is at an unknown contract, its invariants are all known, and the ledger reached the head', () => {
    expect(
      classifyInstalledSpaceRow({
        contractSpace: installed,
        row: row('hash-later'),
        ledger: ledgerTo('hash-1', 'hash-2', 'hash-later'),
      }),
    ).toEqual({ kind: 'ahead' });
  });

  it('is unreachable when the row is at an unknown contract and the ledger never reached the head', () => {
    expect(
      classifyInstalledSpaceRow({
        contractSpace: installed,
        row: row('hash-later'),
        ledger: ledgerTo('hash-1', 'hash-later'),
      }),
    ).toEqual({ kind: 'unreachable', reason: 'unknownContract', markerHash: 'hash-later' });
  });

  it('is unreachable when the row carries an invariant the installed migrations never provide, even though the ledger reached the head', () => {
    expect(
      classifyInstalledSpaceRow({
        contractSpace: installed,
        row: row('hash-next-major', ['_prisma:major-8', '_prisma:major-9']),
        ledger: ledgerTo('hash-1', 'hash-2', 'hash-next-major'),
      }),
    ).toEqual({ kind: 'unreachable', reason: 'laterMajor', markerHash: 'hash-next-major' });
  });

  it('is unreachable when the row records the head and an invariant the installed migrations never provide', () => {
    expect(
      classifyInstalledSpaceRow({
        contractSpace: installed,
        row: row('hash-2', ['_prisma:major-8', '_prisma:major-9']),
        ledger: [],
      }),
    ).toEqual({ kind: 'unreachable', reason: 'laterMajor', markerHash: 'hash-2' });
  });

  it('is unreachable when the row records an earlier known contract and an invariant the installed migrations never provide', () => {
    expect(
      classifyInstalledSpaceRow({
        contractSpace: installed,
        row: row('hash-1', ['_prisma:major-8', '_prisma:major-9']),
        ledger: [],
      }),
    ).toEqual({ kind: 'unreachable', reason: 'laterMajor', markerHash: 'hash-1' });
  });
});

describe('classificationNeedsLedger', () => {
  it('needs the ledger only for a row at a contract the migrations never reach', () => {
    expect({
      none: classificationNeedsLedger(installed, null),
      head: classificationNeedsLedger(installed, row('hash-2')),
      behind: classificationNeedsLedger(installed, row('hash-1')),
      unknown: classificationNeedsLedger(installed, row('hash-later')),
      laterMajor: classificationNeedsLedger(
        installed,
        row('hash-later', ['_prisma:major-8', '_prisma:major-9']),
      ),
    }).toEqual({ none: false, head: false, behind: false, unknown: true, laterMajor: false });
  });
});
