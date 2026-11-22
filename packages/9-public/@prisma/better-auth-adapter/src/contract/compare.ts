import type { BetterAuthOptions } from '@better-auth/core';
import type { BetterAuthDBSchema, DBFieldAttribute } from '@better-auth/core/db';
import { resolveStorageTable } from '@prisma/orm-family-sql/contract/resolve-storage-table';
import type { SqlModelStorage } from '@prisma/orm-family-sql/contract/types';
import { UNBOUND_DOMAIN_NAMESPACE_ID } from '@prisma/orm-framework/contract/default-namespace';
import type { ContractField, ContractModelBase } from '@prisma/orm-framework/contract/types';
import { type CodecKind, codecKind } from './codec-kinds';
import { type ExpectedField, type ExpectedModel, expectedModels } from './expected-models';
import { type FoundModel, findModel, type SqlContract } from './model-lookup';

/** How `id` gets its value: Better Auth sends a string (`string`) or a UUID string (`uuid`), or sends none and the contract fills it (`serial`, an autoincrement number; `database`, a default or an `onCreate` generator). */
export type IdStrategy = 'string' | 'uuid' | 'serial' | 'database';

export type ComparedModel =
  | { readonly status: 'missing'; readonly expected: ExpectedModel }
  | { readonly status: 'ambiguous'; readonly expected: ExpectedModel; readonly message: string }
  | {
      readonly status: 'found';
      readonly expected: ExpectedModel;
      readonly found: FoundModel;
      readonly missingFields: readonly string[];
    };

export type ContractProblem =
  | { readonly kind: 'missing-model'; readonly model: string }
  | { readonly kind: 'ambiguous-model'; readonly message: string }
  | { readonly kind: 'missing-field'; readonly model: string; readonly field: string }
  | {
      readonly kind: 'wrong-type';
      readonly model: string;
      readonly field: string;
      readonly expectedType: string;
      readonly found: string;
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
}

export interface CompareContractInput {
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
  database: ['string'],
};

const defaultNamespaceByTarget: Readonly<Record<string, string>> = {
  postgres: 'public',
};

function idStrategyOf(options: BetterAuthOptions): IdStrategy {
  const generateId = options.advanced?.database?.generateId;
  if (generateId === 'serial') return 'serial';
  if (generateId === 'uuid') return 'uuid';
  if (generateId === false) return 'database';
  return 'string';
}

function isIdReference(attribute: DBFieldAttribute): boolean {
  return attribute.references?.field === 'id';
}

function acceptedKinds(attribute: DBFieldAttribute, idStrategy: IdStrategy): readonly CodecKind[] {
  if (isIdReference(attribute)) return acceptedKindsByIdStrategy[idStrategy];
  switch (attribute.type) {
    case 'number':
      return ['number'];
    case 'boolean':
      return ['boolean'];
    case 'date':
      return ['date'];
    default:
      return ['string'];
  }
}

export function pslTypeOf(attribute: DBFieldAttribute, idStrategy: IdStrategy): string {
  if (isIdReference(attribute)) return idStrategy === 'serial' ? 'Int' : 'String';
  switch (attribute.type) {
    case 'number':
      return attribute.bigint === true ? 'BigInt(as: number)' : 'Int';
    case 'boolean':
      return 'Boolean';
    case 'date':
      return 'DateTime';
    default:
      return 'String';
  }
}

export interface IdField {
  readonly name: 'id';
  readonly type: string;
  readonly attributes: string;
}

export function idFieldOf(idStrategy: IdStrategy): IdField {
  switch (idStrategy) {
    case 'serial':
      return { name: 'id', type: 'Int', attributes: '@id @default(autoincrement())' };
    case 'database':
      return { name: 'id', type: 'String', attributes: '@id @onCreate(uuid())' };
    default:
      return { name: 'id', type: 'String', attributes: '@id' };
  }
}

export function idLineOf(idStrategy: IdStrategy): string {
  const { name, type, attributes } = idFieldOf(idStrategy);
  return `${name} ${type} ${attributes}`;
}

/** What a contract field holds, as the message names it, when its type is wrong for every Better Auth field. */
function unusableShape(field: ContractField): string | undefined {
  if (field.type.kind === 'valueObject') return 'a value object';
  if (field.type.kind === 'union') return 'a union';
  if (field.many) return `${field.type.codecId} list`;
  return undefined;
}

function wrongTypeFound(field: ContractField, accepted: readonly CodecKind[]): string | undefined {
  const shape = unusableShape(field);
  if (shape !== undefined || field.type.kind !== 'scalar') return shape;
  const kind = codecKind(field.type.codecId);
  return kind === undefined || accepted.includes(kind) ? undefined : field.type.codecId;
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

function compareFoundModel(
  contract: SqlContract,
  expected: ExpectedModel,
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
        expectedType: idLineOf(idStrategy),
        found: wrong,
      });
    }
    const facts = columnFacts(contract, found, 'id');
    const betterAuthSendsNoId = idStrategy === 'serial' || idStrategy === 'database';
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
        expectedType: pslTypeOf(field.attribute, idStrategy),
        found: wrong,
      });
    }
  }
  for (const field of missingFields) {
    problems.push({ kind: 'missing-field', model, field });
  }

  const written = new Set(['id', ...expected.fields.map((field: ExpectedField) => field.name)]);
  for (const [name, field] of Object.entries(fields)) {
    if (written.has(name) || field.nullable) continue;
    const facts = columnFacts(contract, found, name);
    if (!facts.hasDatabaseDefault && !facts.hasCreateGenerator) {
      problems.push({ kind: 'required-field-not-written', model, field: name });
    }
  }
  return missingFields;
}

/**
 * Compares the contract with the models and fields Better Auth's table description asks for. The contract check and `auth generate` both use it.
 */
export function compareContract(input: CompareContractInput): ContractComparison {
  const { contract, betterAuthOptions, namespace } = input;
  const idStrategy = idStrategyOf(betterAuthOptions);
  const problems: ContractProblem[] = [];
  const models: ComparedModel[] = [];
  const expectedModelList = expectedModels(input.tables, input);
  for (const expected of expectedModelList) {
    const lookup = findModel(contract, expected.physicalName, namespace);
    switch (lookup.kind) {
      case 'missing':
        problems.push({ kind: 'missing-model', model: expected.physicalName });
        models.push({ status: 'missing', expected });
        break;
      case 'ambiguous':
        problems.push({ kind: 'ambiguous-model', message: lookup.message });
        models.push({ status: 'ambiguous', expected, message: lookup.message });
        break;
      case 'found': {
        const missingFields = compareFoundModel(contract, expected, lookup, idStrategy, problems);
        models.push({ status: 'found', expected, found: lookup, missingFields });
        break;
      }
    }
  }
  const expectedNames = new Set(expectedModelList.map((model) => model.physicalName));
  const referencedModels = new Map<string, FoundModel>();
  for (const model of expectedModelList) {
    for (const { reference } of model.fields) {
      if (reference === undefined || expectedNames.has(reference.model)) continue;
      const lookup = findModel(contract, reference.model, namespace);
      if (lookup.kind === 'found') referencedModels.set(reference.model, lookup);
    }
  }
  return {
    models,
    problems,
    referencedModels,
    idStrategy,
    namespace,
    defaultNamespace: defaultNamespaceByTarget[contract.target] ?? UNBOUND_DOMAIN_NAMESPACE_ID,
  };
}
