/**
 * PSL building blocks both directions use: `contract infer` writes a database as PSL, and
 * `contract print` writes a contract as PSL. They carry no dialect knowledge; the target that owns
 * the dialect maps imports them.
 */

export type { DefaultMappingOptions, DefaultMappingResult } from '../core/psl-ast/default-mapping';
export { mapDefault } from '../core/psl-ast/default-mapping';
export { toEnumMemberName } from '../core/psl-ast/psl-names';
export type { PslTypeMap, PslTypeReference, PslTypeResolution } from '../core/psl-ast/type-map';
