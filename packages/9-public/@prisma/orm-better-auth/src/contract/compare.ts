import type { BetterAuthOptions } from '@better-auth/core';
import type { BetterAuthDBSchema, DBFieldAttribute } from '@better-auth/core/db';
import { resolveStorageTable } from '@prisma/orm-family-sql/contract/resolve-storage-table';
import type { SqlModelStorage } from '@prisma/orm-family-sql/contract/types';
import { UNBOUND_DOMAIN_NAMESPACE_ID } from '@prisma/orm-framework/contract/default-namespace';
import type { ContractField, ContractModelBase } from '@prisma/orm-framework/contract/types';
import {
  type BetterAuthField,
  type BetterAuthModel,
  type BetterAuthReference,
  type IdStrategy,
  idStrategyOf,
  isIdReference,
  managedModels,
} from '../models/better-auth-models';
import { type CodecKind, codecKind } from '../models/codec-kinds';
import { describeFieldType } from '../models/field-type';
import { isPslIdentifier } from '../models/identifiers';
import { type FoundModel, findModel, type SqlContract } from '../models/model-lookup';

export type ComparedModel =
  | { readonly status: 'missing'; readonly expected: BetterAuthModel }
  | { readonly status: 'ambiguous'; readonly expected: BetterAuthModel }
  | {
      readonly status: 'found';
      readonly expected: BetterAuthModel;
      readonly found: FoundModel;
      readonly missingFields: readonly string[];
    };

export type ContractProblem =
  | {
      readonly kind: 'invalid-name';
      readonly model: string;
      /** The field whose name is not an identifier; absent when it is the model's name. */
      readonly field?: string;
    }
  | { readonly kind: 'missing-model'; readonly model: string }
  | {
      readonly kind: 'ambiguous-model';
      readonly model: string;
      readonly namespaceIds: readonly string[];
    }
  | { readonly kind: 'missing-field'; readonly model: string; readonly field: string }
  | {
      readonly kind: 'wrong-type';
      readonly model: string;
      readonly field: string;
      /** Better Auth's description of the field, or `undefined` for `id`. */
      readonly attribute: DBFieldAttribute | undefined;
      readonly reference: BetterAuthReference | undefined;
      readonly found: string;
    }
  | {
      readonly kind: 'optional-field-not-nullable';
      readonly model: string;
      readonly field: string;
      readonly attribute: DBFieldAttribute;
      readonly reference: BetterAuthReference | undefined;
    }
  | { readonly kind: 'id-without-default'; readonly model: string }
  | { readonly kind: 'required-field-not-written'; readonly model: string; readonly field: string };

export interface ContractComparison {
  readonly models: readonly ComparedModel[];
  readonly problems: readonly ContractProblem[];
  readonly idStrategy: IdStrategy;
  readonly namespace: string | undefined;
  /** The namespace a model printed outside a `namespace` block belongs to. */
  readonly defaultNamespace: string;
  /** Contract models that Better Auth's foreign keys reference but that are not among the models it expects, by physical model name. */
  readonly referencedModels: ReadonlyMap<string, FoundModel>;
  /** Physical names of the models whose contract `id` uses the PostgreSQL `uuid` codec, when the id strategy accepts one. */
  readonly uuidKeyedModels: ReadonlySet<string>;
}

export interface ComparisonInput {
  readonly contract: SqlContract;
  readonly tables: BetterAuthDBSchema;
  readonly betterAuthOptions: BetterAuthOptions;
  readonly namespace: string | undefined;
  readonly usePlural: boolean;
}

const acceptedKindsByIdStrategy: Readonly<Record<IdStrategy, readonly CodecKind[]>> = {
  serial: ['number'],
  uuid: ['string', 'uuid'],
  string: ['string'],
  contract: ['string'],
};

const defaultNamespaceByTarget: Readonly<Record<string, string>> = {
  postgres: 'public',
};

