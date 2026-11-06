/**
 * PSL building blocks both directions use: `contract infer` writes a database as PSL, and
 * `contract print` writes a contract as PSL. They carry no dialect knowledge; the target that owns
 * the dialect maps imports them.
 */

export {
  type ColumnTypeOf,
  type ColumnTypeReadsDefault,
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
  GeneratorCallRefusal,
  GeneratorCallsResult,
  PhaseCallText,
} from '../core/psl-build/generator-calls';
export { generatorCallsFor } from '../core/psl-build/generator-calls';
export {
  fewestArgumentsCall,
  type InferredTypeConstructor,
  type InferredTypeConstructors,
  inferredTypeConstructors,
  type PslTypeArgument,
  sameInNormalForm,
  type WrittenPslTypeCall,
  type WrittenTypeChoiceCall,
  writtenTypeChoiceCall,
} from '../core/psl-build/inferred-type-constructors';
export { toEnumMemberName } from '../core/psl-build/psl-names';
