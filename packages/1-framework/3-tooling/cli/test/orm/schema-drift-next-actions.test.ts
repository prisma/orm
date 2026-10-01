import type { DiffableNode } from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import { schemaDriftNextActions } from '../../src/orm/db/verification';

const node: DiffableNode = {
  id: 'default',
  nodeKind: 'sql-column-default',
  isEqualTo: () => false,
  children: () => [],
};

describe('schemaDriftNextActions', () => {
  it('offers db update, then a change to the contract source, for db sign', () => {
    expect(schemaDriftNextActions({ verb: 'sign', contractRef: undefined, issues: [] })).toEqual([
      {
        kind: 'run-command',
        label: 'Change the database to match the contract, then sign again',
        command: '{bin} db update',
      },
      {
        kind: 'user-choice',
        label:
          'Or change the contract source to describe the database as it is, re-run contract emit, then sign again',
      },
    ]);
  });

  it('says verify again for db verify', () => {
    expect(schemaDriftNextActions({ verb: 'verify', contractRef: undefined, issues: [] })).toEqual([
      {
        kind: 'run-command',
        label: 'Change the database to match the contract, then verify again',
        command: '{bin} db update',
      },
      {
        kind: 'user-choice',
        label:
          'Or change the contract source to describe the database as it is, re-run contract emit, then verify again',
      },
    ]);
  });

  it('aims db update at the ref being signed, and the contract change at the emitted contract', () => {
    expect(schemaDriftNextActions({ verb: 'sign', contractRef: 'staging', issues: [] })).toEqual([
      {
        kind: 'run-command',
        label: 'Change the database to match the contract, then sign again',
        command: '{bin} db update --to "staging"',
      },
      {
        kind: 'user-choice',
        label:
          'Or change the contract source to describe the database as it is, re-run contract emit, then sign the emitted contract instead of "staging"',
      },
    ]);
  });

  it('offers only re-emitting when a sign of a snapshot finds a refused contract value', () => {
    expect(
      schemaDriftNextActions({
        verb: 'sign',
        contractRef: 'staging',
        issues: [
          {
            path: ['public', 'event', 'at', 'default'],
            expected: node,
            explanation: 'Re-emit the contract, then try again.',
          },
        ],
      }),
    ).toEqual([
      {
        kind: 'run-command',
        label: 'Re-emit the contract, which stores the refused default as its type holds it',
        command: '{bin} contract emit',
      },
    ]);
  });

  it('offers only re-emitting the contract when an issue explains a refused contract value', () => {
    expect(
      schemaDriftNextActions({
        verb: 'verify',
        contractRef: undefined,
        issues: [
          { path: ['public', 'event', 'at', 'default'], expected: node },
          {
            path: ['public', 'event', 'at', 'default'],
            expected: node,
            explanation: 'Re-emit the contract, then try again.',
          },
        ],
      }),
    ).toEqual([
      {
        kind: 'run-command',
        label: 'Re-emit the contract, which stores the refused default as its type holds it',
        command: '{bin} contract emit',
      },
    ]);
  });
});
