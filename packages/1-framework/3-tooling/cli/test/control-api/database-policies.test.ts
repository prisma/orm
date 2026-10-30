import {
  type DatabasePolicies,
  DEFAULT_DATABASE_POLICIES,
} from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import { checkRunPolicies } from '../../src/control-api/operations/database-policies';

const TARGET = 'b'.repeat(64);

function check(args: {
  readonly command: 'db update' | 'db migrate';
  readonly inForce: DatabasePolicies;
  readonly declared?: { readonly change: readonly ('migrate' | 'reconcile')[] };
  readonly permitPolicyChange: boolean;
}) {
  return checkRunPolicies({
    command: args.command,
    appSpaceId: 'app',
    inForce: args.inForce,
    ref:
      args.declared === undefined
        ? undefined
        : { name: 'production', hash: TARGET, invariants: [], policies: args.declared },
    permitPolicyChange: args.permitPolicyChange,
    targetHash: TARGET,
    invocation: undefined,
  });
}

describe('checkRunPolicies', () => {
  it('refuses db update when the database changes only through migrations, naming the marker', () => {
    const result = check({
      command: 'db update',
      inForce: { ...DEFAULT_DATABASE_POLICIES, change: ['migrate'] },
      permitPolicyChange: false,
    });

    expect(result.ok ? undefined : result.failure.toEnvelope()).toMatchObject({
      why: 'The marker records change: migrate, so db update may not move it.',
      meta: { spaceId: 'app', command: 'db update', change: ['migrate'] },
    });
  });

  it('refuses, with consent, a ref whose declared change policy forbids the command, naming the ref', () => {
    const result = check({
      command: 'db update',
      inForce: DEFAULT_DATABASE_POLICIES,
      declared: { change: ['migrate'] },
      permitPolicyChange: true,
    });

    expect(result.ok ? undefined : result.failure.toEnvelope()).toMatchObject({
      code: 'MIGRATION.CHANGE_POLICY_FORBIDS',
      why: 'production declares change: migrate, so db update may not move it.',
      meta: { spaceId: 'app', command: 'db update', change: ['migrate'] },
    });
  });

  it('writes nothing when the ref declares only settings already in force', () => {
    const result = check({
      command: 'db migrate',
      inForce: DEFAULT_DATABASE_POLICIES,
      declared: { change: ['reconcile', 'migrate'] },
      permitPolicyChange: false,
    });

    expect(result.ok ? result.value : result.failure).toEqual({
      inForce: DEFAULT_DATABASE_POLICIES,
      toWrite: undefined,
    });
  });
});
