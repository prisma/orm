export type {
  AggregateDescriptor,
  AggregateInputMatch,
  AggregateOutputCodec,
  AggregateResultNullability,
  AnyInputAggregateDescriptor,
  NamedAggregateOutput,
  NoInputAggregateDescriptor,
  SelfAggregateOutput,
  ValueInputAggregateDescriptor,
} from '../shared/aggregate-descriptor';
export {
  aggregateDescriptorKey,
  isAggregateDescriptor,
  isAnyInputAggregateDescriptor,
  isNoInputAggregateDescriptor,
} from '../shared/aggregate-descriptor';
export type {
  AggregateCodecTraits,
  AggregateOverloadAmbiguity,
  AggregateOverloadDuplicate,
  SettledAggregateOperation,
  SettledAggregateOverloads,
} from '../shared/aggregate-overloads';
export { settleAggregateOverloads } from '../shared/aggregate-overloads';
export type { CapabilityMatrix } from '../shared/capabilities';
export { mergeCapabilityMatrices } from '../shared/capabilities';
export type {
  AdapterDescriptor,
  AdapterInstance,
  AdapterPackRef,
  ComponentDescriptor,
  ComponentMetadata,
  ContractComponentRequirementsCheckInput,
  ContractComponentRequirementsCheckResult,
  DriverDescriptor,
  DriverInstance,
  DriverPackRef,
  ExtensionDescriptor,
  ExtensionInstance,
  ExtensionPackRef,
  FamilyDescriptor,
  FamilyInstance,
  FamilyPackRef,
  PackRefBase,
  SessionSettings,
  TargetBoundComponentDescriptor,
  TargetDescriptor,
  TargetInstance,
  TargetPackRef,
} from '../shared/framework-components';
export { checkContractComponentRequirements } from '../shared/framework-components';
export type {
  BindingResolution,
  GeneratorFunctionBinding,
  GeneratorFunctionCall,
  GeneratorFunctionComponent,
  GeneratorFunctionContribution,
  GeneratorFunctionField,
  GeneratorFunctionRegistry,
  GeneratorFunctionResolution,
  GeneratorFunctionSummary,
  GeneratorPhase,
  PrintedArguments,
  PrintedGeneratorCall,
} from '../shared/generator-functions';
export {
  assembleGeneratorFunctions,
  EMPTY_GENERATOR_FUNCTIONS,
  singleGeneratorBinding,
} from '../shared/generator-functions';
export type {
  ExtensionPackValues,
  GeneratorHelper,
  GeneratorHelpersOf,
  SignatureArgumentOutput,
  SignatureOptionalArgument,
} from '../shared/generator-helpers';
export { createGeneratorHelpers } from '../shared/generator-helpers';
export type { MutationDefaultGeneratorDescriptor } from '../shared/mutation-default-types';
export type { RuntimeErrorEnvelope } from '../shared/runtime-error';
export { isRuntimeError, runtimeError } from '../shared/runtime-error';
