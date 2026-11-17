import { asNamespaceId } from '@internal/contract/types';
import type { ResolvedEnumValueRenameStatement } from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import { planningRefusedError } from '../../src/utils/planning-refused-error';

function rename(from: string, to: string): ResolvedEnumValueRenameStatement {
  return {
    kind: 'rename',
    entity: 'enumValue',
    from: { namespaceId: asNamespaceId('app'), enum: 'Status', member: from },
    to: { namespaceId: asNamespaceId('app'), enum: 'Status', member: to },
  };
}

const PROJECT = { cwd: '/work/app', configPath: undefined, dbGiven: false };
const active = rename('ACTIVE', 'X');
const old = rename('OLD', 'Y');
const cycle = [active, old];
const other = rename('DONE', 'FINISHED');
const conflict = {
  kind: 'statementRefused',
  summary:
    'Cannot rename enum value "Status.ACTIVE" to "Status.X": the renames move stored values in a cycle',
  why: 'Leave out the renames in the cycle, and write the rewrites by hand.',
  refusedStatement: active,
  leaveOut: cycle,
};

describe('a planning refusal that can be written by hand', () => {
  it('prints the plan without the statements to leave out, keeping the run statements and --from', () => {
    const error = planningRefusedError([conflict], {
      invocation: PROJECT,
      from: 'sha256:0123',
      to: undefined,
      statements: [
        { verb: 'rename', text: 'Status.ACTIVE:Status.X' },
        { verb: 'rename', text: 'Status.DONE:Status.FINISHED' },
        { verb: 'delete', text: 'Legacy' },
        { verb: 'rename', text: 'Status.OLD:Status.Y' },
      ],
      resolved: [active, other, old],
    });

    expect({
      code: error.code,
      actions: (error.nextActions ?? []).map(({ label }) => label),
    }).toEqual({
      code: 'MIGRATION.PLANNING_FAILED',
      actions: [
        'To write the rewrites by hand, plan the change without --rename Status.ACTIVE:Status.X and --rename Status.OLD:Status.Y with `{bin} migration plan --from sha256:0123 --rename Status.DONE:Status.FINISHED --delete Legacy`, add the rewrites the message describes to the migration.ts it writes, run `node <migration directory>/migration.ts` for the directory it writes, and apply it with `{bin} db migrate`',
      ],
    });
  });

  it('keeps the --to the plan was given', () => {
    const error = planningRefusedError([conflict], {
      invocation: PROJECT,
      from: 'sha256:0123',
      to: 'staging',
      statements: [{ verb: 'rename', text: 'Status.ACTIVE:Status.X' }],
      resolved: [active],
    });

    expect((error.nextActions ?? []).map(({ label }) => label)).toEqual([
      'To write the rewrites by hand, plan the change without --rename Status.ACTIVE:Status.X with `{bin} migration plan --from sha256:0123 --to staging`, add the rewrites the message describes to the migration.ts it writes, run `node <migration directory>/migration.ts` for the directory it writes, and apply it with `{bin} db migrate`',
    ]);
  });

  it('is the plain planning failure when no conflict can be written by hand', () => {
    const { leaveOut: _, ...plain } = conflict;
    expect(
      planningRefusedError([plain], {
        invocation: PROJECT,
        from: undefined,
        to: undefined,
        statements: [],
        resolved: [],
      }).nextActions ?? [],
    ).toEqual([]);
  });
});
