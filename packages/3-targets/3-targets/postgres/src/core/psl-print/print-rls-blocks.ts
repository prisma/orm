import type { PslExtensionBlock } from '@internal/framework-components/psl-ast';
import { escapePslString } from '@internal/sql-relational-core/ast';
import { postgresError } from '../errors';
import { PostgresRlsEnablement } from '../postgres-rls-enablement';
import { PostgresRlsPolicy } from '../postgres-rls-policy';
import { PostgresRole } from '../postgres-role';
import { SYNTHETIC_SPAN } from '../psl-infer/psl-literals';

const POLICY_OPERATION_KEYWORD = {
  select: 'policy_select',
  insert: 'policy_insert',
  update: 'policy_update',
  delete: 'policy_delete',
  all: 'policy_all',
} as const;

/** The PSL tokenizer's identifier grammar: leading letter/underscore, then letters/digits/`_`/`-`. */
const PSL_IDENTIFIER = /^[\p{L}_][\p{L}\p{N}_-]*$/u;

function invalidEntry(namespaceId: string, kind: string, name: string): never {
  throw postgresError(
    'CONTRACT.PRINT_UNSUPPORTED',
    `contract print: namespace "${namespaceId}" has a "${kind}" entry "${name}" that is not a ${kind} entity.`,
    {
      why: 'The printer reads each storage entry through the entity class of its kind.',
      fix: 'Re-emit the contract from its source.',
      meta: { namespaceId, kind, name },
    },
  );
}

/** The storage tables of one namespace that have row-level security enabled, each written as `@@rls` on its model. */
export function rlsEnabledTables(
  namespaceId: string,
  entries: Readonly<Record<string, unknown>> | undefined,
): ReadonlySet<string> {
  const tables = new Set<string>();
  for (const [name, entity] of Object.entries(entries ?? {})) {
    if (!(entity instanceof PostgresRlsEnablement)) invalidEntry(namespaceId, 'rls', name);
    tables.add(entity.tableName);
  }
  return tables;
}

/** One `role <name> {}` block per role; they print inside `namespace unbound`. */
export function buildRoleBlocks(
  namespaceId: string,
  entries: Readonly<Record<string, unknown>> | undefined,
): readonly PslExtensionBlock[] {
  return Object.entries(entries ?? {}).map(([name, entity]): PslExtensionBlock => {
    if (!(entity instanceof PostgresRole)) invalidEntry(namespaceId, 'role', name);
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

function refuseUnwritablePolicy(policy: PostgresRlsPolicy, why: string, fix: string): never {
  throw postgresError(
    'CONTRACT.PRINT_UNSUPPORTED',
    `contract print: policy "${policy.name}" on "${policy.namespaceId}"."${policy.tableName}" cannot be written in Prisma 8 PSL.`,
    { why, fix, meta: { namespaceId: policy.namespaceId, table: policy.tableName } },
  );
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
}): readonly PslExtensionBlock[] {
  return Object.entries(input.entries ?? {}).map(([head, policy]): PslExtensionBlock => {
    if (!(policy instanceof PostgresRlsPolicy)) invalidEntry(input.namespaceId, 'policy', head);
    const modelName = input.modelNameForTable(policy.tableName);
    if (modelName === undefined) {
      refuseUnwritablePolicy(
        policy,
        'A policy block names its table through the model stored there, and no model is stored in this table.',
        'Declare a model for the table, or keep authoring this contract in its current source.',
      );
    }
    const badRole = policy.roles.find((role) => !PSL_IDENTIFIER.test(role));
    if (badRole !== undefined) {
      refuseUnwritablePolicy(
        policy,
        `A policy names its roles by identifier, and role "${badRole}" is not a PSL identifier.`,
        'Rename the role to a plain identifier, or keep authoring this contract in its current source.',
      );
    }

    return {
      kind: 'policy',
      keyword: POLICY_OPERATION_KEYWORD[policy.operation],
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
          ? { using: { kind: 'value', raw: JSON.stringify(policy.using), span: SYNTHETIC_SPAN } }
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
