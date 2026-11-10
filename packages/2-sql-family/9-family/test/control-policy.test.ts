import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage, type StorageTableInput } from '@internal/sql-contract/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../1-core/contract/test/test-support';
import {
  type ControlPolicySubject,
  partitionCallsByControlPolicy,
  partitionIssuesByControlPolicy,
} from '../src/core/migrations/control-policy';

function makeContract(
  tables: Record<string, StorageTableInput>,
  defaultControlPolicy?: Contract<SqlStorage>['defaultControlPolicy'],
): Contract<SqlStorage> {
  const storage = new SqlStorage({
    storageHash: coreHash('test'),
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: createTestSqlNamespace({
        id: UNBOUND_NAMESPACE_ID,
        entries: { table: tables },
      }),
    },
  });
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('test'),
    storage,
    domain: applicationDomainOf({ models: {} }),
    roots: {},
    capabilities: {},
    extensions: {},
    meta: {},
    ...(defaultControlPolicy !== undefined ? { defaultControlPolicy } : {}),
  };
}

interface FakeCall {
  readonly name: string;
  readonly subject: ControlPolicySubject | undefined;
}

function call(name: string, subject: ControlPolicySubject | undefined): FakeCall {
  return { name, subject };
}

function tableSubject(
  policy: ControlPolicySubject['explicitNodeControlPolicy'] | undefined,
  createsNewObject: boolean,
): ControlPolicySubject {
  return {
    namespaceId: UNBOUND_NAMESPACE_ID,
    entityKind: 'table',
    entityName: 'users',
    createsNewObject,
    ...(policy !== undefined ? { explicitNodeControlPolicy: policy } : {}),
  };
}

const tableInput: StorageTableInput = { columns: {}, uniques: [], indexes: [], foreignKeys: [] };

describe('partitionCallsByControlPolicy', () => {
  it('returns a structured SuppressionRecord for a managed override under external default', () => {
    const externalDefault = makeContract(
      { users: { control: 'managed', ...tableInput } },
      'external',
    );
    const { kept, suppressions } = partitionCallsByControlPolicy({
      calls: [call('createTable', tableSubject('managed', true))],
      contract: externalDefault,
      resolveControlPolicySubject: (c) => c.subject,
      resolveFactoryName: (c) => c.name,
    });
    expect(kept).toHaveLength(0);
    expect(suppressions).toHaveLength(1);
    // Raw structured data only — no rendered strings or table/type vocabulary.
    expect(suppressions[0]).toEqual({
      subject: {
        namespaceId: UNBOUND_NAMESPACE_ID,
        entityKind: 'table',
        entityName: 'users',
        explicitNodeControlPolicy: 'managed',
        createsNewObject: true,
      },
      policy: 'external',
      factoryName: 'createTable',
      createsNewObject: true,
    });
  });
});

// Mirror of the call-side `partitionCallsByControlPolicy` test surface, but
// exercising the input-side issue-partitioning entry point the SQL family
// planner pipeline uses. Each test pins "this subject's issues never reach the
// planner; this SuppressionRecord is emitted instead".
interface FakeIssue {
  readonly kind: 'missing_table' | 'extra_table' | 'type_mismatch' | 'missing_column';
  readonly subject: ControlPolicySubject | undefined;
  /** `'createTable'` for `missing_table`-style issues; `undefined` otherwise. */
  readonly creationFactoryName: string | undefined;
}

function issue(
  kind: FakeIssue['kind'],
  subject: ControlPolicySubject | undefined,
  creationFactoryName: string | undefined,
): FakeIssue {
  return { kind, subject, creationFactoryName };
}

function partitionFake(issues: readonly FakeIssue[], contract: Contract<SqlStorage>) {
  return partitionIssuesByControlPolicy({
    issues,
    contract,
    resolveControlPolicySubject: (i) => i.subject,
    resolveCreationFactoryName: (i) => i.creationFactoryName,
  });
}

