import type { StreamEvent } from '@prisma/cli-engine';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  answers,
  envelopeOf,
  harness,
  project,
  removeProjects,
  setUpProject,
} from './fixtures/db-update-consent-project';

beforeEach(setUpProject);
afterAll(removeProjects);

function errorOf(run: { readonly json: readonly StreamEvent[] }): unknown {
  return (envelopeOf(run.json) as { readonly error: unknown }).error;
}

/** The flags of each next action that gives flags with no placeholder, as a shell reads them. */
function printedFlags(error: unknown): readonly string[] {
  const labels = (
    (error as { readonly nextActions?: readonly { label: string }[] }).nextActions ?? []
  )
    .map(({ label }) => label)
    .filter((label) => !label.startsWith('Remove ') && !label.includes('<'));
  return labels.flatMap((label) => {
    const flags = label.slice(label.lastIndexOf(': --') + 2);
    return [...flags.matchAll(/'([^']*)'|(\S+)/g)].map(([, quoted, bare]) => quoted ?? bare ?? '');
  });
}

describe('db update given a flag with the right subject and a verb its change does not take', () => {
  it('says to remove it, and applies once it is gone and the printed flags are given', async () => {
    const refused = await harness().run(['db', 'update', '--allow', 'Legacy', '--json'], {
      cwd: project.dir,
    });
    const error = errorOf(refused);
    const followed = await harness().run(['db', 'update', ...printedFlags(error), '--json'], {
      cwd: project.dir,
    });

    expect({ error, flags: printedFlags(error), exitCode: followed.exitCode, answers }).toEqual({
      error: {
        code: 'CLI.CONSENT_REQUIRED',
        severity: 'error',
        summary:
          'This change would lose data and change access: "audit_old", model "Legacy", "User".',
        why: [
          'This change would delete the data in "audit_old", which no model of the contract before this change stores.',
          'The operation of the plan that does this: Drop table "audit_old".',
          '',
          'Removing model "Legacy" would delete its data.',
          'The operation of the plan that does this: Drop table "Legacy".',
          '',
          'Access to the data of "User" would widen.',
          'The operation of the plan that does this: Disable row-level security on "User".',
        ].join('\n'),
        nextActions: [
          {
            kind: 'user-choice',
            label: 'Remove --allow Legacy: this change does not change access to model "Legacy".',
          },
          { kind: 'user-choice', label: 'If the data in "audit_old" can go: --delete audit_old' },
          {
            kind: 'user-choice',
            label:
              'If model "Legacy" was renamed, add it to the contract under its new name and run `prisma-test contract emit`; then keep its data: --rename \'Legacy:<new name>\'',
          },
          { kind: 'user-choice', label: 'If the data of model "Legacy" can go: --delete Legacy' },
          { kind: 'user-choice', label: 'To allow the change to "User": --allow User' },
        ],
        meta: {
          unanswered: [
            { subject: 'audit_old', verbs: ['delete'] },
            { subject: 'Legacy', verbs: ['rename', 'delete'] },
            { subject: 'User', verbs: ['allow'] },
          ],
        },
      },
      flags: ['--delete', 'audit_old', '--delete', 'Legacy', '--allow', 'User'],
      exitCode: 0,
      answers: [
        { verb: 'delete', text: 'audit_old' },
        { verb: 'delete', text: 'Legacy' },
        { verb: 'allow', text: 'User' },
      ],
    });
  });
});

describe('db update given a second --allow of a model', () => {
  it('refuses it before asking anything, saying the first already allowed it', async () => {
    const run = await harness().run(
      [
        'db',
        'update',
        '--delete',
        'audit_old',
        '--delete',
        'Legacy',
        '--allow',
        'User',
        '--allow',
        'User',
        '--json',
      ],
      { cwd: project.dir },
    );

    expect({ exitCode: run.exitCode, error: errorOf(run), answers }).toEqual({
      exitCode: 2,
      error: {
        code: 'CLI.CONSENT_UNUSED',
        severity: 'error',
        summary:
          '--allow User was given, but the question about User was already answered by --allow User.',
        why: 'The run asked about audit_old, Legacy, User.',
        nextActions: [{ kind: 'user-choice', label: 'Give one flag per question.' }],
        meta: {
          unused: [{ verb: 'allow', values: ['User'] }],
          asked: ['audit_old', 'Legacy', 'User'],
        },
      },
      answers: [],
    });
  });
});
