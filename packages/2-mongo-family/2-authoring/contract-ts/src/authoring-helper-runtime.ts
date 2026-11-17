import { assertSafeAuthoringHelperKey } from '@internal/contract-authoring';
import type {
  AuthoringArgumentDescriptor,
  AuthoringTypeChoiceOption,
  AuthoringTypeNamespace,
  DataTypeSupport,
  ScalarTypeConstructorOutput,
  WrittenScalar,
} from '@internal/framework-components/authoring';
import {
  describeAdmittedForms,
  instantiateAuthoringTypeAlias,
  instantiateAuthoringTypeConstructor,
  isAuthoringTypeAliasDescriptor,
  isAuthoringTypeChoiceDescriptor,
  isAuthoringTypeConstructorDescriptor,
  readWrittenValueAs,
  resolveAuthoringTypeChoice,
  typeChoiceArgumentsFromObject,
  typeConstructorLookup,
  validateAuthoringHelperArguments,
  validateAuthoringTypeChoiceParams,
  validateAuthoringTypeParams,
} from '@internal/framework-components/authoring';
import {
  type CodecLookupWithDescriptors,
  dataTypeId,
  numeralText,
} from '@internal/framework-components/codec';
import { ifDefined } from '@internal/utils/defined';
import { contractError } from './contract-errors';
import type { MongoTypeInstance } from './type-helpers';

/** What the type helpers read their arguments with: the stack's codecs, and its data types with their authoring entries. */
export interface AuthoringHelperLookups {
  readonly codecLookup: CodecLookupWithDescriptors;
  readonly dataTypes: DataTypeSupport;
}

/** The written value a TypeScript argument stands for: a number, string or boolean as PSL writes it. */
function writtenValueOf(value: unknown): WrittenScalar | undefined {
  if (typeof value === 'number') return { kind: 'number', text: numeralText(value) };
  if (typeof value === 'string') return { kind: 'string', text: value };
  if (typeof value === 'boolean') return { kind: 'boolean', value };
  return undefined;
}

/** The arguments of a call as the constructor receives them: each `value` argument read as a value of its data type, through the same read as a PSL argument, so both give the same type parameters. */
function readValueArguments(
  helperPath: string,
  descriptors: readonly (AuthoringArgumentDescriptor | AuthoringTypeChoiceOption)[] | undefined,
  args: readonly unknown[],
  dataTypes: DataTypeSupport,
): readonly unknown[] {
  return args.map((value, index) => {
    const descriptor = descriptors?.[index];
    if (descriptor?.kind !== 'value' || value === undefined) return value;
    const label =
      descriptor.name === undefined
        ? `Argument #${index + 1} of ${helperPath}`
        : `Argument "${descriptor.name}" of ${helperPath}`;
    const dataType = dataTypeId(descriptor.dataType);
    const refuse = (message: string): never => {
      throw contractError('CONTRACT.ARGUMENT_INVALID', `${label}: ${message}`, {
        meta: { dataType },
      });
    };
    const written = writtenValueOf(value);
    if (written === undefined) {
      return refuse(`Expected ${describeAdmittedForms(dataTypes, dataType)}`);
    }
    const read = readWrittenValueAs(dataTypes, dataType, written);
    return read.ok ? read.value.value : refuse(read.failure.message);
  });
}

function fieldTypeOf(output: ScalarTypeConstructorOutput): MongoTypeInstance {
  return {
    kind: 'scalar',
    codecId: output.codecId,
    ...ifDefined('typeParams', output.typeParams),
  };
}

/** The runtime `type` helpers of `namespace`: each type constructor, type choice and type alias as a function giving the MongoDB field type it stands for. A constructor marked `deprecated` is a PSL name only, and has no helper. */
export function createTypeHelpersFromNamespace(
  namespace: AuthoringTypeNamespace,
  lookups: AuthoringHelperLookups,
  path: readonly string[] = [],
): Record<string, unknown> {
  const helpers: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(namespace)) {
    assertSafeAuthoringHelperKey(key, path);
    const helperPath = [...path, key].join('.');

    if (isAuthoringTypeConstructorDescriptor(value)) {
      if (value.deprecated !== undefined) continue;
      helpers[key] = (...written: readonly unknown[]): MongoTypeInstance => {
        validateAuthoringHelperArguments(helperPath, value.args, written);
        const args = readValueArguments(helperPath, value.args, written, lookups.dataTypes);
        const output = instantiateAuthoringTypeConstructor(value, args);
        validateAuthoringTypeParams(
          helperPath,
          value.output,
          output.typeParams,
          lookups.codecLookup.descriptorFor(output.codecId)?.paramsSchema,
        );
        return fieldTypeOf(output);
      };
      continue;
    }

    if (isAuthoringTypeChoiceDescriptor(value)) {
      const constructorNamed = typeConstructorLookup(namespace);
      helpers[key] = (...written: readonly unknown[]): MongoTypeInstance => {
        const args = typeChoiceArgumentsFromObject(helperPath, value, written);
        validateAuthoringHelperArguments(helperPath, value.args, args);
        const chosen = resolveAuthoringTypeChoice({
          helperPath,
          descriptor: value,
          args: readValueArguments(helperPath, value.args, args, lookups.dataTypes),
          constructorNamed,
        });
        const output = instantiateAuthoringTypeConstructor(chosen.descriptor, chosen.args);
        validateAuthoringTypeChoiceParams(
          helperPath,
          value,
          chosen.descriptor,
          output.typeParams,
          lookups.codecLookup.descriptorFor(output.codecId)?.paramsSchema,
        );
        return fieldTypeOf(output);
      };
      continue;
    }

    if (isAuthoringTypeAliasDescriptor(value)) {
      helpers[key] = (...args: readonly unknown[]): MongoTypeInstance => {
        validateAuthoringHelperArguments(helperPath, [], args);
        const { type, onCreate, onUpdate } = instantiateAuthoringTypeAlias(value);
        const generatorCalls = {
          ...ifDefined('onCreate', onCreate),
          ...ifDefined('onUpdate', onUpdate),
        };
        return {
          ...fieldTypeOf(type),
          ...(Object.keys(generatorCalls).length === 0 ? {} : { generatorCalls }),
        };
      };
      continue;
    }

    helpers[key] = createTypeHelpersFromNamespace(value, lookups, [...path, key]);
  }

  return helpers;
}
