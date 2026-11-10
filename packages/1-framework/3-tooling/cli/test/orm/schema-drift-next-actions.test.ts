import type { DiffableNode, SchemaDiffIssue } from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import { schemaDriftNextActions } from '../../src/orm/db/verification';

const node: DiffableNode = {
  id: 'default',
  nodeKind: 'sql-column-default',
  isEqualTo: () => false,
  children: () => [],
};

const differs: SchemaDiffIssue = {
  path: ['public', 'event', 'on', 'default'],
  expected: node,
  actual: node,
  explanation: { text: 'The contract holds 1, and the database holds 2.', cause: 'differs' },
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
  label: `Or, for the other issues, change the contract source to describe the database as it is, re-run contract emit, then ${retry}`,
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

  it('offers db update, then a change to the contract source, for an issue whose values differ', () => {
    expect(
      schemaDriftNextActions({ verb: 'verify', contractRef: undefined, issues: [differs] }),
    ).toEqual([dbUpdate('verify'), describeDatabase('verify again')]);
  });

  it("names the other issues beside writing the stored form when an issue's values differ", () => {
    expect(
      schemaDriftNextActions({
        verb: 'verify',
        contractRef: undefined,
        issues: [differs, possiblyEquivalent],
      }),
    ).toEqual([
      writeAsStored('verify again'),
      dbUpdate('verify'),
      describeOtherIssues('verify again'),
    ]);
  });
});
