import type { JsonValue } from '@internal/contract/types';
import {
  type AuthoringTypeConstructorCall,
  type AuthoringTypeConstructorDescriptor,
  type AuthoringTypeConstructorOutput,
  type AuthoringTypeNamespace,
  authoringTypeConstructorArguments,
  authoringTypeConstructors,
  type DataTypeSupport,
  findAuthoringTypeChoiceCall,
  getAuthoringTypeChoice,
  instantiateAuthoringTypeConstructor,
  isAuthoringTypeChoiceOption,
  writeDataTypeValue,
} from '@internal/framework-components/authoring';
import type {
  CodecLookupWithDescriptors,
  DataTypeLookup,
} from '@internal/framework-components/codec';
import { dataTypeId, dataTypeParams } from '@internal/framework-components/codec';
import { canonicalizeJson } from '@internal/framework-components/utils';
import {
  isSqlDataType,
  type SqlDataType,
  type SqlTypeParams,
} from '@internal/sql-contract/data-type';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { isInternalError } from '@internal/utils/internal-error';

/** The type constructor `contract infer` writes for a data type, with the data type it produces. */
export interface InferredTypeConstructor {
  readonly path: readonly string[];
  readonly descriptor: AuthoringTypeConstructorDescriptor;
  readonly dataType: SqlDataType;
}

/** The constructors marked `inferred` in a stack, keyed by the id of the data type each produces. */
export type InferredTypeConstructors = ReadonlyMap<string, InferredTypeConstructor>;

/** Every constructor of `authoringTypes` marked `inferred`, by the data type its codec represents. */
export function inferredTypeConstructors(input: {
  readonly authoringTypes: AuthoringTypeNamespace;
  readonly codecLookup: Pick<CodecLookupWithDescriptors, 'descriptorFor'>;
  readonly dataTypeLookup: DataTypeLookup;
}): InferredTypeConstructors {
  const found = new Map<string, InferredTypeConstructor>();
  for (const { path, descriptor } of authoringTypeConstructors(input.authoringTypes)) {
    if (descriptor.inferred !== true) continue;
    const dataTypeId = input.codecLookup.descriptorFor(descriptor.output.codecId)?.dataType;
    const dataType = dataTypeId === undefined ? undefined : input.dataTypeLookup.get(dataTypeId);
    if (dataType === undefined || !isSqlDataType(dataType)) continue;
    found.set(dataType.id, { path, descriptor, dataType });
  }
  return found;
}

function normalParams(
  marked: InferredTypeConstructor,
  args: readonly unknown[],
): string | undefined {
  try {
    const { typeParams } = instantiateAuthoringTypeConstructor(marked.descriptor, args);
    const params = dataTypeParams(marked.dataType, typeParams);
    return canonicalizeJson(marked.dataType.sql.normalize(params));
  } catch (error) {
    if (isInternalError(error)) throw error;
    return undefined;
  }
}

/**
 * The call to `marked` with the fewest arguments that produces `params`, the normal form of a
 * column's data type parameters: arguments are dropped from the end while the normal form of what
 * the call produces stays `params`. Undefined when the constructor cannot produce them, such as one
 * whose argument names another entity.
 */
export function fewestArgumentsCall(
  marked: InferredTypeConstructor,
  params: SqlTypeParams,
): AuthoringTypeConstructorCall | undefined {
  const all = authoringTypeConstructorArguments(marked.descriptor, {
    codecId: marked.descriptor.output.codecId,
    typeParams: params,
  });
  if (all === undefined) return undefined;
  const wanted = canonicalizeJson(params);
  const args = [...all];
  while (args.length > 0 && normalParams(marked, args.slice(0, -1)) === wanted) args.pop();
  return { path: marked.path, args };
}

/** An argument of a type call as PSL writes it: by name, or by position when `name` is undefined. */
export interface PslTypeArgument {
  readonly name: string | undefined;
  readonly text: string;
}

/** A call to a type constructor or type choice as PSL writes it. */
export interface WrittenPslTypeCall {
  readonly path: readonly string[];
  readonly args: readonly PslTypeArgument[];
}

/** A type choice call as PSL writes it, and the type constructor call it becomes. */
export interface WrittenTypeChoiceCall extends WrittenPslTypeCall {
  readonly becomes: AuthoringTypeConstructorCall;
}

/**
 * Whether two outputs have the same codec and the same parameters in the normal form of `dataType`, which the codecs represent: how `db verify` and the planner compare a column with the database.
 */
export function sameInNormalForm(
  dataType: SqlDataType,
): (produced: AuthoringTypeConstructorOutput, wanted: AuthoringTypeConstructorOutput) => boolean {
  const normal = (output: AuthoringTypeConstructorOutput) =>
    canonicalizeJson(dataType.sql.normalize(dataTypeParams(dataType, output.typeParams ?? {})));
  return (produced, wanted) =>
    produced.codecId === wanted.codecId && normal(produced) === normal(wanted);
}

/**
 * The type choice call that becomes the type constructor call `call`, written by name with only the arguments that differ from the defaults (ADR 279). `sameOutput` decides when it becomes the same type; by default the codec and type parameters must be exactly equal. `undefined` when no type choice call becomes it or an argument has no literal that reads back as it.
 */
export function writtenTypeChoiceCall(input: {
  readonly authoringTypes: AuthoringTypeNamespace;
  readonly call: AuthoringTypeConstructorCall;
  readonly dataTypes: DataTypeSupport;
  readonly sameOutput:
    | ((
        produced: AuthoringTypeConstructorOutput,
        wanted: AuthoringTypeConstructorOutput,
      ) => boolean)
    | undefined;
}): WrittenTypeChoiceCall | undefined {
  const found = findAuthoringTypeChoiceCall({
    namespace: input.authoringTypes,
    call: input.call,
    ...ifDefined('sameOutput', input.sameOutput),
  });
  const choice = found && getAuthoringTypeChoice({ type: input.authoringTypes }, found.path);
  if (found === undefined || choice === undefined) return undefined;
  const args: PslTypeArgument[] = [];
  for (const { name, value } of found.args) {
    const argument = choice.descriptor.args.find((candidate) => candidate.name === name);
    const text =
      argument === undefined
        ? undefined
        : isAuthoringTypeChoiceOption(argument)
          ? String(value)
          : writeDataTypeValue(
              blindCast<JsonValue, 'a passed-on argument becomes a type parameter, which is JSON'>(
                value,
              ),
              dataTypeId(argument.dataType),
              input.dataTypes,
            );
    if (text === undefined) return undefined;
    args.push({ name, text });
  }
  return { path: found.path, args, becomes: found.becomes };
}
