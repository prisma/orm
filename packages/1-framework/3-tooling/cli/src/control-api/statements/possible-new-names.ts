import { asNamespaceId, type ContractWithDomain, valueObjectAt } from '@internal/contract/types';
import {
  type EnumValueCoordinate,
  type FieldCoordinate,
  type MigrationSubject,
  type ModelCoordinate,
  modelStatementText,
  type ResolvedMigrationStatement,
  type ValueObjectFieldCoordinate,
} from '@internal/framework-components/control';
import type { VariantBase } from './missing-new-name';
import { hasModel, isBaseModel, newVariantsOfBase, storedWithBase, variantBase } from './variants';

/** The two contracts of a change, and the renames resolved between them so far. */
export interface ContractsAndRenames {
  readonly origin: ContractWithDomain;
  readonly destination: ContractWithDomain;
  readonly renames: readonly ResolvedMigrationStatement[];
}

export function sameModel(left: ModelCoordinate, right: ModelCoordinate): boolean {
  return left.namespaceId === right.namespaceId && left.model === right.model;
}

/**
 * The model a rename gives `coordinate` in the destination, if any: a rename of the model, or else
 * a rename of its namespace, under which the model keeps its name when the destination has it there.
 */
export function modelAfterRenames(
  coordinate: ModelCoordinate,
  renames: readonly ResolvedMigrationStatement[],
  destination: ContractWithDomain | undefined,
): ModelCoordinate | undefined {
  for (const statement of renames) {
    if (
      statement.kind === 'rename' &&
      statement.entity === 'model' &&
      sameModel(statement.from, coordinate)
    ) {
      return statement.to;
    }
  }
  const namespaceId = namespaceAfterRenames(coordinate.namespaceId, renames);
  if (namespaceId === undefined) return undefined;
  const moved = { namespaceId, model: coordinate.model };
  return destination?.domain.namespaces[moved.namespaceId]?.models[moved.model] === undefined
    ? undefined
    : moved;
}

/**
 * The base of a variant of the origin: kept, as the destination names it after the renames and a
 * `--rename` writes it, or, for a variant stored where its base is, removed by the change, as the
 * origin names it. `undefined` when the model is no variant, when the destination has the base as
 * a model that is no base, or when the change removes the base of a variant stored elsewhere.
 */
export function variantBaseAfterRenames(
  { origin, destination, renames }: ContractsAndRenames,
  variant: ModelCoordinate,
): VariantBase | undefined {
  const base = variantBase(origin, variant);
  if (base === undefined) return undefined;
  const now = modelAfterRenames(base, renames, destination) ?? base;
  if (isBaseModel(destination, now)) {
    return { kind: 'kept', base: modelStatementText(destination, now) };
  }
  return hasModel(destination, now) || !storedWithBase(origin, variant)
    ? undefined
    : { kind: 'removed', base: modelStatementText(origin, base) };
}

/** The namespace a rename gives `namespaceId`, if any. */
export function namespaceAfterRenames(
  namespaceId: string,
  renames: readonly ResolvedMigrationStatement[],
): ModelCoordinate['namespaceId'] | undefined {
  for (const statement of renames) {
    if (
      statement.kind === 'rename' &&
      statement.entity === 'namespace' &&
      statement.from === namespaceId
    ) {
      return statement.to;
    }
  }
  return undefined;
}

export function enumMembers(
  contract: ContractWithDomain,
  value: EnumValueCoordinate,
): readonly { readonly name: string; readonly value: unknown }[] {
  return contract.domain.namespaces[value.namespaceId]?.enum?.[value.enum]?.members ?? [];
}

/** An enum value under the namespace a rename gives its enum, when the destination has the enum there. */
export function enumValueAfterRenames(
  value: EnumValueCoordinate,
  renames: readonly ResolvedMigrationStatement[],
  destination: ContractWithDomain | undefined,
): EnumValueCoordinate | undefined {
  const namespaceId = namespaceAfterRenames(value.namespaceId, renames);
  if (namespaceId === undefined) return undefined;
  return destination?.domain.namespaces[namespaceId]?.enum?.[value.enum] === undefined
    ? undefined
    : { ...value, namespaceId };
}

/** The fields of a value object in a contract's storage; `undefined` when the contract has no such value object. */
export function valueObjectFields(
  contract: ContractWithDomain,
  field: ValueObjectFieldCoordinate,
): readonly string[] | undefined {
  const valueObject = valueObjectAt(contract.storage, {
    plane: 'storage',
    namespaceId: field.namespaceId,
    entityKind: 'valueObject',
    entityName: field.valueObject,
  });
  return valueObject === undefined ? undefined : Object.keys(valueObject.fields);
}

/** A value object field under the namespace a rename gives its value object, when the destination has the value object there. */
export function valueObjectFieldAfterRenames(
  field: ValueObjectFieldCoordinate,
  renames: readonly ResolvedMigrationStatement[],
  destination: ContractWithDomain | undefined,
): ValueObjectFieldCoordinate | undefined {
  const namespaceId = namespaceAfterRenames(field.namespaceId, renames);
  if (namespaceId === undefined || destination === undefined) return undefined;
  const renamed = { ...field, namespaceId };
  return valueObjectFields(destination, renamed) === undefined ? undefined : renamed;
}

