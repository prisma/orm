import { describe, expect, it } from 'vitest';
import { dbInitError, dbUpdateError, migrateError } from './runner-failure-errors';

const PROJECT = { cwd: '/work/app', configPath: undefined, dbGiven: false };

const runnerFailed = {
  summary:
    'Operation index.Item.Item_state_idx failed during precheck: ensure index "Item_state_idx" does not exist',
  why: undefined,
} as const;

function failedPrecheck(description: string, planStartsFromMarker: boolean) {
  return { operationId: 'index.Item.Item_state_idx', description, planStartsFromMarker };
}

describe('the advice for a check that fails before an operation runs', () => {
  it('on db migrate without a marker, says the name is taken and points to db sign', () => {
    const error = migrateError(
      {
        ...runnerFailed,
        failedPrecheck: failedPrecheck('ensure index "Item_state_idx" does not exist', false),
      },
      PROJECT,
    );

    expect({ why: error.why, fix: error.fix }).toEqual({
      why: 'Before operation index.Item.Item_state_idx runs, it checks: ensure index "Item_state_idx" does not exist. That check failed on this database.',
      fix: 'The database has no migration marker, so `{bin} db migrate` applies every migration from the first, and the database may already be ahead of this one. If its schema already matches the contract, adopt it instead.',
    });
  });

  it('on db migrate without a marker, offers db sign as a command that is the whole way out, named once', () => {
    const error = migrateError(
      {
        ...runnerFailed,
        failedPrecheck: failedPrecheck('ensure index "Item_state_idx" does not exist', false),
      },
      PROJECT,
    );

    expect(error.nextActions).toEqual([
      {
        kind: 'run-command',
        label:
          'The database has no migration marker, so `{bin} db migrate` applies every migration from the first, and the database may already be ahead of this one. If its schema already matches the contract, adopt it instead',
        command: '{bin} db sign',
      },
    ]);
  });

  it('on db migrate with a marker, says the database drifted from its migration history and points to db verify', () => {
    const error = migrateError(
      {
        ...runnerFailed,
        failedPrecheck: failedPrecheck('ensure column "x" is missing', true),
      },
      PROJECT,
    );

    expect({ why: error.why, fix: error.fix }).toEqual({
      why: 'Before operation index.Item.Item_state_idx runs, it checks: ensure column "x" is missing. That check failed on this database.',
      fix: 'The database has drifted from its migration history: it is not in the state the migrations before this one leave. See how it differs from the contract with `{bin} db verify`, change the database or the migration so they agree, and run `{bin} db migrate` again.',
    });
  });

  it('shows any check description as written', () => {
    const whyOf = (description: string) =>
      migrateError({ ...runnerFailed, failedPrecheck: failedPrecheck(description, true) }, PROJECT)
        .why;

    expect([
      whyOf('ensure constraint "Item_pkey" exists'),
      whyOf('collection items does not exist'),
      whyOf('ensure no NULL values in "note"'),
    ]).toEqual([
      'Before operation index.Item.Item_state_idx runs, it checks: ensure constraint "Item_pkey" exists. That check failed on this database.',
      'Before operation index.Item.Item_state_idx runs, it checks: collection items does not exist. That check failed on this database.',
      'Before operation index.Item.Item_state_idx runs, it checks: ensure no NULL values in "note". That check failed on this database.',
    ]);
  });

  it('on db init, points to db sign', () => {
    const error = dbInitError(
      {
        ...runnerFailed,
        conflicts: undefined,
        failedPrecheck: failedPrecheck('ensure index "Item_state_idx" does not exist', false),
      },
      PROJECT,
    );

    expect(error.fix).toBe(
      'The database already holds part of the schema `{bin} db init` would create. If its schema already matches the contract, adopt it instead.',
    );
  });

  it('on db update, explains the check that failed', () => {
    const error = dbUpdateError(
      {
        ...runnerFailed,
        conflicts: undefined,
        failedPrecheck: failedPrecheck('ensure index "Item_state_idx" does not exist', true),
      },
      PROJECT,
    );

    expect(error.why).toBe(
      'Before operation index.Item.Item_state_idx runs, it checks: ensure index "Item_state_idx" does not exist. That check failed on this database.',
    );
  });
});
