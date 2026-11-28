import { structuredError } from '@internal/utils/structured-error';
import { createSqlContract } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { resolveRecordedPath } from '../../../src/aggregate/strategies/resolve-recorded-path';
import type { AggregateContractSpace } from '../../../src/aggregate/types';
import { EMPTY_CONTRACT_HASH } from '../../../src/constants';
import type { OnDiskMigrationPackage } from '../../../src/package';
import { createAttestedPackage, makeAggregateContractSpace } from '../../fixtures';

function makeSpace(
  packages: readonly OnDiskMigrationPackage[],
  headHash: string,
  invariants: readonly string[] = [],
): AggregateContractSpace {
  return makeAggregateContractSpace({
    spaceId: 'cipherstash',
    contract: createSqlContract({ target: 'postgres' }),
    headRef: { hash: headHash, invariants },
    packages,
  });
}

describe('resolveRecordedPath', () => {
  it('names each destructive operation of the path by its storage name and label, and says nothing of how it loses data', () => {
    const headHash = 'cipher-head';
    const pkg = createAttestedPackage('20260101T0000_init', { from: null, to: headHash }, [
      { id: 'table.events', label: 'Create table events', operationClass: 'additive' },
      { id: 'table.legacy', label: 'Drop table legacy', operationClass: 'destructive' },
    ]);

    const outcome = resolveRecordedPath({
      aggregateTargetId: 'postgres',
      space: makeSpace([pkg], headHash),
      currentMarker: null,
      storageNameOf: (operation) => `storage of ${operation.id}`,
      accessChangesOf: () => [],
    });

    expect(outcome.kind === 'ok' && outcome.result).toMatchObject({
      dataLoss: [
        {
          operationIndex: 1,
          subject: { kind: 'storage', name: 'storage of table.legacy' },
          label: 'Drop table legacy',
        },
      ],
      accessChanges: [],
    });
    expect(outcome.kind === 'ok' && outcome.result.dataLoss[0]).not.toHaveProperty('loss');
  });

  it("lists each migration's access changes, asked of each migration on its own, at their positions in the path", () => {
    const middleHash = 'cipher-middle';
    const headHash = 'cipher-head';
    const first = createAttestedPackage('20260101T0000_init', { from: null, to: middleHash }, [
      { id: 'table.events', label: 'Create table events', operationClass: 'additive' },
      { id: 'policy.events.drop', label: 'Drop policy on events', operationClass: 'widening' },
    ]);
    const second = createAttestedPackage('20260102T0000_open', { from: middleHash, to: headHash }, [
      { id: 'rls.events.disable', label: 'Disable RLS on events', operationClass: 'widening' },
    ]);
    const asked: string[][] = [];

    const outcome = resolveRecordedPath({
      aggregateTargetId: 'postgres',
      space: makeSpace([first, second], headHash),
      currentMarker: null,
      storageNameOf: (operation) => operation.id,
      accessChangesOf: (operations) => {
        asked.push(operations.map(({ id }) => id));
        return operations.flatMap((operation, operationIndex) =>
          operation.operationClass === 'widening'
            ? [{ operationIndex, subject: { kind: 'storage', name: operation.id }, widens: true }]
            : [],
        );
      },
    });

    expect({ accessChanges: outcome.kind === 'ok' && outcome.result.accessChanges, asked }).toEqual(
      {
        accessChanges: [
          {
            operationIndex: 1,
            subject: { kind: 'storage', name: 'policy.events.drop' },
            widens: true,
          },
          {
            operationIndex: 2,
            subject: { kind: 'storage', name: 'rls.events.disable' },
            widens: true,
          },
        ],
        asked: [['table.events', 'policy.events.drop'], ['rls.events.disable']],
      },
    );
  });

  it('names the migration and space of an operation the family refuses to read', () => {
    const middleHash = 'cipher-middle';
    const headHash = 'cipher-head';
    const first = createAttestedPackage('20260101T0000_init', { from: null, to: middleHash });
    const second = createAttestedPackage('20260102T0000_next', { from: middleHash, to: headHash });

    expect(() =>
      resolveRecordedPath({
        aggregateTargetId: 'postgres',
        space: makeSpace([first, second], headHash),
        currentMarker: null,
        storageNameOf: (operation) => operation.id,
        accessChangesOf: (operations) => {
          if (operations === second.ops) {
            throw structuredError('MIGRATION.INVALID_OPERATION_ENTRY', 'malformed', {
              why: 'Operation 0 is not in a format this release of Prisma reads: zzz must be removed.',
              fix: 'restore it',
              meta: { index: 0 },
            });
          }
          return [];
        },
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'MIGRATION.INVALID_OPERATION_ENTRY',
        why: 'In migration "20260102T0000_next" of space "cipherstash": Operation 0 is not in a format this release of Prisma reads: zzz must be removed.',
        fix: 'restore it',
        meta: { index: 0, migration: '20260102T0000_next', space: 'cipherstash' },
      }),
    );
  });

  it('walks the shortest path from the live marker to the on-disk head ref', () => {
    const headHash = 'cipher-head';
    const pkg = createAttestedPackage('20260101T0000_init', { from: null, to: headHash });

    const outcome = resolveRecordedPath({
      aggregateTargetId: 'postgres',
      space: makeSpace([pkg], headHash),
      currentMarker: null,
      storageNameOf: (operation) => operation.id,
      accessChangesOf: () => [],
    });

    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(outcome.result.plan.targetId).toBe('postgres');
    expect(outcome.result.plan.destination.storageHash).toBe(headHash);
    // origin null because no marker yet — runner skips origin validation.
    expect(outcome.result.plan.origin).toBe(null);
    expect(outcome.result.strategy).toBe('resolve-recorded-path');
  });

  it('threads package end snapshots onto migration edge refs', () => {
    const midHash = 'cipher-mid';
    const headHash = 'cipher-head';
    const baseline: OnDiskMigrationPackage = {
      ...createAttestedPackage('20260101T0000_init', { from: null, to: midHash }),
      endContractJson: { models: ['user'] },
    };
    const delta: OnDiskMigrationPackage = {
      ...createAttestedPackage('20260102T0000_add_post', { from: midHash, to: headHash }),
      endContractJson: { models: ['user', 'post'] },
    };

    const outcome = resolveRecordedPath({
      aggregateTargetId: 'postgres',
      space: makeSpace([baseline, delta], headHash),
      currentMarker: null,
      storageNameOf: (operation) => operation.id,
      accessChangesOf: () => [],
    });

    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(outcome.result.migrationEdges).toHaveLength(2);
    expect(outcome.result.migrationEdges[0]?.destinationContractJson).toEqual({ models: ['user'] });
    expect(outcome.result.migrationEdges[1]?.destinationContractJson).toEqual({
      models: ['user', 'post'],
    });
  });

  it('leaves edge snapshots absent when packages carry none', () => {
    const headHash = 'cipher-head';
    const pkg = createAttestedPackage('20260101T0000_init', { from: null, to: headHash });

    const outcome = resolveRecordedPath({
      aggregateTargetId: 'postgres',
      space: makeSpace([pkg], headHash),
      currentMarker: null,
      storageNameOf: (operation) => operation.id,
      accessChangesOf: () => [],
    });

    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(outcome.result.migrationEdges[0]?.destinationContractJson).toBeUndefined();
  });

  it('returns unreachable when the live marker is not connected to the head', () => {
    const headHash = 'disconnected';
    // Single migration whose graph has only one node (EMPTY_CONTRACT_HASH → other-target).
    const pkg = createAttestedPackage('20260101T0000_init', {
      from: null,
      to: 'not-the-head',
    });

    const outcome = resolveRecordedPath({
      aggregateTargetId: 'postgres',
      space: makeSpace([pkg], headHash),
      currentMarker: null,
      storageNameOf: (operation) => operation.id,
      accessChangesOf: () => [],
    });

    expect(outcome.kind).toBe('unreachable');
  });

  it('returns unsatisfiable when the path does not cover required invariants', () => {
    // A package walking baseline → headHash but providing zero invariants.
    const headHash = 'cipher-head';
    const pkg = createAttestedPackage('20260101T0000_init', { from: null, to: headHash });
    const space = makeSpace([pkg], headHash, ['cipher:create-v1']);

    const outcome = resolveRecordedPath({
      aggregateTargetId: 'postgres',
      space,
      currentMarker: null,
      storageNameOf: (operation) => operation.id,
      accessChangesOf: () => [],
    });

    expect(outcome.kind).toBe('unsatisfiable');
    if (outcome.kind !== 'unsatisfiable') return;
    expect(outcome.missing).toEqual(['cipher:create-v1']);
  });

  it('decorates the pathDecision with the supplied refName', () => {
    const headHash = 'cipher-head';
    const pkg = createAttestedPackage('20260101T0000_init', { from: null, to: headHash });

    const outcome = resolveRecordedPath({
      aggregateTargetId: 'postgres',
      space: makeSpace([pkg], headHash),
      currentMarker: null,
      refName: 'prod',
      storageNameOf: (operation) => operation.id,
      accessChangesOf: () => [],
    });

    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(outcome.result.pathDecision?.refName).toBe('prod');
  });

  it('omits pathDecision.refName when no refName is supplied', () => {
    const headHash = 'cipher-head';
    const pkg = createAttestedPackage('20260101T0000_init', { from: null, to: headHash });

    const outcome = resolveRecordedPath({
      aggregateTargetId: 'postgres',
      space: makeSpace([pkg], headHash),
      currentMarker: null,
      storageNameOf: (operation) => operation.id,
      accessChangesOf: () => [],
    });

    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(outcome.result.pathDecision?.refName).toBeUndefined();
  });

  it('returns ok with empty pathOps when the marker is already at the head ref', () => {
    const headHash = 'cipher-head';
    const pkg = createAttestedPackage('20260101T0000_init', { from: null, to: headHash });

    const outcome = resolveRecordedPath({
      aggregateTargetId: 'postgres',
      space: makeSpace([pkg], headHash),
      currentMarker: { storageHash: headHash, invariants: [] },
      storageNameOf: (operation) => operation.id,
      accessChangesOf: () => [],
    });

    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(outcome.result.plan.operations).toEqual([]);
    expect(outcome.result.plan.origin).toEqual({ storageHash: headHash });
  });

  it('handles the empty-graph + EMPTY_CONTRACT_HASH head ref + no invariants happy path', () => {
    // Graph is empty, head ref points at the empty-contract sentinel,
    // and the marker is also absent. findPathWithDecision returns ok
    // with an empty path because fromHash === toHash.
    const outcome = resolveRecordedPath({
      aggregateTargetId: 'postgres',
      space: makeSpace([], EMPTY_CONTRACT_HASH),
      currentMarker: null,
      storageNameOf: (operation) => operation.id,
      accessChangesOf: () => [],
    });

    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(outcome.result.plan.operations).toEqual([]);
  });
});
