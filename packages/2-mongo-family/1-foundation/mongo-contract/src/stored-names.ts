import type { ContractField, ContractModel, ContractValueObject } from '@internal/contract/types';
import { InternalError } from '@internal/utils/internal-error';
import type { MongoModelStorage } from './contract-types';
import { modelAndBasesOf } from './mongo-models';

/** The name MongoDB stores a document's id under. */
export const DOCUMENT_ID = '_id';

type StoredNamesModel = Pick<ContractModel<MongoModelStorage>, 'fields' | 'storage'>;

/** Why a field or embed relation cannot be stored as `storedName`, if it cannot; the subject is the field or relation. */
export function unsupportedStoredNameReason(storedName: string): string | undefined {
  return storedName === '__proto__'
    ? 'is stored as "__proto__", which JavaScript reads as the prototype of an object rather than as a key'
    : undefined;
}

/** The stored name of each of `model`'s own fields, keyed by field name. */
export function ownStoredNamesOf(model: StoredNamesModel): Readonly<Record<string, string>> {
  const storageFields = model.storage.fields;
  return Object.fromEntries(
    Object.keys(model.fields).map((name) => {
      const entry = Object.hasOwn(storageFields, name) ? storageFields[name] : undefined;
      if (entry === undefined) {
        throw new InternalError(`Field "${name}" has no entry in its model's storage.fields`);
      }
      return [name, entry.field];
    }),
  );
}

/** The stored name of each field of a value object: its own name, since a value object has no storage block. */
export function valueObjectStoredNamesOf(
  valueObject: Pick<ContractValueObject, 'fields'>,
): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.keys(valueObject.fields).map((name) => [name, name]));
}

/** The stored name of `fieldName`, one of `model`'s own fields. */
export function ownStoredNameOf(model: StoredNamesModel, fieldName: string): string {
  const storedNames = ownStoredNamesOf(model);
  const storedName = Object.hasOwn(storedNames, fieldName) ? storedNames[fieldName] : undefined;
  if (storedName === undefined) {
    throw new InternalError(`Model has no field "${fieldName}"`);
  }
  return storedName;
}

/** The own field of `model` stored under `storedName`, or undefined when no own field is. */
export function ownFieldStoredAs(model: StoredNamesModel, storedName: string): string | undefined {
  return Object.entries(ownStoredNamesOf(model)).find(([, stored]) => stored === storedName)?.[0];
}

/** Whether one of `model`'s own fields is stored under `storedName`. */
export function hasOwnFieldStoredAs(model: StoredNamesModel, storedName: string): boolean {
  return ownFieldStoredAs(model, storedName) !== undefined;
}

/** The own field of `model` stored as `_id`, with its name, or undefined when none of its own fields is. */
export function ownDocumentIdFieldOf(
  model: StoredNamesModel,
): { readonly name: string; readonly field: ContractField } | undefined {
  const name = ownFieldStoredAs(model, DOCUMENT_ID);
  const field = name === undefined ? undefined : model.fields[name];
  return name === undefined || field === undefined ? undefined : { name, field };
}

/**
 * The stored name of each of `model`'s own embed relations, keyed by relation name: its `storage.relations` entry, or the relation's own name when it has none.
 */
export function ownEmbedStoredNamesOf(
  model: Pick<ContractModel<MongoModelStorage>, 'relations' | 'storage'>,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(model.relations)
      .filter(([, relation]) => !('on' in relation) && !('through' in relation))
      .map(([name]) => [name, model.storage.relations?.[name]?.field ?? name]),
  );
}

/** The stored name of each field of model `modelName`, its own and those it inherits from its base models, keyed by field name. */
export function storedNamesOf(
  models: Readonly<
    Record<string, StoredNamesModel & Pick<ContractModel<MongoModelStorage>, 'base'>>
  >,
  modelName: string,
): Readonly<Record<string, string>> {
  const chain = [...modelAndBasesOf(models, modelName)].reverse();
  return Object.assign({}, ...chain.map((model) => ownStoredNamesOf(model)));
}
