import type { JsonValue } from '@internal/contract/types';
import {
  type AuthoringTypeConstructorCall,
  type AuthoringTypeConstructorDescriptor,
  type AuthoringTypeNamespace,
  authoringTypeConstructorArguments,
  authoringTypeConstructors,
  type DataTypeSupport,
  instantiateAuthoringTypeConstructor,
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
import { isInternalError } from '@internal/utils/internal-error';
import { writeDataTypeValue } from './default-mapping';

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

/**
 * Each argument of a call to `descriptor` as PSL writes it: a value argument as a literal of its data type that reads back as the same value. `undefined` when an argument is not a value argument or no literal reads back as it.
 */
export function writtenTypeArguments(
  descriptor: AuthoringTypeConstructorDescriptor,
  args: readonly unknown[],
  dataTypes: DataTypeSupport,
): readonly string[] | undefined {
  const written: string[] = [];
  for (const [index, value] of args.entries()) {
    const argument = descriptor.args?.[index];
    if (argument === undefined) return undefined;
    const text = writeDataTypeValue(
      blindCast<
        JsonValue,
        'a type constructor argument is a type parameter, which contract.json stores as JSON'
      >(value),
      dataTypeId(argument.dataType),
      dataTypes,
    );
    if (text === undefined) return undefined;
    written.push(text);
  }
  return written;
}
