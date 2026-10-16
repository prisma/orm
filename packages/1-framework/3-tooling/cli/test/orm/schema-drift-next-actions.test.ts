import type { DiffableNode, SchemaDiffIssue } from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import { schemaDriftNextActions } from '../../src/orm/db/verification';

const node: DiffableNode = {
  id: 'default',
  nodeKind: 'sql-column-default',
  isEqualTo: () => false,
  children: () => [],
};

const refused: SchemaDiffIssue = {
  path: ['public', 'event', 'on', 'default'],
  expected: node,
  explanation: { text: 'Re-emit the contract, then try again.', cause: 'expected-refused' },
};
const possiblyEquivalent: SchemaDiffIssue = {
  path: ['public', 'event', 'at', 'default'],
  expected: node,
  actual: node,
  explanation: {
    text: 'The database reads this default back as sql`(now())`.',
    cause: 'possibly-equivalent',
  },
};
const plain: SchemaDiffIssue = { path: ['public', 'event', 'id'], expected: node };

const REEMIT = {
  kind: 'run-command',
  label:
    'Re-emit the contract: the emitted contract holds a value its type refuses, and re-emitting stores it as its type holds it',
  command: '{bin} contract emit',
};
const writeAsStored = (retry: string) => ({
  kind: 'user-choice',
  label: `If the database only stored a value in a form of its own, write it in the contract source as the database stores it, re-run contract emit, then ${retry}`,
});
const dbUpdate = (verb: string, command = '{bin} db update') => ({
  kind: 'run-command',
  label: `Change the database to match the contract, then ${verb} again`,
  command,
});
const describeOtherIssues = (retry: string) => ({
  kind: 'user-choice',
  label: `Or, for the issues with no explanation, change the contract source to describe the database as it is, re-run contract emit, then ${retry}`,
});
const describeDatabase = (retry: string) => ({
  kind: 'user-choice',
  label: `Or change the contract source to describe the database as it is, re-run contract emit, then ${retry}`,
});

describe('schemaDriftNextActions', () => {
  it('offers db update, then a change to the contract source, for db sign', () => {
    expect(schemaDriftNextActions({ verb: 'sign', contractRef: undefined, issues: [] })).toEqual([
      dbUpdate('sign'),
      describeDatabase('sign again'),
    ]);
  });

  it('says verify again for db verify', () => {
    expect(
      schemaDriftNextActions({ verb: 'verify', contractRef: undefined, issues: [plain] }),
    ).toEqual([dbUpdate('verify'), describeDatabase('verify again')]);
  });

  it('aims db update at the ref being signed, and the contract change at the emitted contract', () => {
    expect(schemaDriftNextActions({ verb: 'sign', contractRef: 'staging', issues: [] })).toEqual([
      dbUpdate('sign', '{bin} db update --to "staging"'),
      describeDatabase('sign the emitted contract instead of "staging"'),
    ]);
  });

  it('offers only re-emitting when every issue is a refused contract value', () => {
    expect(
      schemaDriftNextActions({ verb: 'sign', contractRef: 'staging', issues: [refused] }),
    ).toEqual([REEMIT]);
  });

  it('offers re-emitting, then the drift actions, when another issue is plain drift', () => {
    expect(
      schemaDriftNextActions({ verb: 'verify', contractRef: undefined, issues: [plain, refused] }),
    ).toEqual([REEMIT, dbUpdate('verify'), describeDatabase('verify again')]);
  });

  it('offers writing the stored form, then db update for real drift', () => {
    expect(
      schemaDriftNextActions({
        verb: 'verify',
        contractRef: undefined,
        issues: [possiblyEquivalent],
      }),
    ).toEqual([writeAsStored('verify again'), dbUpdate('verify')]);
  });

  it('aims each action at the ref being signed when a value may be in the database form', () => {
    expect(
      schemaDriftNextActions({
        verb: 'sign',
        contractRef: 'staging',
        issues: [possiblyEquivalent],
      }),
    ).toEqual([
      writeAsStored('sign the emitted contract instead of "staging"'),
      dbUpdate('sign', '{bin} db update --to "staging"'),
    ]);
  });

  it('names the other issues in the contract change beside writing the stored form, once each', () => {
    expect(
      schemaDriftNextActions({
        verb: 'verify',
        contractRef: undefined,
        issues: [possiblyEquivalent, plain, possiblyEquivalent],
      }),
    ).toEqual([
      writeAsStored('verify again'),
      dbUpdate('verify'),
      describeOtherIssues('verify again'),
    ]);
  });

  it('offers re-emitting first, then writing the stored form, then the drift actions, for all three', () => {
    expect(
      schemaDriftNextActions({
        verb: 'verify',
        contractRef: undefined,
        issues: [possiblyEquivalent, plain, refused],
      }),
    ).toEqual([
      REEMIT,
      writeAsStored('verify again'),
      dbUpdate('verify'),
      describeOtherIssues('verify again'),
    ]);
  });

  it('offers re-emitting, writing the stored form and db update for a refused value beside one in the database form', () => {
    expect(
      schemaDriftNextActions({
        verb: 'verify',
        contractRef: undefined,
        issues: [refused, possiblyEquivalent],
      }),
    ).toEqual([REEMIT, writeAsStored('verify again'), dbUpdate('verify')]);
  });
});
