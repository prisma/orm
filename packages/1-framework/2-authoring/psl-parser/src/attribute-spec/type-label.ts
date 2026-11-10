import type { AnyArgType, ArgType, AttributeCtx } from './types';

/** How a union's alternatives are joined in its label. */
export const UNION_LABEL_SEPARATOR = ' | ';

/** Whether a type's label reads as a union of several labels. */
export function labelIsUnion(type: AnyArgType | ArgType<unknown, never>): boolean {
  return (type.kind === 'oneOf' || type.kind === 'dataTypeValue') && type.labelIsUnion;
}

/**
 * A type's label, parenthesized when the label lists a union's alternatives, so a suffix such
 * as `[]` or `?` applies to the whole union.
 */
export function groupedTypeLabel<Ctx extends AttributeCtx>(
  type: ArgType<unknown, Ctx> | ArgType<unknown, never>,
): string {
  return labelIsUnion(type) ? `(${type.label})` : type.label;
}
