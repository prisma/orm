import type {
  PslAttributeArgument,
  PslModelAttribute,
} from '@internal/framework-components/psl-ast';
import { escapePslString } from '@internal/sql-relational-core/ast';
import { computeIndexContentHash, parseWireName } from '@internal/sql-schema-ir/naming';
import { assertDefined } from '@internal/utils/assertions';
import { buildAttribute, namedArg, positionalArg } from './psl-literals';

export function buildModelConstraintAttribute(
  name: 'id' | 'unique',
  fields: readonly string[],
  constraintName?: string,
): PslModelAttribute {
  const args: PslAttributeArgument[] = [positionalArg(`[${fields.join(', ')}]`)];
  if (constraintName !== undefined) {
    args.push(namedArg('map', `"${escapePslString(constraintName)}"`));
  }
  return buildAttribute('model', name, args);
}

/**
 * The parts of an index `@@index` reads. Both the schema IR node and the
 * contract's storage node carry them, and both sides print indexes.
 */
export interface IndexAttributeSource {
  readonly name: string;
  readonly unique: boolean;
  readonly columns?: readonly string[];
  readonly expression?: string;
  readonly where?: string;
  readonly type?: string;
  readonly options?: Record<string, unknown>;
}

/** How an attribute names its object: `name:` with a wire prefix, or `map:` with the exact name. */
export type AttributeNaming =
  | { readonly kind: 'wire'; readonly prefix: string }
  | { readonly kind: 'exact' };

/**
 * The naming of a live index, re-detected rather than trusted: wire when the
 * live name parses as a wire name AND that hash recomputes from the
 * introspected content; otherwise exact.
 */
function detectIndexNaming(index: IndexAttributeSource): AttributeNaming {
  const parsed = parseWireName(index.name);
  const recomputed = computeIndexContentHash({
    ...(index.columns !== undefined ? { columns: index.columns } : {}),
    ...(index.expression !== undefined ? { expression: index.expression } : {}),
    ...(index.where !== undefined ? { where: index.where } : {}),
    unique: index.unique,
    ...(index.type !== undefined ? { type: index.type } : {}),
    ...(index.options !== undefined ? { options: index.options } : {}),
  });
  return parsed !== undefined && parsed.hash === recomputed
    ? { kind: 'wire', prefix: parsed.prefix }
    : { kind: 'exact' };
}

function namingArg(naming: AttributeNaming, exactName: string): PslAttributeArgument {
  return naming.kind === 'wire'
    ? namedArg('name', `"${escapePslString(naming.prefix)}"`)
    : namedArg('map', `"${escapePslString(exactName)}"`);
}

/**
 * Emits one `@@index` attribute at full fidelity, named as `naming` says;
 * without it, the naming is re-detected from the live name and content.
 */
export function buildIndexAttribute(
  index: IndexAttributeSource,
  fieldNames: readonly string[] | undefined,
  naming: AttributeNaming = detectIndexNaming(index),
): PslModelAttribute {
  const args: PslAttributeArgument[] = [];
  if (fieldNames !== undefined) {
    args.push(positionalArg(`[${fieldNames.join(', ')}]`));
  } else {
    assertDefined(
      index.expression,
      `buildIndexAttribute: index "${index.name}" carries neither columns nor expression; SqlIndexIR enforces exactly one`,
    );
    args.push(namedArg('expression', `"${escapePslString(index.expression)}"`));
  }

  args.push(namingArg(naming, index.name));

  if (index.where !== undefined) {
    args.push(namedArg('where', `"${escapePslString(index.where)}"`));
  }
  if (index.unique) {
    args.push(namedArg('unique', 'true'));
  }
  if (index.type !== undefined || index.options !== undefined) {
    args.push(namedArg('type', `"${escapePslString(index.type ?? 'btree')}"`));
  }
  if (index.options !== undefined) {
    const entries = Object.entries(index.options ?? {})
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, value]) => `${key}: "${escapePslString(String(value))}"`);
    args.push(namedArg('options', `{ ${entries.join(', ')} }`));
  }
  return buildAttribute('model', 'index', args);
}

/**
 * The parts of a check constraint `@@check` reads. Both the schema IR node and
 * the contract's storage node carry them, and both sides print checks.
 */
export interface CheckAttributeSource {
  readonly name: string;
  readonly expression: string;
}

/**
 * Emits one `@@check` attribute, named as `naming` says. Without it, a live,
 * non-derived check is written in the `map:` form. Re-detecting `name:` is not
 * attempted there: the live expression is Postgres's own reprint, but a
 * wire-named check's hash was taken over the author's original text, so
 * recomputing the hash from the reprint would essentially never match. `map:`
 * plus the verbatim reprint is correct regardless — a reprint compared against
 * a later reprint of the same expression is stable, so the emitted contract
 * signs the live database with zero pending operations. `buildIntrospectedPolicyBlocks`
 * makes the same call for `@@map` on adopted RLS policies, for the same reason.
 */
export function buildCheckAttribute(
  check: CheckAttributeSource,
  naming: AttributeNaming = { kind: 'exact' },
): PslModelAttribute {
  return buildAttribute('model', 'check', [
    namedArg('expression', `"${escapePslString(check.expression)}"`),
    namingArg(naming, check.name),
  ]);
}
