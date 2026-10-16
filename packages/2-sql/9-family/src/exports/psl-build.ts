/**
 * PSL building blocks both directions use: `contract infer` writes a database as PSL, and
 * `contract print` writes a contract as PSL. They carry no dialect knowledge; the target that owns
 * the dialect maps imports them.
 */

export {
  type ColumnTypeOf,
  type IntrospectedTable,
  inferColumnTypes,
  type PslTypeCall,
} from '../core/psl-build/column-types';
export type {
  DefaultMappingOptions,
  DefaultMappingResult,
} from '../core/psl-build/default-mapping';
export { mapDefault } from '../core/psl-build/default-mapping';
export type {
  FieldPresetArgument,
  FieldPresetCallChoice,
  FieldPresetReadBackDifference,
  FieldPresetUnwritableReason,
  PslColumnTypeKind,
  PslColumnTypeRef,
} from '../core/psl-build/generated-values';
export { defaultFunctionCallFor, fieldPresetCallFor } from '../core/psl-build/generated-values';
export {
  fewestArgumentsCall,
  type InferredTypeConstructor,
  type InferredTypeConstructors,
  inferredTypeConstructors,
  pslTypeArgumentText,
} from '../core/psl-build/inferred-type-constructors';
export { toEnumMemberName } from '../core/psl-build/psl-names';