function acceptedKinds(attribute: DBFieldAttribute, idStrategy: IdStrategy): readonly CodecKind[] {
  if (isIdReference(attribute)) return acceptedKindsByIdStrategy[idStrategy];
  switch (attribute.type) {
    case 'number':
      return ['number'];
    case 'boolean':
      return ['boolean'];
    case 'date':
      return ['date'];
    case 'string':
      return ['string', 'enum'];
    default:
      return Array.isArray(attribute.type) ? ['string', 'enum'] : ['string'];
  }
}

/** The description of a contract field whose type Better Auth cannot use, or `undefined` when it can. */
function wrongTypeFound(field: ContractField, accepted: readonly CodecKind[]): string | undefined {
  if (field.type.kind !== 'scalar' || field.many) return describeFieldType(field);
  const kind = codecKind(field.type.codecId);
  return kind === undefined || accepted.includes(kind) ? undefined : describeFieldType(field);
}

function isSqlModelStorage(storage: ContractModelBase['storage']): storage is SqlModelStorage {
  return typeof storage['table'] === 'string' && typeof storage['namespaceId'] === 'string';
}

interface ColumnFacts {
  readonly hasDatabaseDefault: boolean;
  readonly hasCreateGenerator: boolean;
}

function columnFacts(contract: SqlContract, found: FoundModel, field: string): ColumnFacts {
  const storage = found.model.storage;
  if (!isSqlModelStorage(storage)) {
    return { hasDatabaseDefault: false, hasCreateGenerator: false };
  }
  const column = storage.fields[field]?.column ?? field;
  const table = resolveStorageTable(contract.storage, storage.table, storage.namespaceId)?.table;
  return {
    hasDatabaseDefault: table?.columns[column]?.default !== undefined,
    hasCreateGenerator: (contract.execution?.mutations.defaults ?? []).some(
      ({ ref, onCreate }) =>
        onCreate !== undefined &&
        ref.namespace === storage.namespaceId &&
        ref.entry === storage.table &&
        ref.field === column,
    ),
  };
}

/** Better Auth writes `null` to an optional field it has no default value for, so a database default does not help. */
function mayBeNull(field: BetterAuthField): boolean {
  return field.attribute.required === false && field.attribute.defaultValue === undefined;
}

function compareFoundModel(
  contract: SqlContract,
  expected: BetterAuthModel,
  found: FoundModel,
  idStrategy: IdStrategy,
  problems: ContractProblem[],
): string[] {
  const fields = found.model.fields;
  const model = found.name;
  const missingFields: string[] = [];

  const id = fields['id'];
  if (id === undefined) {
    missingFields.push('id');
  } else {
    const wrong = wrongTypeFound(id, acceptedKindsByIdStrategy[idStrategy]);
    if (wrong !== undefined) {
      problems.push({
        kind: 'wrong-type',
        model,
        field: 'id',
        attribute: undefined,
        reference: undefined,
        found: wrong,
      });
    }
    const facts = columnFacts(contract, found, 'id');
    const betterAuthSendsNoId = idStrategy === 'serial' || idStrategy === 'contract';
    if (betterAuthSendsNoId && !facts.hasDatabaseDefault && !facts.hasCreateGenerator) {
      problems.push({ kind: 'id-without-default', model });
    }
  }

  for (const field of expected.fields) {
    const contractField = fields[field.name];
    if (contractField === undefined) {
      missingFields.push(field.name);
      continue;
    }
    const wrong = wrongTypeFound(contractField, acceptedKinds(field.attribute, idStrategy));
    if (wrong !== undefined) {
      problems.push({
        kind: 'wrong-type',
        model,
        field: field.name,
        attribute: field.attribute,
        reference: field.reference,
        found: wrong,
      });
    } else if (mayBeNull(field) && !contractField.nullable) {
      problems.push({
        kind: 'optional-field-not-nullable',
        model,
        field: field.name,
        attribute: field.attribute,
        reference: field.reference,
      });
    }
  }
  for (const field of missingFields) {
    problems.push({ kind: 'missing-field', model, field });
  }

  const written = new Set(['id', ...expected.fields.map((field) => field.name)]);
  for (const [name, field] of Object.entries(fields)) {
    if (written.has(name) || field.nullable) continue;
    const facts = columnFacts(contract, found, name);
    if (!facts.hasDatabaseDefault && !facts.hasCreateGenerator) {
      problems.push({ kind: 'required-field-not-written', model, field: name });
    }
  }
  return missingFields;
}

