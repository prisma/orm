import { assertSafeAuthoringHelperKey } from '@internal/contract-authoring';
import type {
  AuthoringArgumentDescriptor,
  AuthoringTypeChoiceOption,
  AuthoringTypeNamespace,
  DataTypeSupport,
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
  type DataTypeId,
  dataTypeId,
  numeralText,
} from '@internal/framework-components/codec';
import { readSqlExpression, SQL_EXPRESSION_TAG } from '@internal/sql-contract/sql-expression';
import {
  type AuthoredStorageTypeInstance,
  CODEC_INSTANCE_KIND,
} from '@internal/sql-contract/types';
import { ifDefined } from '@internal/utils/defined';
import type { TypeAliasColumnType } from './contract-dsl';
import { contractError } from './contract-errors';

/** What the type helpers read their arguments with: the stack's codecs, and its data types with their authoring entries. */
export interface AuthoringHelperLookups {
  readonly codecLookup: CodecLookupWithDescriptors;
  readonly dataTypes: DataTypeSupport;
}

/** The written value a TypeScript argument stands for: a number, string or boolean as written in PSL, and a `sql` value as a `sql` literal of its text. */
function writtenValueOf(value: unknown): WrittenScalar | undefined {
  if (typeof value === 'number') return { kind: 'number', text: numeralText(value) };
  if (typeof value === 'string') return { kind: 'string', text: value };
  if (typeof value === 'boolean') return { kind: 'boolean', value };
  const expression = readSqlExpression(value);
  return expression === undefined
    ? undefined
    : { kind: 'tag', tag: SQL_EXPRESSION_TAG, text: expression.text };
}

function readValueArgument(
  label: string,
  value: unknown,
  dataType: DataTypeId,
  dataTypes: DataTypeSupport,
): unknown {
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
}

/**
 * The arguments of a type constructor or type choice call as the constructor receives them: each `value` argument read as a value of its data type, through the same read and cast as a PSL argument, so both give the same parameters. ADR 129, ADR 254.
 */
export function readValueArguments(
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
    return readValueArgument(label, value, dataTypeId(descriptor.dataType), dataTypes);
  });
}

export function createTypeHelpersFromNamespace(
  namespace: AuthoringTypeNamespace,
  lookups: AuthoringHelperLookups,
  path: readonly string[] = [],
): Record<string, unknown> {
  const helpers: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(namespace)) {
    assertSafeAuthoringHelperKey(key, path);
    const currentPath = [...path, key];

    if (isAuthoringTypeConstructorDescriptor(value)) {
      const helperPath = currentPath.join('.');
      helpers[key] = (...written: readonly unknown[]): AuthoredStorageTypeInstance => {
        validateAuthoringHelperArguments(helperPath, value.args, written);
        const args = readValueArguments(helperPath, value.args, written, lookups.dataTypes);
        const output = instantiateAuthoringTypeConstructor(value, args);
        validateAuthoringTypeParams(
          helperPath,
          value.output,
          output.typeParams,
          lookups.codecLookup.descriptorFor(output.codecId)?.paramsSchema,
        );
        return {
          kind: CODEC_INSTANCE_KIND,
          codecId: output.codecId,
          typeParams: output.typeParams ?? {},
        };
      };
      continue;
    }

    if (isAuthoringTypeChoiceDescriptor(value)) {
      const helperPath = currentPath.join('.');
      const constructorNamed = typeConstructorLookup(namespace);
      helpers[key] = (...written: readonly unknown[]): AuthoredStorageTypeInstance => {
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
        return {
          kind: CODEC_INSTANCE_KIND,
          codecId: output.codecId,
          typeParams: output.typeParams ?? {},
        };
      };
      continue;
    }

    if (isAuthoringTypeAliasDescriptor(value)) {
      const helperPath = currentPath.join('.');
      helpers[key] = (...args: readonly unknown[]): TypeAliasColumnType => {
        validateAuthoringHelperArguments(helperPath, [], args);
        const { type, onCreate, onUpdate } = instantiateAuthoringTypeAlias(value);
        const generatorCalls = {
          ...ifDefined('onCreate', onCreate),
          ...ifDefined('onUpdate', onUpdate),
        };
        return {
          kind: CODEC_INSTANCE_KIND,
          codecId: type.codecId,
          typeParams: type.typeParams ?? {},
          ...(Object.keys(generatorCalls).length === 0 ? {} : { generatorCalls }),
        };
      };
      continue;
    }

    helpers[key] = createTypeHelpersFromNamespace(value, lookups, currentPath);
  }

  return helpers;
}
