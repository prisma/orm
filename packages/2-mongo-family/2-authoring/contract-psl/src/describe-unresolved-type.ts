import type { AuthoringTypeNamespace } from '@internal/framework-components/authoring';
import {
  collectScalarTypeConstructors,
  isAuthoringTypeChoiceDescriptor,
  isAuthoringTypeConstructorDescriptor,
} from '@internal/framework-components/authoring';
import type { AssembledAuthoringContributions } from '@internal/framework-components/control';
import type { DescribeUnresolvedType } from '@internal/psl-parser';
import { describeRemovedFieldPreset } from '@internal/psl-parser/interpret';
import { removedMongoFieldPresets } from './removed-field-presets';

function scalarTypesToWrite(types: AuthoringTypeNamespace): readonly string[] {
  const descriptors = [...collectScalarTypeConstructors(types).keys()].flatMap((name) => {
    const descriptor = types[name];
    return descriptor === undefined ? [] : [{ name, descriptor }];
  });
  const typeChoices = descriptors.flatMap(({ name, descriptor }) =>
    isAuthoringTypeChoiceDescriptor(descriptor) ? [{ name, descriptor }] : [],
  );
  const reachedByTypeChoice = new Set(
    typeChoices.flatMap(({ descriptor }) => descriptor.choices.map((row) => row.type)),
  );
  const explicitTypesNoTypeChoiceReaches = descriptors.flatMap(({ name, descriptor }) =>
    isAuthoringTypeConstructorDescriptor(descriptor) &&
    descriptor.deprecated === undefined &&
    !reachedByTypeChoice.has(name)
      ? [name]
      : [],
  );
  return [...typeChoices.map(({ name }) => name), ...explicitTypesNoTypeChoiceReaches];
}

function scalarTypesSentence(types: AuthoringTypeNamespace): string {
  const current = scalarTypesToWrite(types);
  return current.length === 0
    ? 'No Mongo scalar types are registered.'
    : `The Mongo scalar types are ${
        current.length === 1
          ? current.join('')
          : `${current.slice(0, -1).join(', ')} and ${current.at(-1)}`
      }.`;
}

export function describeUnresolvedMongoType(
  contributions: AssembledAuthoringContributions,
): DescribeUnresolvedType {
  const types = contributions.type;
  return ({ field, owner, written, isDeclared }) => {
    if (field.typeConstructor !== undefined) {
      return describeRemovedFieldPreset(removedMongoFieldPresets, field, types, isDeclared);
    }
    if (field.typeNamespaceId !== undefined) {
      return undefined;
    }
    return `Field "${owner.name}.${field.name}" has type "${written}", which is not a scalar type, an enum, a composite type or a model. ${scalarTypesSentence(types)}`;
  };
}
