import { describe, expect, it } from 'vitest';
import { schemaDriftNextActions } from '../../src/orm/db/verification';

describe('schemaDriftNextActions', () => {
  it('offers db update, then a change to the contract source, for db sign', () => {
    expect(schemaDriftNextActions({ verb: 'sign', contractRef: undefined })).toEqual([
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
    expect(schemaDriftNextActions({ verb: 'verify', contractRef: undefined })).toEqual([
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

  it('aims db update at the ref being signed', () => {
    expect(schemaDriftNextActions({ verb: 'sign', contractRef: 'staging' })[0]).toEqual({
      kind: 'run-command',
      label: 'Change the database to match the contract, then sign again',
      command: '{bin} db update --to "staging"',
    });
  });
});