function hasUuidId(found: FoundModel): boolean {
  const id = found.model.fields['id'];
  return id?.type.kind === 'scalar' && codecKind(id.type.codecId) === 'uuid';
}

function uuidKeyedModelsOf(
  models: readonly ComparedModel[],
  referencedModels: ReadonlyMap<string, FoundModel>,
): Set<string> {
  const found: [string, FoundModel][] = [
    ...models.flatMap((model): [string, FoundModel][] =>
      model.status === 'found' ? [[model.expected.physicalName, model.found]] : [],
    ),
    ...referencedModels,
  ];
  return new Set(found.filter(([, model]) => hasUuidId(model)).map(([name]) => name));
}

/** A model or field name that is not a Prisma identifier can be neither matched nor printed, so it is the only problem reported. */
function invalidNameProblems(models: readonly BetterAuthModel[]): ContractProblem[] {
  return models.flatMap((model): ContractProblem[] => [
    ...(isPslIdentifier(model.physicalName)
      ? []
      : [{ kind: 'invalid-name' as const, model: model.physicalName }]),
    ...model.fields
      .filter((field) => !isPslIdentifier(field.name))
      .map((field) => ({
        kind: 'invalid-name' as const,
        model: model.physicalName,
        field: field.name,
      })),
  ]);
}

/**
 * Compares the contract with the models and fields Better Auth's table description asks for. The contract check and `auth generate` both use it.
 */
export function compareContract(input: ComparisonInput): ContractComparison {
  const { contract, betterAuthOptions, namespace } = input;
  const idStrategy = idStrategyOf(betterAuthOptions);
  const defaultNamespace = defaultNamespaceByTarget[contract.target] ?? UNBOUND_DOMAIN_NAMESPACE_ID;
  const expectedModelList = managedModels(input.tables, input);
  const invalidNames = invalidNameProblems(expectedModelList);
  if (invalidNames.length > 0) {
    return {
      models: [],
      problems: invalidNames,
      referencedModels: new Map(),
      uuidKeyedModels: new Set(),
      idStrategy,
      namespace,
      defaultNamespace,
    };
  }
  const expectedNames = new Set(expectedModelList.map((model) => model.physicalName));
  const problems: ContractProblem[] = [];
  const models: ComparedModel[] = [];
  for (const expected of expectedModelList) {
    const lookup = findModel(contract, expected.physicalName, namespace, expectedNames);
    switch (lookup.kind) {
      case 'missing':
        problems.push({ kind: 'missing-model', model: expected.physicalName });
        models.push({ status: 'missing', expected });
        break;
      case 'ambiguous':
        problems.push({
          kind: 'ambiguous-model',
          model: lookup.name,
          namespaceIds: lookup.namespaceIds,
        });
        models.push({ status: 'ambiguous', expected });
        break;
      case 'found': {
        const missingFields = compareFoundModel(contract, expected, lookup, idStrategy, problems);
        models.push({ status: 'found', expected, found: lookup, missingFields });
        break;
      }
    }
  }
  const referencedModels = new Map<string, FoundModel>();
  for (const model of expectedModelList) {
    for (const { reference } of model.fields) {
      if (reference === undefined || expectedNames.has(reference.model)) continue;
      const lookup = findModel(contract, reference.model, namespace, expectedNames);
      if (lookup.kind === 'found') referencedModels.set(reference.model, lookup);
    }
  }
  return {
    models,
    problems,
    referencedModels,
    uuidKeyedModels: acceptedKindsByIdStrategy[idStrategy].includes('uuid')
      ? uuidKeyedModelsOf(models, referencedModels)
      : new Set(),
    idStrategy,
    namespace,
    defaultNamespace,
  };
}
