import type { PslExtensionBlock } from '@internal/framework-components/psl-ast';
import { escapePslString } from '@internal/sql-relational-core/ast';
import { formatWireName } from '@internal/sql-schema-ir/naming';
import { POLICY_BLOCK_KEYWORDS } from '../authoring';
import { PostgresRlsEnablement } from '../postgres-rls-enablement';
import { PostgresRlsPolicy } from '../postgres-rls-policy';
import { PostgresRole } from '../postgres-role';
import { SYNTHETIC_SPAN } from '../psl-ast/psl-literals';
import { computeContentHash } from '../rls/canonicalize';
import {
  refuseEntryFiledUnderAnotherName,
  refuseEntryInOtherNamespace,
  refuseInvalidEntry,
  refuseNonIdentifier,
  refusePolicyNameNotDerived,
  refusePolicyWithoutModel,
  refusePolicyWithoutRls,
  refuseRoleOutsideUnbound,
} from './refusals';

/**
 * The storage tables of one namespace that have row-level security enabled,
 * each written as `@@rls` on its model. The PSL source files each one under
 * its table name, in the namespace of its model.
 */
export function rlsEnabledTables(
  namespaceId: string,
  entries: Readonly<Record<string, unknown>> | undefined,
): ReadonlySet<string> {
  const tables = new Set<string>();
  for (const [name, entity] of Object.entries(entries ?? {})) {
    if (!(entity instanceof PostgresRlsEnablement)) refuseInvalidEntry(namespaceId, 'rls', name);
    refuseEntryInOtherNamespace({
      namespaceId,
      kind: 'rls',
      name,
      recordedNamespaceId: entity.namespaceId,
    });
    refuseEntryFiledUnderAnotherName({
      namespaceId,
      kind: 'rls',
      name,
      readsBackAs: entity.tableName,
    });
    tables.add(entity.tableName);
  }
  return tables;
}

/**
 * One `role <name> {}` block per role. The PSL source reads a role block only
 * inside `namespace unbound`, and files it under its name.
 */
export function buildRoleBlocks(
  namespaceId: string,
  entries: Readonly<Record<string, unknown>> | undefined,
): readonly PslExtensionBlock[] {
  return Object.entries(entries ?? {}).map(([name, entity]): PslExtensionBlock => {
    if (!(entity instanceof PostgresRole)) refuseInvalidEntry(namespaceId, 'role', name);
    refuseRoleOutsideUnbound(namespaceId, name);
    refuseEntryInOtherNamespace({
      namespaceId,
      kind: 'role',
      name,
      recordedNamespaceId: entity.namespaceId,
    });
    refuseEntryFiledUnderAnotherName({ namespaceId, kind: 'role', name, readsBackAs: entity.name });
    refuseNonIdentifier('role', entity.name);
    return {
      kind: 'role',
      keyword: 'role',
      name: entity.name,
      parameters: {},
      blockAttributes: [],
      attributes: {},
      span: SYNTHETIC_SPAN,
    };
  });
}

/**
 * Whether the PSL source, reading a policy block named `head`, derives this
 * policy's name: the block name with the hash of the policy's content for a
 * wire-named policy, or the `@@map` name for an exact one.
 */
function policyNameReadsBack(head: string, policy: PostgresRlsPolicy): boolean {
  if (policy.prefix === undefined) return true;
  const hash = computeContentHash({
    ...(policy.using === undefined ? {} : { using: policy.using }),
    ...(policy.withCheck === undefined ? {} : { withCheck: policy.withCheck }),
    roles: policy.roles,
    operation: policy.operation,
    permissive: policy.permissive,
  });
  return policy.prefix === head && policy.name === formatWireName(head, hash);
}

/**
 * One `policy_<operation>` block per policy, named by its entry key, which is
 * the block head it was authored under. A policy with an exact name also
 * prints `@@map` with that name.
 */
export function buildPolicyBlocks(input: {
  readonly namespaceId: string;
  readonly entries: Readonly<Record<string, unknown>> | undefined;
  readonly modelNameForTable: (tableName: string) => string | undefined;
  readonly rlsTables: ReadonlySet<string>;
}): readonly PslExtensionBlock[] {
  return Object.entries(input.entries ?? {}).map(([head, policy]): PslExtensionBlock => {
    if (!(policy instanceof PostgresRlsPolicy))
      refuseInvalidEntry(input.namespaceId, 'policy', head);
    refuseNonIdentifier('policy', head);
    refuseEntryInOtherNamespace({
      namespaceId: input.namespaceId,
      kind: 'policy',
      name: head,
      recordedNamespaceId: policy.namespaceId,
    });
    const modelName = input.modelNameForTable(policy.tableName);
    if (modelName === undefined) refusePolicyWithoutModel(policy);
    if (!input.rlsTables.has(policy.tableName)) refusePolicyWithoutRls(policy);
    if (!policyNameReadsBack(head, policy)) refusePolicyNameNotDerived(policy);
    for (const role of policy.roles) refuseNonIdentifier('role', role);

    return {
      kind: 'policy',
      keyword: POLICY_BLOCK_KEYWORDS[policy.operation],
      name: head,
      parameters: {
        target: { kind: 'ref', identifier: modelName, span: SYNTHETIC_SPAN },
        roles: {
          kind: 'list',
          items: policy.roles.map((role) => ({
            kind: 'ref',
            identifier: role,
            span: SYNTHETIC_SPAN,
          })),
          span: SYNTHETIC_SPAN,
        },
        ...(policy.using !== undefined
          ? {
              using: {
                kind: 'value',
                raw: JSON.stringify(policy.using),
                span: SYNTHETIC_SPAN,
              },
            }
          : {}),
        ...(policy.withCheck !== undefined
          ? {
              withCheck: {
                kind: 'value',
                raw: JSON.stringify(policy.withCheck),
                span: SYNTHETIC_SPAN,
              },
            }
          : {}),
        ...(policy.permissive
          ? {}
          : { permissive: { kind: 'value', raw: 'false', span: SYNTHETIC_SPAN } }),
      },
      blockAttributes:
        policy.prefix === undefined
          ? [
              {
                name: 'map',
                args: [
                  {
                    kind: 'positional',
                    value: `"${escapePslString(policy.name)}"`,
                    span: SYNTHETIC_SPAN,
                  },
                ],
                span: SYNTHETIC_SPAN,
              },
            ]
          : [],
      attributes:
        policy.prefix === undefined
          ? { map: { args: { name: policy.name }, span: SYNTHETIC_SPAN } }
          : {},
      span: SYNTHETIC_SPAN,
    };
  });
}
