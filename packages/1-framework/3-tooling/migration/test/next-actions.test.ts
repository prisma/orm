import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MigrationToolsError } from '../src/errors';
import {
  errorContractSnapshotMissing,
  errorHashNotInGraph,
  errorInvalidRefValue,
  errorRefNotResolvable,
} from '../src/errors';
import type { MigrationGraph } from '../src/graph';
import { deleteRef, readRef, resolveRef } from '../src/refs';

const emptyGraph: MigrationGraph = {
  nodes: new Set(),
  forwardChain: new Map(),
  reverseChain: new Map(),
  migrationByHash: new Map(),
};

describe('errors.ts — converted factories carry typed nextActions', () => {
  it('errorInvalidRefValue', () => {
    const error = errorInvalidRefValue('not-a-hash');

    expect(error.fix).toBe(
      'Use a valid storage hash from `{bin} contract emit` output or an existing migration.',
    );
    expect(error.nextActions).toEqual([
      {
        kind: 'run-command',
        label: 'Emit the contract to obtain a valid storage hash',
        command: '{bin} contract emit',
      },
      {
        kind: 'run-command',
        label: 'List existing migrations to reuse one of their hashes',
        command: '{bin} migration list',
      },
    ]);
  });

  it('errorRefNotResolvable', () => {
    const error = errorRefNotResolvable('staging');

    expect(error.nextActions).toEqual([
      {
        kind: 'run-command',
        label: 'Create the ref "staging"',
        command: '{bin} migration ref set staging <hash>',
      },
      {
        kind: 'run-command',
        label: 'Advance the ref "staging" as part of an update',
        command: '{bin} db update --advance-ref staging',
      },
      {
        kind: 'user-choice',
        label: 'Pass a hash that is already a node in the migration graph',
      },
    ]);
  });

  it('errorHashNotInGraph', () => {
    const error = errorHashNotInGraph('abc123', emptyGraph);

    expect(error.nextActions).toEqual([
      {
        kind: 'user-choice',
        label:
          'Pass a hash that is the from-or-to of an on-disk migration bundle, or use --from with a graph-node hash',
        reason: 'Graph nodes: (none).',
      },
      {
        kind: 'run-command',
        label: 'Introduce "abc123" by planning a migration for it',
        command: '{bin} migration plan',
      },
    ]);
  });

  it('errorContractSnapshotMissing', () => {
    const error = errorContractSnapshotMissing('abc123', 'migrations/snapshots/abc123.json');

    expect(error.nextActions).toEqual([
      {
        kind: 'run-command',
        label: 'Re-emit the snapshot for an app-space migration',
        command: '{bin} migration plan',
      },
      {
        kind: 'user-choice',
        label: "For an extension space, re-run that extension's contract-space build instead",
      },
      {
        kind: 'user-choice',
        label: 'Restore migrations/snapshots/ from version control',
      },
    ]);
  });
});

describe('refs.ts — converted raise sites carry typed nextActions', () => {
  let refsDir: string;

  beforeEach(async () => {
    refsDir = await mkdtemp(join(tmpdir(), 'refs-next-actions-'));
  });

  afterEach(async () => {
    await rm(refsDir, { recursive: true, force: true });
  });

  it('readRef on a missing ref file', async () => {
    await expect(readRef(refsDir, 'staging')).rejects.toMatchObject({
      code: 'MIGRATION.UNKNOWN_REF',
      nextActions: [
        {
          kind: 'run-command',
          label: 'Create the ref "staging"',
          command: '{bin} migration ref set staging <hash>',
        },
      ],
    });
  });

  it('deleteRef on a missing ref file', async () => {
    await expect(deleteRef(refsDir, 'staging')).rejects.toMatchObject({
      code: 'MIGRATION.UNKNOWN_REF',
      nextActions: [
        {
          kind: 'run-command',
          label: 'List the available refs',
          command: '{bin} migration ref list',
        },
      ],
    });
  });

  it('resolveRef on a name absent from the loaded refs, listing what is available', () => {
    let thrown: MigrationToolsError | undefined;
    try {
      resolveRef({ production: { hash: 'a'.repeat(64), invariants: [] } }, 'staging');
    } catch (error) {
      thrown = error as MigrationToolsError;
    }

    expect(thrown?.code).toBe('MIGRATION.UNKNOWN_REF');
    expect(thrown?.nextActions).toEqual([
      {
        kind: 'run-command',
        label: 'Create the ref "staging"',
        command: '{bin} migration ref set staging <hash>',
        reason: 'Available refs: production.',
      },
    ]);
  });
});

describe('no converted action hardcodes a binary name', () => {
  const converted = [
    errorInvalidRefValue('v'),
    errorRefNotResolvable('staging'),
    errorHashNotInGraph('abc123', emptyGraph),
    errorContractSnapshotMissing('abc123', 'path'),
  ];

  it.each(converted.map((error) => [error.code, error] as const))(
    '%s writes {bin} rather than a literal binary',
    (_code, error) => {
      const commands = (error.nextActions ?? []).flatMap((action) => [
        ...(action.command === undefined ? [] : [action.command]),
        ...(action.commands ?? []),
      ]);

      expect(commands.length).toBeGreaterThan(0);
      for (const command of commands) {
        expect(command).toContain('{bin}');
        expect(command).not.toContain('prisma-next');
      }
    },
  );
});