describe('partitionIssuesByControlPolicy', () => {
  describe('managed', () => {
    const contract = makeContract({ users: { control: 'managed', ...tableInput } });

    it('routes every issue into the plannable partition, creation or modification', () => {
      const { plannable, suppressions } = partitionFake(
        [
          issue('missing_table', tableSubject('managed', true), 'createTable'),
          issue('extra_table', tableSubject('managed', false), undefined),
          issue('type_mismatch', tableSubject('managed', false), undefined),
        ],
        contract,
      );
      expect(plannable).toHaveLength(3);
      expect(suppressions).toHaveLength(0);
    });
  });

  describe('tolerated', () => {
    const contract = makeContract({ users: { control: 'tolerated', ...tableInput } });

    it('routes a whole-object creation into the plannable partition', () => {
      const { plannable, suppressions } = partitionFake(
        [issue('missing_table', tableSubject('tolerated', true), 'createTable')],
        contract,
      );
      expect(plannable.map((i) => i.kind)).toEqual(['missing_table']);
      expect(suppressions).toHaveLength(0);
    });

    it('suppresses non-creation issues and consolidates to one record per subject with no verb', () => {
      const { plannable, suppressions } = partitionFake(
        [
          issue('missing_column', tableSubject('tolerated', false), undefined),
          issue('type_mismatch', tableSubject('tolerated', false), undefined),
        ],
        contract,
      );
      expect(plannable).toHaveLength(0);
      expect(suppressions).toHaveLength(1);
      expect(suppressions[0]?.policy).toBe('tolerated');
      // No creation issue → the family invents no modification verb.
      expect(suppressions[0]?.factoryName).toBeUndefined();
      expect(suppressions[0]?.subject).toMatchObject({ entityKind: 'table', entityName: 'users' });
    });
  });

  describe('external and observed subjects never reach the planner', () => {
    it('drops every issue for an external or observed node and emits one record per subject', () => {
      for (const policy of ['external', 'observed'] as const) {
        const contract = makeContract({ users: { control: policy, ...tableInput } });
        const { plannable, suppressions } = partitionFake(
          [
            issue('missing_table', tableSubject(policy, true), 'createTable'),
            issue('extra_table', tableSubject(policy, false), undefined),
            issue('type_mismatch', tableSubject(policy, false), undefined),
          ],
          contract,
        );
        expect(plannable).toHaveLength(0);
        expect(suppressions).toHaveLength(1);
        expect(suppressions[0]?.policy).toBe(policy);
        // A creation issue won the race, so the record carries the creation factory.
        expect(suppressions[0]?.factoryName).toBe('createTable');
      }
    });

    it('carries an undefined factoryName when no creation issue is present', () => {
      const contract = makeContract({ users: { control: 'external', ...tableInput } });
      const { suppressions } = partitionFake(
        [issue('type_mismatch', tableSubject('external', false), undefined)],
        contract,
      );
      expect(suppressions).toHaveLength(1);
      expect(suppressions[0]?.policy).toBe('external');
      expect(suppressions[0]?.factoryName).toBeUndefined();
    });
  });

  describe('external defaultControlPolicy floor', () => {
    const externalDefault = makeContract(
      { users: { control: 'managed', ...tableInput } },
      'external',
    );

    it('drops a managed-override missing-table issue and surfaces a suppression record', () => {
      const { plannable, suppressions } = partitionFake(
        [issue('missing_table', tableSubject('managed', true), 'createTable')],
        externalDefault,
      );
      expect(plannable).toHaveLength(0);
      expect(suppressions).toHaveLength(1);
      expect(suppressions[0]).toEqual({
        subject: {
          namespaceId: UNBOUND_NAMESPACE_ID,
          entityKind: 'table',
          entityName: 'users',
          explicitNodeControlPolicy: 'managed',
          createsNewObject: true,
        },
        policy: 'external',
        factoryName: 'createTable',
        createsNewObject: true,
      });
    });
  });
});