/**
 * The models of the contract a removed model can have been renamed to: the new variants of its
 * base, for a variant, or else the new models that are no variant, those of its own namespace when
 * it has any there. A model the contract has under a namespace a rename gives, or that a rename
 * names, is not new.
 */
export function newModels(
  subject: ModelCoordinate,
  { origin, destination, renames }: ContractsAndRenames,
): readonly ModelCoordinate[] {
  const renamedTo = renames.flatMap((statement) =>
    statement.kind === 'rename' && statement.entity === 'model' ? [statement.to] : [],
  );
  if (origin.domain.namespaces[subject.namespaceId]?.models[subject.model]?.base) {
    return newVariantsOfBase(origin, destination, subject, renamedTo);
  }
  const movedHere = new Map<string, string>(
    renames.flatMap((statement) =>
      statement.kind === 'rename' && statement.entity === 'namespace'
        ? [[statement.to, statement.from] as const]
        : [],
    ),
  );
  const inOrigin = (namespaceId: string, model: string) =>
    origin.domain.namespaces[asNamespaceId(movedHere.get(namespaceId) ?? namespaceId)]?.models[
      model
    ] !== undefined;
  const added = Object.entries(destination.domain.namespaces).flatMap(([namespaceId, namespace]) =>
    Object.entries(namespace.models).flatMap(([model, definition]) => {
      const coordinate = { namespaceId: asNamespaceId(namespaceId), model };
      return definition.base === undefined &&
        !inOrigin(namespaceId, model) &&
        !renamedTo.some((each) => sameModel(each, coordinate))
        ? [coordinate]
        : [];
    }),
  );
  const namespaceId = namespaceAfterRenames(subject.namespaceId, renames) ?? subject.namespaceId;
  const inSameNamespace = added.filter((model) => model.namespaceId === namespaceId);
  return inSameNamespace.length > 0 ? inSameNamespace : added;
}

/** The members of the enum of an enum value that the contract adds and no rename names. */
function newMembers(subject: EnumValueCoordinate, context: ContractsAndRenames): readonly string[] {
  const value = enumValueAfterRenames(subject, context.renames, context.destination) ?? subject;
  const originMembers = enumMembers(context.origin, subject);
  const renamedTo = new Set(
    context.renames.flatMap((statement) =>
      statement.kind === 'rename' && statement.entity === 'enumValue' ? [statement.to.member] : [],
    ),
  );
  return enumMembers(context.destination, value)
    .map(({ name }) => name)
    .filter(
      (name) => !renamedTo.has(name) && !originMembers.some((member) => member.name === name),
    );
}

/** The fields of a value object field's value object that the contract adds and no rename names. */
export function newValueObjectFields(
  subject: ValueObjectFieldCoordinate,
  context: ContractsAndRenames,
): readonly string[] {
  const field =
    valueObjectFieldAfterRenames(subject, context.renames, context.destination) ?? subject;
  const originFields = valueObjectFields(context.origin, subject) ?? [];
  const renamedTo = new Set(
    context.renames.flatMap((statement) =>
      statement.kind === 'rename' && statement.entity === 'valueObjectField'
        ? [statement.to.field]
        : [],
    ),
  );
  return (valueObjectFields(context.destination, field) ?? []).filter(
    (name) => !renamedTo.has(name) && !originFields.includes(name),
  );
}

/** The fields of a field's model in the destination that the origin model does not have and no rename names. */
export function newModelFields(
  subject: FieldCoordinate,
  context: ContractsAndRenames,
): readonly string[] {
  const model = modelAfterRenames(subject, context.renames, context.destination) ?? subject;
  const originFields = Object.keys(
    context.origin.domain.namespaces[subject.namespaceId]?.models[subject.model]?.fields ?? {},
  );
  const renamedTo = new Set(
    context.renames.flatMap((statement) =>
      statement.kind === 'rename' && statement.entity === 'field' && sameModel(statement.to, model)
        ? [statement.to.field]
        : [],
    ),
  );
  return Object.keys(
    context.destination.domain.namespaces[model.namespaceId]?.models[model.model]?.fields ?? {},
  ).filter((name) => !renamedTo.has(name) && !originFields.includes(name));
}

/**
 * The names the contract can give a removed subject, as a `--rename` writes them after the
 * subject's model, enum or value object: none for storage. The refusal, the prompt and the error
 * for a rename to a name the contract lacks all take them from here.
 */
export function possibleNewNames(
  subject: MigrationSubject,
  context: ContractsAndRenames,
): readonly string[] {
  switch (subject.kind) {
    case 'storage':
      return [];
    case 'model':
      return newModels(subject, context).map((model) =>
        modelStatementText(context.destination, model),
      );
    case 'enumValue':
      return newMembers(subject, context);
    case 'valueObjectField':
      return newValueObjectFields(subject, context);
    case 'field':
      return newModelFields(subject, context);
  }
}
