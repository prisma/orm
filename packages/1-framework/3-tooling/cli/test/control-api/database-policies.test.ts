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
  const ref =
    args.ref ??
    (args.declared === undefined
      ? undefined
      : { name: 'production', hash: TARGET, invariants: [], policies: args.declared });
  return checkRunPolicies({
    command: args.command,
    app: {
      spaceId: 'app',
      graph: args.graph ?? buildGraph([]),
      refs: ref === undefined ? {} : { [ref.name]: ref },
      emittedHash: TARGET,
    },
    markers: new Map([['app', { storageHash: args.markerHash ?? ORIGIN, invariants: [] }]]),
    inForce: args.inForce,
    ref,
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
      const recovery = `Migrations on disk already lead from the database to \`${TARGET}\`, so a migration planned now would be a second path between the same two contracts, and \`db migrate\` applies only one of them. Apply them with \`{bin} db migrate --to ${TARGET}\`, which names the migration.ts to change if one of them fails.`;
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
        `No migration can be planned to move it. The database is already at \`${TARGET}\` and records every invariant it requires, so there is no migration to apply.`,
      );
    },
  );

  it('advises authoring a migration that provides the invariant for db update --to a ref whose invariant no migration on the path provides', () => {
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
      `Author a migration with \`{bin} migration plan --from ${ORIGIN} --to production\`, add to it a \`dataTransform\` with \`invariantId\` "seeded", run \`node <migration directory>/migration.ts\` for the directory it writes, and apply it with \`{bin} db migrate --to production\`.`,
    );
  });

  it('prints no migration plan when the database is at the ref contract and lacks an invariant no migration on disk provides', () => {
    const recovery = recoveryOf(
      check({
        command: 'db update',
        inForce: MIGRATE_ONLY,
        permitPolicyChange: true,
        graph: LEADS_TO_TARGET,
        markerHash: TARGET,
        ref: { name: 'production', hash: TARGET, invariants: ['seeded', 'indexed'] },
      }),
    );

    expect(recovery).not.toContain('migration plan');
    expect(recovery).toBe(
      `No migration can be planned to move it. The database is at \`production\`, but no migration on disk provides the invariants "indexed", "seeded" it requires and the database does not record, and a plan from a contract to itself is empty. Write a migration from that contract to itself with \`{bin} migration new --from ${TARGET}\`, add to its migration.ts a \`dataTransform\` for each of the invariants "indexed", "seeded", with that invariant as its \`invariantId\`, run \`node <migration directory>/migration.ts\` for its directory, and apply it with \`{bin} db migrate --to production --permit-policy-change\`.`,
    );
  });

  it('names no migration new command when the emitted contract is not the one the database is at', () => {
    const recovery = recoveryOf(
      check({
        command: 'db update',
        inForce: MIGRATE_ONLY,
        permitPolicyChange: false,
        graph: LEADS_TO_TARGET,
        markerHash: ORIGIN,
        ref: { name: 'staging', hash: ORIGIN, invariants: ['seeded'] },
      }),
    );

    expect(recovery).toContain(
      'Write a migration from that contract to itself, add to its migration.ts a `dataTransform` with `invariantId` "seeded",',
    );
    expect(recovery).not.toContain('migration new');
  });

  it('advises db migrate when the database is at the ref contract but lacks an invariant a migration on disk provides', () => {
    const seeds = { ...entry(TARGET, TARGET, 'm3'), invariants: ['seeded'] };
    expect(
      recoveryOf(
        check({
          command: 'db update',
          inForce: MIGRATE_ONLY,
          permitPolicyChange: false,
          graph: buildGraph([...LEADS_TO_TARGET.migrationByHash.values(), seeds]),
          markerHash: TARGET,
          ref: { name: 'production', hash: TARGET, invariants: ['seeded'] },
        }),
      ),
    ).toBe(
      'Migrations on disk already lead from the database to `production`, so a migration planned now would be a second path between the same two contracts, and `db migrate` applies only one of them. Apply them with `{bin} db migrate --to production`, which names the migration.ts to change if one of them fails.',
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
