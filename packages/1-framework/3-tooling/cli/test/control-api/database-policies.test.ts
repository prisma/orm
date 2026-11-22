import {
  type DatabasePolicies,
  DEFAULT_DATABASE_POLICIES,
} from '@internal/framework-components/control';
import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import type { MigrationGraph } from '@internal/migration-tools/graph';
import type { NamedRef } from '@internal/migration-tools/refs';
import { describe, expect, it } from 'vitest';
import { checkRunPolicies } from '../../src/control-api/operations/database-policies';
import { buildGraph, entry } from '../utils/graph-helpers';

const ORIGIN = 'a'.repeat(64);
const TARGET = 'b'.repeat(64);
const MIGRATE_ONLY: DatabasePolicies = { ...DEFAULT_DATABASE_POLICIES, change: ['migrate'] };

const LEADS_TO_TARGET = buildGraph([
  entry(EMPTY_CONTRACT_HASH, ORIGIN, 'm1'),
  entry(ORIGIN, TARGET, 'm2'),
]);

function check(args: {
  readonly command: 'db update' | 'db migrate' | 'db sign';
  readonly inForce: DatabasePolicies;
  readonly declared?: { readonly change: readonly ('migrate' | 'reconcile')[] };
  readonly ref?: NamedRef;
  readonly permitPolicyChange: boolean;
  readonly graph?: MigrationGraph;
  readonly markerHash?: string;
}) {
  return checkRunPolicies({
    command: args.command,
    app: { spaceId: 'app', graph: args.graph ?? buildGraph([]), refs: {}, emittedHash: TARGET },
    markers: new Map([['app', { storageHash: args.markerHash ?? ORIGIN, invariants: [] }]]),
    inForce: args.inForce,
    ref:
      args.ref ??
      (args.declared === undefined
        ? undefined
        : { name: 'production', hash: TARGET, invariants: [], policies: args.declared }),
    permitPolicyChange: args.permitPolicyChange,
    targetHash: TARGET,
    invocation: undefined,
  });
}

function recoveryOf(result: ReturnType<typeof check>): string | undefined {
  return result.ok ? undefined : result.failure.toEnvelope().fix;
}

describe('checkRunPolicies', () => {
  it.each(['db update', 'db sign'] as const)(
    'advises %s, refused on a database that changes only through migrations, to run db migrate to the target alone when migrations already lead there',
    (command) => {
      const recovery = `The planned migrations already lead there: apply them with \`{bin} db migrate --to ${TARGET}\`.`;
      const result = check({
        command,
        inForce: MIGRATE_ONLY,
        permitPolicyChange: false,
        graph: LEADS_TO_TARGET,
      });

      expect(result.ok ? undefined : result.failure.toEnvelope()).toMatchObject({
        fix: recovery,
        nextActions: [{ kind: 'user-choice', label: recovery }],
      });
    },
  );

  it.each(['db update', 'db sign'] as const)(
    'tells %s, refused on a database already at the target, that there is nothing to apply, with no command',
    (command) => {
      expect(
        recoveryOf(
          check({
            command,
            inForce: MIGRATE_ONLY,
            permitPolicyChange: false,
            graph: LEADS_TO_TARGET,
            markerHash: TARGET,
          }),
        ),
      ).toBe(
        'The database is already at this contract, so there is no migration for `db migrate` to apply.',
      );
    },
  );

  it('advises authoring a migration for db update --to a ref whose invariant no migration on the path provides', () => {
    expect(
      recoveryOf(
        check({
          command: 'db update',
          inForce: MIGRATE_ONLY,
          permitPolicyChange: false,
          graph: LEADS_TO_TARGET,
          ref: { name: 'production', hash: TARGET, invariants: ['seeded'] },
        }),
      ),
    ).toBe(
      `Author a migration with \`{bin} migration plan --from ${ORIGIN} --to production\`, then apply it with \`{bin} db migrate --to production\`.`,
    );
  });

  it('refuses db update when the database changes only through migrations, naming the marker', () => {
    const result = check({
      command: 'db update',
      inForce: MIGRATE_ONLY,
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

  it("advises db update to the ref the user named when the marker's policy refuses db migrate", () => {
    const result = check({
      command: 'db migrate',
      inForce: { ...DEFAULT_DATABASE_POLICIES, change: ['reconcile'] },
      ref: {
        name: 'production',
        hash: TARGET,
        invariants: [],
        policies: { dataProtection: { dataLoss: 'data-loss-forbidden' } },
      },
      permitPolicyChange: true,
    });
    const reconcile = '{bin} db update --to production --permit-policy-change';

    expect(result.ok ? undefined : result.failure.toEnvelope()).toMatchObject({
      code: 'MIGRATION.CHANGE_POLICY_FORBIDS',
      summary: "This database's change policy permits only db update",
      why: 'The marker records change: reconcile, so db migrate may not move it.',
      nextActions: [{ kind: 'run-command', label: 'Reconcile the database', command: reconcile }],
    });
  });
});
