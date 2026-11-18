import type {
  ExecutionMutationDefault,
  ExecutionMutationDefaultPhases,
  ExecutionMutationDefaultValue,
} from '@internal/contract/types';
import type { GeneratorFunctionRegistry } from '@internal/framework-components/components';
import { canonicalStringify } from '@internal/utils/canonical-stringify';
import { storedNameOf } from './build-models';
import {
  type BuildRefusal,
  type FieldKey,
  modelFieldKey,
  valueObjectFieldKey,
} from './build-refusals';
import type { FieldNode, ModelNode, ValueObjectNode } from './contract-definition';

const PHASES = ['onCreate', 'onUpdate'] as const;

function hasExecutionDefaults(field: FieldNode): boolean {
  const phases = field.executionDefaults;
  const calls = field.generatorCalls;
  const values = field.generatedValues;
  return (
    phases?.onCreate !== undefined ||
    phases?.onUpdate !== undefined ||
    values?.onCreate !== undefined ||
    values?.onUpdate !== undefined ||
    calls?.onCreate !== undefined ||
    calls?.onUpdate !== undefined
  );
}

/**
 * The phases a field generates: its resolved execution defaults, with the generators its calls resolve to for its codec. Undefined when a call is refused.
 */
function executionDefaultsOf(
  field: FieldNode,
  key: FieldKey,
  generatorFunctions: GeneratorFunctionRegistry,
  refusals: BuildRefusal[],
): ExecutionMutationDefaultPhases | undefined {
  const typeGiven = field.executionDefaults;
  let refused = false;
  for (const phase of PHASES) {
    if (typeGiven?.[phase] !== undefined && field.generatedValues?.[phase] !== undefined) {
      refusals.push({ kind: 'generatorPhaseSetTwice', key, phase });
      refused = true;
    }
  }
  const written = { ...typeGiven, ...field.generatedValues };
  const calls = field.generatorCalls;
  if (calls === undefined) return refused ? undefined : written;
  const type = field.type;
  const codecId = type.kind === 'scalar' ? type.codecId : undefined;
  const phases: {
    onCreate?: ExecutionMutationDefaultValue;
    onUpdate?: ExecutionMutationDefaultValue;
  } = written;
  for (const phase of PHASES) {
    const call = calls[phase];
    if (call === undefined) continue;
    if (written[phase] !== undefined) {
      refusals.push({ kind: 'generatorPhaseSetTwice', key, phase });
      refused = true;
      continue;
    }
    const resolution =
      type.kind === 'scalar'
        ? generatorFunctions.resolve(call, {
            codecId: type.codecId,
            typeParams: type.typeParams,
            length: undefined,
          })
        : undefined;
    if (resolution?.ok === true) {
      phases[phase] = resolution.generator;
      continue;
    }
    refused = true;
    refusals.push(
      resolution?.reason === 'unknown-function'
        ? { kind: 'generatorUnknown', key, phase, functionName: call.name, codecId }
        : {
            kind: 'generatorNotApplicable',
            key,
            phase,
            functionName: call.name,
            codecId,
            message: resolution?.reason === 'refused' ? resolution.message : undefined,
          },
    );
  }
  return refused ? undefined : phases;
}

export function checkValueObjectExecutionDefaults(
  valueObjects: readonly ValueObjectNode[] | undefined,
  refusals: BuildRefusal[],
): void {
  for (const valueObject of valueObjects ?? []) {
    for (const field of valueObject.fields) {
      if (hasExecutionDefaults(field)) {
        refusals.push({
          kind: 'generatedOnValueObject',
          key: valueObjectFieldKey(valueObject.name, field.fieldName),
        });
      }
    }
  }
}

export function buildExecutionDefaults(input: {
  readonly models: readonly ModelNode[];
  readonly generatorFunctions: GeneratorFunctionRegistry;
  readonly namespaceId: string;
  readonly refusals: BuildRefusal[];
}): ExecutionMutationDefault[] {
  const { models, generatorFunctions, namespaceId, refusals } = input;
  const collectionByModelName = new Map(models.map((model) => [model.modelName, model.collection]));
  const byRef = new Map<
    string,
    { readonly modelName: string; readonly fieldName: string; readonly phasesKey: string }
  >();
  const defaults: ExecutionMutationDefault[] = [];
  for (const model of models) {
    const { modelName } = model;
    for (const field of model.fields) {
      if (!hasExecutionDefaults(field)) continue;
      const { fieldName } = field;
      const key = modelFieldKey(modelName, fieldName);
      const phases = executionDefaultsOf(field, key, generatorFunctions, refusals);
      if (phases === undefined) continue;
      if (field.many) {
        refusals.push({ kind: 'generatedList', key });
        continue;
      }
      if (model.base !== undefined) {
        refusals.push({
          kind: 'generatedOnVariant',
          key,
          baseModel: model.base.model,
          collection: model.collection ?? collectionByModelName.get(model.base.model),
        });
        continue;
      }
      const entry = model.collection;
      if (entry === undefined) {
        refusals.push({ kind: 'generatedWithoutCollection', key });
        continue;
      }
      const storedName = storedNameOf(field);
      const refKey = JSON.stringify([entry, storedName]);
      const phasesKey = canonicalStringify(phases);
      const existing = byRef.get(refKey);
      if (existing !== undefined) {
        if (existing.phasesKey !== phasesKey) {
          refusals.push({
            kind: 'generatedConflict',
            key,
            otherModel: existing.modelName,
            otherField: existing.fieldName,
            collection: entry,
          });
        }
        continue;
      }
      byRef.set(refKey, { modelName, fieldName, phasesKey });
      defaults.push({ ref: { namespace: namespaceId, entry, field: storedName }, ...phases });
    }
  }
  return defaults;
}
