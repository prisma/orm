import type { PslExtensionBlock } from '@internal/framework-components/psl-ast';
import { parseWireName } from '@internal/sql-schema-ir/naming';
import { assertDefined } from '@internal/utils/assertions';
import type { PostgresPolicySchemaNode } from '../schema-ir/postgres-policy-schema-node';
import { escapePslString, SYNTHETIC_SPAN } from './psl-literals';

const POLICY_OPERATION_KEYWORD = {
  select: 'policy_select',
  insert: 'policy_insert',
  update: 'policy_update',
  delete: 'policy_delete',
  all: 'policy_all',
} as const;

/** The PSL tokenizer's identifier grammar: leading letter/underscore, then letters/digits/`_`/`-`. */
const PSL_IDENTIFIER = /^[\p{L}_][\p{L}\p{N}_-]*$/u;

/** Replaces invalid character runs with `_`; prepends `_` when the first character is invalid. */
function sanitizePolicyHead(raw: string): string {
  let head = raw.replace(/[^\p{L}\p{N}_-]+/gu, '_');
  if (!/^[\p{L}_]/u.test(head)) {
    head = `_${head}`;
  }
  return head;
}

interface PolicyBlockEmission {
  readonly blocks: readonly PslExtensionBlock[];
  readonly skipNotesByTable: ReadonlyMap<string, readonly string[]>;
}

/**
 * Builds one `policy_<operation>` block per introspected policy. Every
 * adopted policy is exact-named: a reprinted body never reliably re-hashes to
 * the live suffix, so `@@map` always carries the physical name and the head
 * is only an identifier. A policy granting to a role whose name is not a
 * legal identifier cannot be authored at all — role references have no
 * `@@map` escape — so it is skipped with a note.
 */
export function buildPolicyBlocks(
  policiesByTable: ReadonlyMap<string, readonly PostgresPolicySchemaNode[]>,
  modelNameMap: ReadonlyMap<string, string>,
  reservedHeads: ReadonlySet<string> = new Set(),
): PolicyBlockEmission {
  const all: { readonly policy: PostgresPolicySchemaNode; readonly tableName: string }[] = [];
  for (const [tableName, policies] of policiesByTable) {
    for (const policy of policies) {
      all.push({ policy, tableName });
    }
  }
  // Total order: policy names are unique per TABLE, not per schema, so the
  // physical name alone cannot order two tables' identically-named policies.
  all.sort((a, b) => {
    if (a.policy.name !== b.policy.name) return a.policy.name < b.policy.name ? -1 : 1;
    if (a.tableName !== b.tableName) return a.tableName < b.tableName ? -1 : 1;
    return a.policy.operation < b.policy.operation
      ? -1
      : a.policy.operation > b.policy.operation
        ? 1
        : 0;
  });

  // Seeded with every block name already destined for the namespace (models,
  // native_enum blocks): a policy head colliding with any of them would emit
  // two same-named blocks, so it takes the numeric suffix instead.
  const usedHeads = new Set<string>(reservedHeads);
  const blocks: PslExtensionBlock[] = [];
  const skipNotesByTable = new Map<string, string[]>();
  for (const { policy, tableName } of all) {
    const modelName = modelNameMap.get(tableName);
    // Policies and models come from one introspection walk of one schema, so
    // a policy's table always has an emitted model — a miss is a walk bug,
    // never live data, and must not silently under-describe the database.
    assertDefined(
      modelName,
      `buildPolicyBlocks: policy "${policy.name}" targets table "${tableName}" with no emitted model; tables and policies come from the same introspection walk`,
    );

    const badRole = policy.roles.find((role) => !PSL_IDENTIFIER.test(role));
    if (badRole !== undefined) {
      const notes = skipNotesByTable.get(tableName) ?? [];
      notes.push(
        `// prisma-next: skipped policy "${policy.name}": role "${badRole}" is not a valid PSL identifier and role references cannot be escaped`,
      );
      skipNotesByTable.set(tableName, notes);
      continue;
    }

    let head = sanitizePolicyHead(parseWireName(policy.name)?.prefix ?? policy.name);
    if (usedHeads.has(head)) {
      let n = 2;
      while (usedHeads.has(`${head}_${n}`)) n += 1;
      head = `${head}_${n}`;
    }
    usedHeads.add(head);

    blocks.push({
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
      blockAttributes: [
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
      ],
      attributes: { map: { args: { name: policy.name }, span: SYNTHETIC_SPAN } },
      span: SYNTHETIC_SPAN,
    });
  }
  return { blocks, skipNotesByTable };
}
