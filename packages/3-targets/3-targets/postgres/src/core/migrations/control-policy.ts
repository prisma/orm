import type { Contract, ControlPolicy } from '@internal/contract/types';
import type {
  ControlPolicySubject,
  SqlPlannerConflict,
  SuppressionRecord,
} from '@internal/family-sql/control';
import type { SchemaDiffIssue } from '@internal/framework-components/control';
import { issueOutcome } from '@internal/framework-components/control';
import { entityAt, UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { type PostgresRole, ROLE_DEFAULT_CONTROL_POLICY } from '../postgres-role';
import { isPostgresSchema } from '../postgres-schema';
import { postgresNodeStorageCoordinate } from '../schema-ir/node-storage-coordinate';
import type { PostgresNamespaceSchemaNode } from '../schema-ir/postgres-namespace-schema-node';
import { PostgresTableSchemaNode } from '../schema-ir/postgres-table-schema-node';
import type { SqlSchemaDiffNode } from '../schema-ir/schema-node-kinds';
import { PostgresSchemaNodeKind } from '../schema-ir/schema-node-kinds';
import { issueColumnName } from './issue-planner';
import { columnNameOfCall, type PostgresOpFactoryCall } from './op-factory-call';

/**
 * Factory calls that create a whole, previously-absent top-level storage
 * object. Used to decide whether `tolerated` permits a call (it only allows
 * creating absent objects, never modifying existing ones).
 *
 * Deliberately an explicit, closed set rather than a `factoryName`
 * create/alter/drop classification: it answers exactly one yes/no question
 * and is fail-closed. Any call not listed here — including future or
 * extension-contributed factories — is treated as NOT object-creation, so it
 * is suppressed under `tolerated` rather than permissively emitted.
 *
 * Lists the creation factories that actually reach the call-side resolver
 * (`resolvePostgresCallControlPolicySubject`) — today only RLS policy
 * creation, from `planPostgresSchemaDiff`. Every other whole-object create
 * (table, schema, native enum, and RLS enablement) is constructed inside
 * `planIssues` and graded on the node side by
 * `resolvePostgresNodeIssueCreationFactoryName`, so none of them are listed
 * here.
 */
const OBJECT_CREATION_FACTORIES: ReadonlySet<string> = new Set<string>(['createRlsPolicy']);

function createsNewTopLevelObject(call: PostgresOpFactoryCall): boolean {
  return OBJECT_CREATION_FACTORIES.has(call.factoryName);
}

function ddlSchemaNameForNamespace(contract: Contract<SqlStorage>, namespaceId: string): string {
  const namespace = contract.storage.namespaces[namespaceId];
  return isPostgresSchema(namespace) ? namespace.ddlSchemaName(contract.storage) : namespaceId;
}

/**
 * Resolve the namespace a declared storage entity lives in by walking every
 * namespace for one whose `entries` map actually contains the coordinate —
 * a table by its name, a native enum by its physical type name (see
 * {@link postgresNodeStorageCoordinate}). When `ddlSchemaName` is given, the
 * match must also land in that DDL schema (disambiguates same-named entities
 * declared under different namespaces); when omitted, the first namespace
 * that declares the entity wins. Falls back to {@link UNBOUND_NAMESPACE_ID}
 * when no namespace declares it — e.g. an extra/dropped entity the contract
 * doesn't claim at all.
 */
function resolveNamespaceIdForEntity(
  contract: Contract<SqlStorage>,
  coordinate: { readonly entityKind: string; readonly entityName: string },
  ddlSchemaName: string | undefined,
): string {
  for (const namespaceId of Object.keys(contract.storage.namespaces)) {
    const entity = entityAt(contract.storage, { namespaceId, ...coordinate });
    if (!entity) continue;
    if (
      ddlSchemaName === undefined ||
      ddlSchemaNameForNamespace(contract, namespaceId) === ddlSchemaName
    ) {
      return namespaceId;
    }
  }
  return UNBOUND_NAMESPACE_ID;
}

function resolveNamespaceIdForTable(
  contract: Contract<SqlStorage>,
  tableName: string,
  ddlSchemaName: string | undefined,
): string {
  return resolveNamespaceIdForEntity(
    contract,
    { entityKind: 'table', entityName: tableName },
    ddlSchemaName,
  );
}

export function resolveNamespaceIdForDdlSchema(
  contract: Contract<SqlStorage>,
  ddlSchemaName: string,
): string {
  for (const namespaceId of Object.keys(contract.storage.namespaces)) {
    const ns = contract.storage.namespaces[namespaceId];
    if (isPostgresSchema(ns) && ns.ddlSchemaName(contract.storage) === ddlSchemaName) {
      return namespaceId;
    }
    if (namespaceId === ddlSchemaName) {
      return namespaceId;
    }
  }
  return UNBOUND_NAMESPACE_ID;
}

interface PostgresCallFields {
  readonly schemaName?: string;
  readonly tableName?: string;
  readonly columnName?: string;
}

function postgresCallFields(call: PostgresOpFactoryCall): PostgresCallFields {
  return {
    ...ifDefined('schemaName', 'schemaName' in call ? call.schemaName : undefined),
    ...ifDefined('tableName', 'tableName' in call ? call.tableName : undefined),
    ...ifDefined('columnName', columnNameOfCall(call)),
  };
}

function formatSuppressionSubjectLabel(
  subject: ControlPolicySubject | undefined,
  contract: Contract<SqlStorage>,
): string {
  if (subject === undefined) return 'unknown';
  const ddlSchema = ddlSchemaNameForNamespace(contract, subject.namespaceId);
  if (subject.entityKind !== undefined && subject.entityName !== undefined) {
    const entityLabel = `${subject.entityKind} "${ddlSchema}.${subject.entityName}"`;
    return subject.rlsPolicy !== undefined
      ? `RLS policy "${subject.rlsPolicy}" on ${entityLabel}`
      : entityLabel;
  }
  return `namespace "${ddlSchema}"`;
}

function postgresSuppressionSummary(
  subjectLabel: string,
  subject: ControlPolicySubject | undefined,
  policy: string,
): string {
  const namespace = subject?.namespaceId ?? 'unknown';
  const declared = subject?.explicitNodeControlPolicy;
  if (policy === 'external' && declared === 'managed') {
    return `control policy suppressed: ${subjectLabel} — namespace '${namespace}' has effective control 'external' but declared 'managed'`;
  }
  const declaredSuffix = declared ? ` but declared '${declared}'` : '';
  return `control policy suppressed: ${subjectLabel} — namespace '${namespace}' has effective control '${policy}'${declaredSuffix}`;
}

/**
 * Render one family {@link SuppressionRecord} into a target `SqlPlannerConflict`.
 * The family decides *that* a subject is suppressed and hands over the raw
 * coordinate + policy; the label, message, and location are rendered here,
 * driven entirely by the subject's own `(entityKind, entityName)` coordinate
 * — no target-owned table-vs-enum vocabulary.
 */
export function renderPostgresSuppression(
  record: SuppressionRecord,
  contract: Contract<SqlStorage>,
): SqlPlannerConflict {
  const subject = record.subject;
  const subjectLabel = formatSuppressionSubjectLabel(subject, contract);
  return {
    kind: 'controlPolicySuppressedCall',
    summary: postgresSuppressionSummary(subjectLabel, subject, record.policy),
    location: {
      ...ifDefined('namespaceId', subject?.namespaceId),
      ...ifDefined('entityKind', subject?.entityKind),
      ...ifDefined('entityName', subject?.entityName),
      ...ifDefined('column', subject?.column),
      ...ifDefined('rlsPolicy', subject?.rlsPolicy),
    },
    meta: {
      controlPolicy: record.policy,
      ...ifDefined('factoryName', record.factoryName),
      ...ifDefined('rlsPolicy', subject?.rlsPolicy),
      ...ifDefined('declaredControlPolicy', subject?.explicitNodeControlPolicy),
    },
  };
}

export function resolvePostgresCallControlPolicySubject(
  call: PostgresOpFactoryCall,
  contract: Contract<SqlStorage>,
): ControlPolicySubject | undefined {
  const callFields = postgresCallFields(call);
  const createsNewObject = createsNewTopLevelObject(call);

  if (call.factoryName === 'createSchema' && callFields.schemaName) {
    return {
      namespaceId: resolveNamespaceIdForDdlSchema(contract, callFields.schemaName),
      createsNewObject,
    };
  }

  if (callFields.tableName) {
    const namespaceId = resolveNamespaceIdForTable(
      contract,
      callFields.tableName,
      callFields.schemaName,
    );
    const tableControlPolicy = entityAt<StorageTable>(contract.storage, {
      namespaceId,
      entityKind: 'table',
      entityName: callFields.tableName,
    })?.control;
    return {
      namespaceId,
      entityKind: 'table',
      entityName: callFields.tableName,
      ...ifDefined('column', callFields.columnName),
      ...ifDefined('explicitNodeControlPolicy', tableControlPolicy),
      createsNewObject,
    };
  }

  if (callFields.schemaName) {
    return {
      namespaceId: resolveNamespaceIdForDdlSchema(contract, callFields.schemaName),
      createsNewObject,
    };
  }

  return undefined;
}

/**
 * Node kinds whose *absence* is the creation of a whole, top-level Postgres
 * object: a namespace, a table, or a native enum. Used by
 * {@link resolvePostgresNodeIssueCreationFactoryName} to decide whether a
 * `tolerated` subject permits the issue to flow into the planner
 * (create-if-absent) and to seed the suppressed-subject warning's
 * `factoryName` when the planner is skipped. RLS policy creation is not
 * listed here — policy issues never reach this issue-based partition (they
 * are routed to `planPostgresSchemaDiff` and gated via the call-based
 * {@link resolvePostgresCallControlPolicySubject} instead).
 */
const POSTGRES_NODE_CREATION_FACTORY: Readonly<Record<string, string>> = Object.freeze({
  [PostgresSchemaNodeKind.namespace]: 'createSchema',
  [PostgresSchemaNodeKind.table]: 'createTable',
  [PostgresSchemaNodeKind.nativeEnum]: 'createNativeEnumType',
});

/**
 * A table `not-equal` issue whose `rlsEnabled` flips OFF→ON (expected on,
 * actual off) is enablement toward `ENABLE ROW LEVEL SECURITY`. It is
 * creation-class on the node side because `isEnablementCreationIssue` and
 * {@link resolvePostgresNodeIssueCreationFactoryName} treat this OFF→ON delta
 * as a creation: enabling RLS establishes the fail-closed guard the declared
 * policy set attaches to, the same grant `tolerated` extends to creating the
 * policies themselves. The opposite direction (`DISABLE`) is a modification
 * and stays managed-only. Keying on the actual delta (not just the expected
 * bit) keeps this correct if a second table attribute ever joins
 * `isEqualTo`: a not-equal with no `rlsEnabled` delta is not enablement, so
 * it is not admitted as creation-class here.
 */
function isEnablementCreationIssue(issue: SchemaDiffIssue<SqlSchemaDiffNode>): boolean {
  if (issueOutcome(issue) !== 'not-equal') return false;
  const { expected, actual } = issue;
  return (
    expected !== undefined &&
    actual !== undefined &&
    PostgresTableSchemaNode.is(expected) &&
    PostgresTableSchemaNode.is(actual) &&
    expected.rlsEnabled === true &&
    actual.rlsEnabled === false
  );
}

export function resolvePostgresNodeIssueCreationFactoryName(
  issue: SchemaDiffIssue<SqlSchemaDiffNode>,
): string | undefined {
  if (isEnablementCreationIssue(issue)) {
    return 'enableRowLevelSecurity';
  }
  if (issueOutcome(issue) !== 'not-found') return undefined;
  const node = issue.expected ?? issue.actual;
  if (node === undefined) return undefined;
  return POSTGRES_NODE_CREATION_FACTORY[node.nodeKind];
}

/**
 * Resolves the control-policy subject for a node-typed {@link SchemaDiffIssue}
 * (the issue-side mirror of `resolvePostgresCallControlPolicySubject`).
 * Storage entities resolve off their node coordinate; a sub-entity issue
 * resolves off the enclosing table read from the issue path; an unclaimed
 * extra falls back to the unbound coordinate. A role always resolves
 * `'external'` — roles are referenced, never owned.
 */
export function resolvePostgresNodeIssueControlPolicySubject(
  issue: SchemaDiffIssue<SqlSchemaDiffNode>,
  contract: Contract<SqlStorage>,
): ControlPolicySubject | undefined {
  const node = issue.expected ?? issue.actual;
  if (node === undefined) return undefined;

  if (node.nodeKind === PostgresSchemaNodeKind.namespace) {
    const namespaceNode = blindCast<
      PostgresNamespaceSchemaNode,
      'a postgres-namespace diff node is always a PostgresNamespaceSchemaNode'
    >(node);
    return {
      namespaceId: resolveNamespaceIdForDdlSchema(contract, namespaceNode.schemaName),
      createsNewObject: issueOutcome(issue) === 'not-found',
    };
  }

  if (node.nodeKind === PostgresSchemaNodeKind.role) {
    const roleName = issue.path[1];
    const roleEntity =
      roleName === undefined
        ? undefined
        : entityAt<PostgresRole>(contract.storage, {
            namespaceId: UNBOUND_NAMESPACE_ID,
            entityKind: 'role',
            entityName: roleName,
          });
    return {
      namespaceId: UNBOUND_NAMESPACE_ID,
      explicitNodeControlPolicy: roleEntity?.control ?? ROLE_DEFAULT_CONTROL_POLICY,
      createsNewObject: false,
    };
  }

  const coordinate = postgresNodeStorageCoordinate(node);
  if (coordinate !== undefined) {
    const namespaceId = resolveNamespaceIdForEntity(contract, coordinate, issue.path[1]);
    const entityControl = entityAt<{ readonly control?: ControlPolicy }>(contract.storage, {
      namespaceId,
      ...coordinate,
    })?.control;
    return {
      namespaceId,
      ...coordinate,
      ...ifDefined('column', issueColumnName(issue)),
      ...ifDefined('explicitNodeControlPolicy', entityControl),
      createsNewObject: resolvePostgresNodeIssueCreationFactoryName(issue) !== undefined,
    };
  }

  const tableName = issue.path[2];
  if (tableName === undefined) return undefined;
  const ddlSchemaName = issue.path[1];
  const namespaceId = resolveNamespaceIdForTable(contract, tableName, ddlSchemaName);
  const table = entityAt<StorageTable>(contract.storage, {
    namespaceId,
    entityKind: 'table',
    entityName: tableName,
  });

  return {
    namespaceId,
    entityKind: 'table',
    entityName: tableName,
    ...ifDefined('column', issueColumnName(issue)),
    ...ifDefined('explicitNodeControlPolicy', table?.control),
    createsNewObject: resolvePostgresNodeIssueCreationFactoryName(issue) !== undefined,
  };
}
