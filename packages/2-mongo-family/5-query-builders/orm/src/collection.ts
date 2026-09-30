import {
  type ContractField,
  type ContractReferenceRelation,
  type ContractValueObject,
  domainModelsAtDefaultNamespace,
  domainValueObjectsAtDefaultNamespace,
  type PlanMeta,
} from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import {
  AsyncIterableResult,
  type MutationDefaults,
  type MutationDefaultsOp,
  type RuntimeStatementStats,
  runtimeError,
} from '@internal/framework-components/runtime';
import type {
  AnyMongoTypeMaps,
  MongoContract,
  MongoContractWithTypeMaps,
  MongoModelDefinition,
  MongoModelsMap,
} from '@internal/mongo-contract';
import type {
  AnyMongoCommand,
  InsertManyResult,
  InsertOneResult,
  MongoFieldShape,
  MongoFilterExpr,
  MongoQueryPlan,
  MongoResultShape,
} from '@internal/mongo-query-ast/execution';
import {
  DeleteManyCommand,
  FindOneAndDeleteCommand,
  FindOneAndUpdateCommand,
  freezeMongoResultShape,
  InsertManyCommand,
  InsertOneCommand,
  isMongoFilterExpr,
  MongoAndExpr,
  MongoFieldFilter,
  UpdateManyCommand,
} from '@internal/mongo-query-ast/execution';
import {
  contractFieldToMongoFieldShape,
  contractModelToMongoResultShape,
} from '@internal/mongo-query-builder';
import type { MongoValue } from '@internal/mongo-value';
import { MongoParamRef } from '@internal/mongo-value';
import { blindCast, castAs } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import type { SimplifyDeep } from '@internal/utils/simplify-deep';
import type { MongoIncludeExpr } from './collection-state';
import { emptyCollectionState, type MongoCollectionState } from './collection-state';
import { compileMongoQuery } from './compile';
import type { MongoQueryExecutor } from './executor';
import {
  compileFieldOperations,
  createFieldAccessor,
  type FieldAccessor,
  type FieldOperation,
  type UpdateOperator,
} from './field-accessor';
import { ormError } from './orm-errors';
import type {
  DefaultModelRow,
  IncludedRow,
  MongoIncludeSpec,
  MongoWhereFilter,
  NoIncludes,
  ReferenceRelationKeys,
  ResolvedCreateInput,
  VariantNames,
} from './types';
import { upsertPipeline } from './upsert-pipeline';

type ModelFieldKeys<
  TContract extends MongoContract,
  ModelName extends string & keyof MongoModelsMap<TContract>,
> = keyof MongoModelsMap<TContract>[ModelName]['fields'] & string;

export interface MongoCollection<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
  ModelName extends string & keyof MongoModelsMap<TContract>,
  TIncludes extends MongoIncludeSpec<TContract, ModelName> = NoIncludes,
  TVariant extends string = never,
> {
  readonly _row?: SimplifyDeep<IncludedRow<TContract, ModelName, TIncludes>>;
  /** Narrows to a specific variant, injecting a discriminator filter. */
  variant<V extends VariantNames<TContract, ModelName>>(
    variantName: V,
  ): MongoCollection<TContract, ModelName, TIncludes, V>;
  /** Appends equality filters from a plain object. Values are encoded through codecs. */
  where(
    filter: MongoWhereFilter<TContract, ModelName>,
  ): MongoCollection<TContract, ModelName, TIncludes, TVariant>;
  /** Appends a filter condition from a raw filter expression. Comparison and `$in`/`$nin` values on a scalar field are encoded through the field's codec. */
  where(filter: MongoFilterExpr): MongoCollection<TContract, ModelName, TIncludes, TVariant>;
  /** Restricts returned fields to the given subset. Returns a new immutable collection. */
  select(
    ...fields: ModelFieldKeys<TContract, ModelName>[]
  ): MongoCollection<TContract, ModelName, TIncludes, TVariant>;
  /** Adds a `$lookup` for a reference relation. Returns a new immutable collection. */
  include<K extends ReferenceRelationKeys<TContract, ModelName> & string>(
    relationName: K,
  ): MongoCollection<TContract, ModelName, TIncludes & Record<K, true>, TVariant>;
  /** Sets sort order. Returns a new immutable collection. */
  orderBy(
    spec: Partial<Record<ModelFieldKeys<TContract, ModelName>, 1 | -1>>,
  ): MongoCollection<TContract, ModelName, TIncludes, TVariant>;
  /** Limits the number of results. Returns a new immutable collection. */
  limit(n: number): MongoCollection<TContract, ModelName, TIncludes, TVariant>;
  /** Offsets the results by `n`. Returns a new immutable collection. */
  offset(n: number): MongoCollection<TContract, ModelName, TIncludes, TVariant>;
  /** Executes the query and returns all matching rows as an async iterable. */
  all(): AsyncIterableResult<IncludedRow<TContract, ModelName, TIncludes>>;
  /** Executes the query with limit 1. Returns the first matching row or `null`. */
  first(): Promise<IncludedRow<TContract, ModelName, TIncludes> | null>;
  /** Inserts the document and returns it as stored, decoded like a read, without reading it back. */
  create(
    data: ResolvedCreateInput<TContract, ModelName, TVariant>,
  ): Promise<IncludedRow<TContract, ModelName, TIncludes>>;
  /** Inserts the documents and returns them as stored, in input order and decoded like a read, without reading them back. */
  createAll(
    data: ReadonlyArray<ResolvedCreateInput<TContract, ModelName, TVariant>>,
  ): AsyncIterableResult<IncludedRow<TContract, ModelName, TIncludes>>;
  /** Inserts multiple documents and returns the number inserted. */
  createAndCount(
    data: ReadonlyArray<ResolvedCreateInput<TContract, ModelName, TVariant>>,
  ): Promise<number>;
  /** Updates one matching document via `findOneAndUpdate`. Returns the updated document or `null`. Requires `.where()`. */
  update(
    data: Partial<DefaultModelRow<TContract, ModelName>>,
  ): Promise<IncludedRow<TContract, ModelName, TIncludes> | null>;
  /** Updates one matching document using field operations from a callback. Requires `.where()`. */
  update(
    callback: (u: FieldAccessor<TContract, ModelName>) => FieldOperation[],
  ): Promise<IncludedRow<TContract, ModelName, TIncludes> | null>;
  /** Non-atomic: captures matching `_id`s, updates, then re-reads by `_id`. Requires `.where()`. */
  updateAll(
    data: Partial<DefaultModelRow<TContract, ModelName>>,
  ): AsyncIterableResult<IncludedRow<TContract, ModelName, TIncludes>>;
  /** Updates all matching documents using field operations from a callback. Requires `.where()`. */
  updateAll(
    callback: (u: FieldAccessor<TContract, ModelName>) => FieldOperation[],
  ): AsyncIterableResult<IncludedRow<TContract, ModelName, TIncludes>>;
  /** Updates all matching documents and returns the number modified. Requires `.where()`. */
  updateAndCount(data: Partial<DefaultModelRow<TContract, ModelName>>): Promise<number>;
  /** Updates all matching documents using field operations and returns the number modified. Requires `.where()`. */
  updateAndCount(
    callback: (u: FieldAccessor<TContract, ModelName>) => FieldOperation[],
  ): Promise<number>;
  /** Deletes one matching document via `findOneAndDelete`. Returns the deleted document or `null`. Requires `.where()`. */
  delete(): Promise<IncludedRow<TContract, ModelName, TIncludes> | null>;
  /** Non-atomic: reads matching docs then deletes them. Concurrent writes may cause stale results. Requires `.where()`. */
  deleteAll(): AsyncIterableResult<IncludedRow<TContract, ModelName, TIncludes>>;
  /** Deletes all matching documents and returns the number deleted. Requires `.where()`. */
  deleteAndCount(): Promise<number>;
  /**
   * On insert: `update` fields are applied via `$set`, remaining `create` fields via `$setOnInsert`.
   * This means `update` values take precedence over `create` for overlapping fields on insert.
   * A field that `create` sets and that has an update default (such as `temporal.updatedAt()`) keeps the `create` value on insert and advances on update; that case is sent as one upsert with an update pipeline that tells an insert from an update.
   * Requires `.where()`.
   */
  upsert(input: {
    create: ResolvedCreateInput<TContract, ModelName, TVariant>;
    update: Partial<DefaultModelRow<TContract, ModelName>>;
  }): Promise<IncludedRow<TContract, ModelName, TIncludes>>;
  /** Upsert using field operations callback for the update part. Requires `.where()`. */
  upsert(input: {
    create: ResolvedCreateInput<TContract, ModelName, TVariant>;
    update: (u: FieldAccessor<TContract, ModelName>) => FieldOperation[];
  }): Promise<IncludedRow<TContract, ModelName, TIncludes>>;
}

const COMPARISON_OPERATORS: ReadonlySet<string> = new Set([
  '$eq',
  '$ne',
  '$gt',
  '$gte',
  '$lt',
  '$lte',
]);
const MEMBERSHIP_OPERATORS: ReadonlySet<string> = new Set(['$in', '$nin']);

type ValuePurpose = 'write' | 'filter';

function resolveCollectionName(model: MongoModelDefinition, modelName: string): string {
  return model.storage.collection ?? modelName;
}

function topLevelUpdateFields(
  updateDoc: Record<string, Record<string, MongoValue>>,
): ReadonlySet<string> {
  const fields = new Set<string>();
  for (const operatorGroup of Object.values(updateDoc)) {
    for (const fieldPath of Object.keys(operatorGroup)) {
      fields.add(fieldPath.split('.')[0] ?? fieldPath);
    }
  }
  return fields;
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

class MongoCollectionImpl<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
  ModelName extends string & keyof MongoModelsMap<TContract>,
  TIncludes extends MongoIncludeSpec<TContract, ModelName> = NoIncludes,
  TVariant extends string = never,
> implements MongoCollection<TContract, ModelName, TIncludes, TVariant>
{
  readonly #contract: TContract;
  readonly #modelName: ModelName;
  readonly #executor: MongoQueryExecutor;
  readonly #mutationDefaults: MutationDefaults | undefined;
  #collectionName: string;
  #state: MongoCollectionState;
  #variantName: string | undefined;

  constructor(
    contract: TContract,
    modelName: ModelName,
    executor: MongoQueryExecutor,
    mutationDefaults: MutationDefaults | undefined,
  ) {
    this.#contract = contract;
    this.#modelName = modelName;
    this.#executor = executor;
    this.#mutationDefaults = mutationDefaults;
    const model = blindCast<
      MongoModelDefinition,
      'modelName is constrained to Mongo contract model keys but namespace lookup erases storage type'
    >(domainModelsAtDefaultNamespace(contract.domain)[modelName]);
    this.#collectionName = resolveCollectionName(model, modelName);
    this.#state = emptyCollectionState();
  }

  variant<V extends VariantNames<TContract, ModelName>>(
    variantName: V,
  ): MongoCollection<TContract, ModelName, TIncludes, V> {
    const model = blindCast<
      MongoModelDefinition | undefined,
      'Mongo contract model lookup preserves target storage metadata erased by the namespace helper'
    >(domainModelsAtDefaultNamespace(this.#contract.domain)[this.#modelName]);
    if (!model?.discriminator || !model.variants) {
      // No polymorphism metadata on this model — return unchanged. Cast required
      // because TS cannot verify TVariant (the current variant) is assignable to V.
      return blindCast<
        MongoCollection<TContract, ModelName, TIncludes, V>,
        'no-op variant refinement preserves runtime state while changing only the type-level variant'
      >(this);
    }

    const variantEntry = model.variants[variantName];
    if (!variantEntry) {
      // Unknown variant name at runtime — return unchanged. Same cast rationale.
      return blindCast<
        MongoCollection<TContract, ModelName, TIncludes, V>,
        'unknown variant fallback preserves runtime state while changing only the type-level variant'
      >(this);
    }

    const filter = MongoFieldFilter.eq(
      model.discriminator.field,
      new MongoParamRef(variantEntry.value),
    );
    return this.#cloneWithVariant<V>({ filters: [...this.#state.filters, filter] }, variantName);
  }

  where(
    filter: MongoWhereFilter<TContract, ModelName> | MongoFilterExpr,
  ): MongoCollection<TContract, ModelName, TIncludes, TVariant> {
    if (isMongoFilterExpr(filter)) {
      const encoded = filter.rewrite({
        field: (fieldFilter) => this.#encodeFieldFilter(fieldFilter),
      });
      return this.#clone({ filters: [...this.#state.filters, encoded] });
    }
    const compiled = this.#compileWhereObject(
      blindCast<
        Record<string, unknown>,
        'typed Mongo where input is a model-field value record after filter-expression narrowing'
      >(filter),
    );
    return this.#clone({ filters: [...this.#state.filters, ...compiled] });
  }

  select(
    ...fields: ModelFieldKeys<TContract, ModelName>[]
  ): MongoCollection<TContract, ModelName, TIncludes, TVariant> {
    return this.#clone({ selectedFields: [...(this.#state.selectedFields ?? []), ...fields] });
  }

  include<K extends ReferenceRelationKeys<TContract, ModelName> & string>(
    relationName: K,
  ): MongoCollection<TContract, ModelName, TIncludes & Record<K, true>, TVariant> {
    const model = blindCast<
      MongoModelDefinition,
      'modelName is constrained to Mongo contract model keys but namespace lookup erases storage type'
    >(domainModelsAtDefaultNamespace(this.#contract.domain)[this.#modelName]);
    const relation = model.relations?.[relationName];
    if (!relation) {
      throw ormError(
        'ORM.RELATION_UNKNOWN',
        `Unknown relation "${relationName}" on model "${this.#modelName}"`,
        { meta: { model: this.#modelName, relation: relationName } },
      );
    }

    if (!('on' in relation)) {
      throw ormError(
        'ORM.INCLUDE_UNSUPPORTED',
        `Relation "${relationName}" is an embed relation — only reference relations can be included`,
        { meta: { model: this.#modelName, relation: relationName } },
      );
    }

    const ref: ContractReferenceRelation = relation;
    const localField = ref.on.localFields[0];
    const foreignField = ref.on.targetFields[0];
    if (
      !localField ||
      !foreignField ||
      ref.on.localFields.length !== 1 ||
      ref.on.targetFields.length !== 1
    ) {
      throw ormError(
        'ORM.INCLUDE_UNSUPPORTED',
        `Compound references are not yet supported: relation "${relationName}"`,
        { meta: { model: this.#modelName, relation: relationName } },
      );
    }

    const targetModelName = ref.to.model;
    const targetModel = castAs<MongoModelDefinition | undefined>(
      domainModelsAtDefaultNamespace(this.#contract.domain)[targetModelName],
    );
    if (!targetModel) {
      throw new InternalError(
        `Target model "${targetModelName}" not found for relation "${relationName}"`,
      );
    }

    const includeExpr: MongoIncludeExpr = {
      relationName,
      targetModel,
      from: resolveCollectionName(targetModel, targetModelName),
      localField,
      foreignField,
      cardinality: ref.cardinality,
    };

    return blindCast<
      MongoCollection<TContract, ModelName, TIncludes & Record<K, true>, TVariant>,
      'include clone state contains the appended relation but the generic include refinement is not inferred'
    >(
      this.#clone({
        includes: [...this.#state.includes, includeExpr],
      }),
    );
  }

  orderBy(
    spec: Partial<Record<ModelFieldKeys<TContract, ModelName>, 1 | -1>>,
  ): MongoCollection<TContract, ModelName, TIncludes, TVariant> {
    const merged: Readonly<Record<string, 1 | -1>> = { ...this.#state.orderBy, ...spec };
    return this.#clone({ orderBy: merged });
  }

  limit(n: number): MongoCollection<TContract, ModelName, TIncludes, TVariant> {
    return this.#clone({ limit: n });
  }

  offset(n: number): MongoCollection<TContract, ModelName, TIncludes, TVariant> {
    return this.#clone({ offset: n });
  }

  all(): AsyncIterableResult<IncludedRow<TContract, ModelName, TIncludes>> {
    return this.#query();
  }

  async first(): Promise<IncludedRow<TContract, ModelName, TIncludes> | null> {
    const limited = this.#clone({ limit: 1 });
    const result = limited.#query();
    for await (const row of result) {
      return row;
    }
    return null;
  }

  async create(
    data: ResolvedCreateInput<TContract, ModelName, TVariant>,
  ): Promise<IncludedRow<TContract, ModelName, TIncludes>> {
    this.#rejectIncludes('create');
    const normalized = this.#withCreateDefaults(
      this.#injectDiscriminator(
        this.#stripUndefined(
          blindCast<
            Record<string, unknown>,
            'resolved Mongo create input is a model-field value record'
          >(data),
        ),
      ),
      new Map(),
    );
    const document = this.#toDocument(normalized);
    const command = new InsertOneCommand(this.#collectionName, document);
    const results = await this.#drainPlan(command, this.#insertOneResultShape());
    return blindCast<
      IncludedRow<TContract, ModelName, TIncludes>,
      'the insert result carries the written document, decoded through the model result shape like a read'
    >(
      blindCast<InsertOneResult, 'InsertOneCommand yields one InsertOneResult'>(results[0])
        .document,
    );
  }

  createAll(
    data: ReadonlyArray<ResolvedCreateInput<TContract, ModelName, TVariant>>,
  ): AsyncIterableResult<IncludedRow<TContract, ModelName, TIncludes>> {
    this.#rejectIncludes('createAll');
    const self = this;
    async function* gen(): AsyncGenerator<IncludedRow<TContract, ModelName, TIncludes>> {
      const defaultValueCache = new Map<string, unknown>();
      const normalizedRows = data.map((d) =>
        self.#withCreateDefaults(
          self.#injectDiscriminator(
            self.#stripUndefined(
              blindCast<
                Record<string, unknown>,
                'resolved Mongo create-all input is a model-field value record'
              >(d),
            ),
          ),
          defaultValueCache,
        ),
      );
      const command = new InsertManyCommand(
        self.#collectionName,
        normalizedRows.map((d) => self.#toDocument(d)),
      );
      const results = await self.#drainPlan(command, self.#insertManyResultShape());
      const { documents } = blindCast<
        InsertManyResult,
        'InsertManyCommand yields one InsertManyResult'
      >(results[0]);
      for (const document of documents) {
        yield blindCast<
          IncludedRow<TContract, ModelName, TIncludes>,
          'the insert result carries the written documents, decoded through the model result shape like a read'
        >(document);
      }
    }
    return new AsyncIterableResult(gen());
  }

  async createAndCount(
    data: ReadonlyArray<ResolvedCreateInput<TContract, ModelName, TVariant>>,
  ): Promise<number> {
    this.#rejectIncludes('createAndCount');
    const defaultValueCache = new Map<string, unknown>();
    const documents = data.map((d) =>
      this.#toDocument(
        this.#withCreateDefaults(
          this.#injectDiscriminator(
            this.#stripUndefined(
              blindCast<
                Record<string, unknown>,
                'resolved Mongo create-and-count input is a model-field value record'
              >(d),
            ),
          ),
          defaultValueCache,
        ),
      ),
    );
    const command = new InsertManyCommand(this.#collectionName, documents);
    const results = await this.#drainPlan(command);
    return blindCast<
      { insertedCount: number },
      'InsertManyCommand runtime result exposes insertedCount'
    >(results[0]).insertedCount;
  }

  async update(
    dataOrCallback:
      | Partial<DefaultModelRow<TContract, ModelName>>
      | ((u: FieldAccessor<TContract, ModelName>) => FieldOperation[]),
  ): Promise<IncludedRow<TContract, ModelName, TIncludes> | null> {
    this.#requireFilters('update');
    this.#rejectWindowing('update');
    this.#rejectIncludes('update');
    const filter = this.#mergeFilters();
    const updateDoc = this.#withUpdateDefaults(this.#resolveUpdateDoc(dataOrCallback), new Map());
    const command = new FindOneAndUpdateCommand(this.#collectionName, filter, updateDoc, false);
    const results = await this.#drainPlan(command, this.#modelResultShape());
    const result = results[0];
    return result === undefined
      ? null
      : blindCast<
          IncludedRow<TContract, ModelName, TIncludes>,
          'FindOneAndUpdateCommand plan carries the model resultShape; the runtime decodes the returned document like a read'
        >(result);
  }

  updateAll(
    dataOrCallback:
      | Partial<DefaultModelRow<TContract, ModelName>>
      | ((u: FieldAccessor<TContract, ModelName>) => FieldOperation[]),
  ): AsyncIterableResult<IncludedRow<TContract, ModelName, TIncludes>> {
    this.#requireFilters('updateAll');
    this.#rejectWindowing('updateAll');
    const self = this;
    async function* gen(): AsyncGenerator<IncludedRow<TContract, ModelName, TIncludes>> {
      const ids = await self.#readMatchingIds();
      if (ids.length === 0) return;

      const filter = self.#mergeFilters();
      const updateDoc = self.#withUpdateDefaults(self.#resolveUpdateDoc(dataOrCallback), new Map());
      const command = new UpdateManyCommand(self.#collectionName, filter, updateDoc);
      await self.#drainPlan(command);

      const idFilter = MongoFieldFilter.in(
        '_id',
        ids.map((id) => new MongoParamRef(id)),
      );
      yield* self.#clone({ filters: [idFilter] }).#query();
    }
    return new AsyncIterableResult(gen());
  }

  async updateAndCount(
    dataOrCallback:
      | Partial<DefaultModelRow<TContract, ModelName>>
      | ((u: FieldAccessor<TContract, ModelName>) => FieldOperation[]),
  ): Promise<number> {
    this.#requireFilters('updateAndCount');
    this.#rejectWindowing('updateAndCount');
    this.#rejectIncludes('updateAndCount');
    const filter = this.#mergeFilters();
    const updateDoc = this.#withUpdateDefaults(this.#resolveUpdateDoc(dataOrCallback), new Map());
    const command = new UpdateManyCommand(this.#collectionName, filter, updateDoc);
    const stats = await this.#executePlan(command);
    return stats.affectedRows;
  }

  async delete(): Promise<IncludedRow<TContract, ModelName, TIncludes> | null> {
    this.#requireFilters('delete');
    this.#rejectWindowing('delete');
    this.#rejectIncludes('delete');
    const filter = this.#mergeFilters();
    const command = new FindOneAndDeleteCommand(this.#collectionName, filter);
    const results = await this.#drainPlan(command, this.#modelResultShape());
    const result = results[0];
    return result === undefined
      ? null
      : blindCast<
          IncludedRow<TContract, ModelName, TIncludes>,
          'FindOneAndDeleteCommand plan carries the model resultShape; the runtime decodes the returned document like a read'
        >(result);
  }

  deleteAll(): AsyncIterableResult<IncludedRow<TContract, ModelName, TIncludes>> {
    this.#requireFilters('deleteAll');
    this.#rejectWindowing('deleteAll');
    const self = this;
    async function* gen(): AsyncGenerator<IncludedRow<TContract, ModelName, TIncludes>> {
      const docs: IncludedRow<TContract, ModelName, TIncludes>[] = [];
      for await (const row of self.#query()) {
        docs.push(row);
      }
      const filter = self.#mergeFilters();
      const command = new DeleteManyCommand(self.#collectionName, filter);
      await self.#drainPlan(command);
      yield* docs;
    }
    return new AsyncIterableResult(gen());
  }

  async deleteAndCount(): Promise<number> {
    this.#requireFilters('deleteAndCount');
    this.#rejectWindowing('deleteAndCount');
    this.#rejectIncludes('deleteAndCount');
    const filter = this.#mergeFilters();
    const command = new DeleteManyCommand(this.#collectionName, filter);
    const stats = await this.#executePlan(command);
    return stats.affectedRows;
  }

  async upsert(input: {
    create: ResolvedCreateInput<TContract, ModelName, TVariant>;
    update:
      | Partial<DefaultModelRow<TContract, ModelName>>
      | ((u: FieldAccessor<TContract, ModelName>) => FieldOperation[]);
  }): Promise<IncludedRow<TContract, ModelName, TIncludes>> {
    this.#requireFilters('upsert');
    this.#rejectWindowing('upsert');
    this.#rejectIncludes('upsert');
    const filter = this.#mergeFilters();
    const defaultValueCache = new Map<string, unknown>();

    const explicitCreate = this.#injectDiscriminator(
      this.#stripUndefined(
        blindCast<
          Record<string, unknown>,
          'resolved Mongo upsert create input is a model-field value record'
        >(input.create),
      ),
    );
    const allCreateFields = this.#toDocument(
      this.#withCreateDefaults(explicitCreate, defaultValueCache),
    );

    let updateDoc: Record<string, Record<string, MongoValue>>;
    if (typeof input.update === 'function') {
      const accessor = createFieldAccessor<TContract, ModelName>();
      const ops = input.update(accessor);
      const idOp = ops.find((op) => op.field === '_id');
      if (idOp) {
        throw ormError('ORM.FIELD_IMMUTABLE', 'Mutation payloads cannot modify `_id`', {
          meta: { field: '_id' },
        });
      }
      const dotPathOp = ops.find((op) => op.field.includes('.'));
      if (dotPathOp) {
        throw ormError(
          'ORM.OPERATION_UNSUPPORTED',
          `upsert() does not support dot-path field operations (found "${dotPathOp.field}"). ` +
            'Dot-path updates conflict with $setOnInsert on the insert path, producing incomplete documents. ' +
            'Use top-level field operations instead.',
          { meta: { method: 'upsert', field: dotPathOp.field } },
        );
      }
      updateDoc = compileFieldOperations(ops, (field, value, operator) =>
        this.#wrapFieldOpValue(field, value, operator),
      );
    } else {
      const setFields = this.#toSetFields(
        blindCast<
          Record<string, unknown>,
          'resolved Mongo upsert update input is a partial model-field value record'
        >(input.update),
      );
      updateDoc = {};
      if (Object.keys(setFields).length > 0) {
        updateDoc['$set'] = setFields;
      }
    }

    const explicitUpdateFields = topLevelUpdateFields(updateDoc);
    const withUpdateDefaults = this.#withUpdateDefaults(updateDoc, defaultValueCache);
    const generatedSetByCreate = Object.keys(withUpdateDefaults['$set'] ?? {}).filter(
      (field) => !explicitUpdateFields.has(field) && Object.hasOwn(explicitCreate, field),
    );
    if (generatedSetByCreate.length === 0) {
      return this.#upsertCommand(filter, withUpdateDefaults, allCreateFields);
    }

    const results = await this.#drainPlan(
      new FindOneAndUpdateCommand(
        this.#collectionName,
        filter,
        upsertPipeline({
          filter,
          update: withUpdateDefaults,
          create: allCreateFields,
          createWins: new Set(generatedSetByCreate),
        }),
        true,
      ),
      this.#modelResultShape(),
    );
    return blindCast<
      IncludedRow<TContract, ModelName, TIncludes>,
      'FindOneAndUpdateCommand upsert plan carries the model resultShape; the runtime decodes the returned document like a read'
    >(results[0]);
  }

  async #upsertCommand(
    filter: MongoFilterExpr,
    updateDoc: Record<string, Record<string, MongoValue>>,
    allCreateFields: Record<string, MongoValue>,
  ): Promise<IncludedRow<TContract, ModelName, TIncludes>> {
    const updatedFields = topLevelUpdateFields(updateDoc);
    const insertOnlyFields: Record<string, MongoValue> = {};
    for (const [key, value] of Object.entries(allCreateFields)) {
      if (!updatedFields.has(key)) {
        insertOnlyFields[key] = value;
      }
    }
    const command = new FindOneAndUpdateCommand(
      this.#collectionName,
      filter,
      Object.keys(insertOnlyFields).length > 0
        ? { ...updateDoc, $setOnInsert: insertOnlyFields }
        : updateDoc,
      true,
    );
    const results = await this.#drainPlan(command, this.#modelResultShape());
    return blindCast<
      IncludedRow<TContract, ModelName, TIncludes>,
      'FindOneAndUpdateCommand upsert plan carries the model resultShape; the runtime decodes the returned document like a read'
    >(results[0]);
  }

  async #readMatchingIds(): Promise<unknown[]> {
    const idQuery = this.#clone({
      includes: [],
      selectedFields: ['_id'],
      orderBy: undefined,
      limit: undefined,
      offset: undefined,
    });
    const ids: unknown[] = [];
    // Strip resultShape so the runtime yields wire-level _id values (e.g. ObjectId)
    // rather than decoded hex strings. The follow-up $in filter in updateAll wraps
    // these in bare MongoParamRefs with no codecId; round-tripping a decoded string
    // back through the adapter would require attaching the field's codecId, which
    // we don't do here. Do not "tidy" the destructure away — the prefetch+modify+
    // re-read flow depends on it.
    const { resultShape: _rs, ...planWithoutShape } = idQuery.#compile();
    for await (const row of this.#executor.query(planWithoutShape)) {
      const storageRow = blindCast<
        Record<string, unknown>,
        'Mongo id-prefetch plan without resultShape yields a raw storage row containing _id'
      >(row);
      ids.push(storageRow['_id']);
    }
    return ids;
  }

  #query(): AsyncIterableResult<IncludedRow<TContract, ModelName, TIncludes>> {
    const plan = this.#compile();
    return this.#executor.query(plan);
  }

  #compile(): MongoQueryPlan<IncludedRow<TContract, ModelName, TIncludes>> {
    const model = this.#modelWithVariantFields();
    if (!model) {
      throw ormError('ORM.MODEL_UNKNOWN', `Unknown model: "${this.#modelName}".`, {
        meta: { model: this.#modelName },
      });
    }
    return compileMongoQuery<IncludedRow<TContract, ModelName, TIncludes>>(
      this.#collectionName,
      this.#state,
      this.#contract.storage.storageHash,
      model,
      this.#valueObjects(),
    );
  }

  #wrapCommand(command: AnyMongoCommand, resultShape?: MongoResultShape): MongoQueryPlan<unknown> {
    return {
      collection: this.#collectionName,
      command,
      meta: this.#planMeta(),
      ...ifDefined('resultShape', resultShape),
    };
  }

  #executePlan(command: AnyMongoCommand): Promise<RuntimeStatementStats> {
    return this.#executor.execute(this.#wrapCommand(command));
  }

  async #drainPlan(command: AnyMongoCommand, resultShape?: MongoResultShape): Promise<unknown[]> {
    const plan = this.#wrapCommand(command, resultShape);
    const result = this.#executor.query(plan);
    const rows: unknown[] = [];
    for await (const row of result) {
      rows.push(row);
    }
    return rows;
  }

  #modelFields(): Record<string, ContractField> {
    return this.#modelWithVariantFields()?.fields ?? {};
  }

  #modelWithVariantFields(): MongoModelDefinition | undefined {
    const models = domainModelsAtDefaultNamespace(this.#contract.domain);
    const model = blindCast<
      MongoModelDefinition | undefined,
      'Mongo contract model lookup preserves target storage metadata erased by the namespace helper'
    >(models[this.#modelName]);
    if (model === undefined || this.#variantName === undefined) return model;
    const variant = blindCast<
      MongoModelDefinition | undefined,
      'a variant name is the name of the variant model in the same namespace'
    >(models[this.#variantName]);
    return variant === undefined
      ? model
      : { ...model, fields: { ...model.fields, ...variant.fields } };
  }

  #idFieldShape(): MongoFieldShape {
    const idField = this.#modelFields()['_id'];
    return idField
      ? contractFieldToMongoFieldShape(idField)
      : Object.freeze({ kind: 'unknown' as const });
  }

  #insertOneResultShape(): MongoResultShape {
    return freezeMongoResultShape({
      kind: 'document',
      fields: { insertedId: this.#idFieldShape(), document: this.#documentShape() },
    });
  }

  #insertManyResultShape(): MongoResultShape {
    return freezeMongoResultShape({
      kind: 'document',
      fields: {
        insertedIds: { kind: 'array', nullable: false, element: this.#idFieldShape() },
        documents: { kind: 'array', nullable: false, element: this.#documentShape() },
      },
    });
  }

  #documentShape(): MongoFieldShape {
    const shape = this.#modelResultShape();
    return shape.kind === 'document'
      ? { kind: 'document', nullable: false, fields: shape.fields, row: true }
      : { kind: 'unknown' };
  }

  #modelResultShape(): MongoResultShape {
    const model = this.#modelWithVariantFields();
    if (!model) {
      return Object.freeze({ kind: 'unknown' as const });
    }
    return contractModelToMongoResultShape(model, { valueObjects: this.#valueObjects() });
  }

  #valueObjects(): Readonly<Record<string, ContractValueObject>> {
    return domainValueObjectsAtDefaultNamespace(this.#contract.domain) ?? {};
  }

  #compileWhereObject(data: Record<string, unknown>): MongoFilterExpr[] {
    const fields = this.#modelFields();
    const filters: MongoFilterExpr[] = [];
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue;
      const wrapped = this.#wrapFieldValue(value, fields[key], key, 'filter');
      filters.push(MongoFieldFilter.eq(key, wrapped));
    }
    return filters;
  }

  /**
   * Encodes the comparison values of a filter on a scalar field through the field's codec, as the object form of `where` and every update does. Without it a driver class such as an `ObjectId` would be copied into a plain object and match nothing.
   */
  #encodeFieldFilter(filter: MongoFieldFilter): MongoFieldFilter {
    const field = this.#fieldAtPath(filter.field);
    if (field?.type.kind !== 'scalar') return filter;
    const encode = (value: MongoValue): MongoValue => {
      if (value instanceof MongoParamRef) {
        return value.codecId === undefined
          ? this.#wrapFieldValue(value.value, field, filter.field, 'filter')
          : value;
      }
      if (field.many === true && Array.isArray(value)) return value.map(encode);
      return this.#wrapFieldValue(value, field, filter.field, 'filter');
    };
    if (COMPARISON_OPERATORS.has(filter.op)) {
      return MongoFieldFilter.of(filter.field, filter.op, encode(filter.value));
    }
    if (MEMBERSHIP_OPERATORS.has(filter.op) && Array.isArray(filter.value)) {
      return MongoFieldFilter.of(filter.field, filter.op, filter.value.map(encode));
    }
    return filter;
  }

  #fieldAtPath(path: string): ContractField | undefined {
    const [head, ...rest] = path.split('.');
    let field: ContractField | undefined =
      head === undefined ? undefined : this.#modelFields()[head];
    for (const segment of rest) {
      if (field?.type.kind !== 'valueObject') return undefined;
      field = domainValueObjectsAtDefaultNamespace(this.#contract.domain)?.[field.type.name]
        ?.fields[segment];
    }
    return field;
  }

  /**
   * A value written to a field is checked against the field's enum and must not be `null` unless the field is nullable; a value compared in a filter is not, so a filter can find stored values the contract does not allow.
   */
  #wrapFieldValue(
    value: unknown,
    field: ContractField | undefined,
    path: string,
    purpose: ValuePurpose,
  ): MongoValue {
    if (field === undefined) return new MongoParamRef(value);
    if (value === null) return this.#nullParam(field, path, purpose);

    if (field.type.kind === 'scalar') {
      if (purpose === 'write') this.#assertEnumValues(field, value, path);
      return this.#scalarParam(value, field, path);
    }

    if (field.type.kind === 'valueObject') {
      const voName = field.type.name;
      const voDef = domainValueObjectsAtDefaultNamespace(this.#contract.domain)?.[voName];
      if (!voDef) return new MongoParamRef(value);

      if (field.many && Array.isArray(value)) {
        return value.map((item, index) =>
          this.#wrapValueObject(
            blindCast<
              Record<string, unknown>,
              'contract-typed value-object array elements are field-value records'
            >(item),
            voDef,
            `${path}.${index}`,
            purpose,
          ),
        );
      }
      return this.#wrapValueObject(
        blindCast<
          Record<string, unknown>,
          'contract-typed value-object input is a field-value record'
        >(value),
        voDef,
        path,
        purpose,
      );
    }

    return new MongoParamRef(value);
  }

  #nullParam(field: ContractField, path: string, purpose: ValuePurpose): MongoParamRef {
    if (purpose === 'write' && !field.nullable) {
      throw runtimeError(
        'RUNTIME.ENCODE_FAILED',
        `Failed to encode field ${path} in collection '${this.#collectionName}': the field is required and cannot be null`,
        { label: path, collection: this.#collectionName },
      );
    }
    return new MongoParamRef(null);
  }

  /**
   * A contract without a collection validator (TypeScript builder, Prisma 6 schema) stores whatever reaches the driver, so a value outside the field's enum is refused here.
   */
  #assertEnumValues(field: ContractField, value: unknown, path: string): void {
    const valueSet = field.valueSet;
    if (valueSet === undefined || valueSet.entityKind !== 'enum' || value === null) return;
    const contractEnum =
      this.#contract.domain.namespaces[valueSet.namespaceId]?.enum?.[valueSet.entityName];
    if (contractEnum === undefined) return;
    const allowed = contractEnum.members.map((member) => member.value);
    const values = field.many === true && Array.isArray(value) ? value : [value];
    const outside = values.find((entry) => !allowed.includes(entry));
    if (outside === undefined) return;
    const quoted = allowed.map((entry) => JSON.stringify(entry));
    const list =
      quoted.length > 1
        ? `${quoted.slice(0, -1).join(', ')} and ${quoted.at(-1)}`
        : quoted.join('');
    throw runtimeError(
      'RUNTIME.ENCODE_FAILED',
      `Failed to encode field ${path} in collection '${this.#collectionName}': ${JSON.stringify(outside)} is not a value of enum ${valueSet.entityName}; the values are ${list}`,
      { label: path, collection: this.#collectionName, received: outside, allowed },
    );
  }

  /**
   * A scalar field's value as parameters: a list field's array is encoded element by element through the element codec, so the codec never sees the whole list.
   */
  #scalarParam(value: unknown, field: ContractField, path: string): MongoValue {
    if (field.type.kind !== 'scalar') return new MongoParamRef(value);
    const codecId = field.type.codecId;
    if (field.many === true && Array.isArray(value)) {
      return value.map((element, index) => this.#fieldParam(element, codecId, `${path}.${index}`));
    }
    return this.#fieldParam(value, codecId, path);
  }

  #fieldParam(value: unknown, codecId: string, path: string): MongoParamRef {
    return new MongoParamRef(value, { codecId, name: path, collection: this.#collectionName });
  }

  #wrapValueObject(
    data: Record<string, unknown>,
    voDef: ContractValueObject,
    path: string,
    purpose: ValuePurpose,
  ): Record<string, MongoValue> {
    const doc: Record<string, MongoValue> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue;
      const fieldDef = voDef.fields[key];
      doc[key] = this.#wrapFieldValue(value, fieldDef, `${path}.${key}`, purpose);
    }
    return doc;
  }

  #toDocument(data: Record<string, unknown>): Record<string, MongoValue> {
    const fields = this.#modelFields();
    const doc: Record<string, MongoValue> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) {
        doc[key] = this.#wrapFieldValue(value, fields[key], key, 'write');
      }
    }
    return doc;
  }

  #toSetFields(data: Record<string, unknown>): Record<string, MongoValue> {
    const fields = this.#modelFields();
    const result: Record<string, MongoValue> = {};
    for (const [key, value] of Object.entries(data)) {
      if (key === '_id' && value !== undefined) {
        throw ormError('ORM.FIELD_IMMUTABLE', 'Mutation payloads cannot modify `_id`', {
          meta: { field: '_id' },
        });
      }
      if (value !== undefined) {
        result[key] = this.#wrapFieldValue(value, fields[key], key, 'write');
      }
    }
    return result;
  }

  #appliedDefaults(
    op: MutationDefaultsOp,
    values: Readonly<Record<string, unknown>>,
    defaultValueCache: Map<string, unknown>,
  ): Record<string, unknown> {
    const applied =
      this.#mutationDefaults?.applyMutationDefaults({
        op,
        namespace: UNBOUND_NAMESPACE_ID,
        entry: this.#collectionName,
        values,
        defaultValueCache,
      }) ?? [];
    return Object.fromEntries(applied.map(({ field, value }) => [field, value]));
  }

  #withCreateDefaults(
    values: Record<string, unknown>,
    defaultValueCache: Map<string, unknown>,
  ): Record<string, unknown> {
    return { ...values, ...this.#appliedDefaults('create', values, defaultValueCache) };
  }

  #withUpdateDefaults(
    updateDoc: Record<string, Record<string, MongoValue>>,
    defaultValueCache: Map<string, unknown>,
  ): Record<string, Record<string, MongoValue>> {
    const explicit = Object.fromEntries(
      [...topLevelUpdateFields(updateDoc)].map((field) => [field, true]),
    );
    const generated = this.#appliedDefaults('update', explicit, defaultValueCache);
    if (Object.keys(generated).length === 0) {
      return updateDoc;
    }
    return { ...updateDoc, $set: { ...updateDoc['$set'], ...this.#toSetFields(generated) } };
  }

  #stripUndefined(data: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) {
        result[key] = value;
      }
    }
    return result;
  }

  #toUpdateDocument(data: Record<string, unknown>): Record<string, Record<string, MongoValue>> {
    return { $set: this.#toSetFields(data) };
  }

  #resolveUpdateDoc(
    dataOrCallback:
      | Partial<DefaultModelRow<TContract, ModelName>>
      | ((u: FieldAccessor<TContract, ModelName>) => FieldOperation[]),
  ): Record<string, Record<string, MongoValue>> {
    if (typeof dataOrCallback === 'function') {
      const accessor = createFieldAccessor<TContract, ModelName>();
      const ops = dataOrCallback(accessor);
      const idOp = ops.find((op) => op.field === '_id');
      if (idOp) {
        throw ormError('ORM.FIELD_IMMUTABLE', 'Mutation payloads cannot modify `_id`', {
          meta: { field: '_id' },
        });
      }
      if (ops.length === 0) {
        return { $set: {} };
      }
      return compileFieldOperations(ops, (field, value, operator) =>
        this.#wrapFieldOpValue(field, value, operator),
      );
    }
    return this.#toUpdateDocument(
      blindCast<
        Record<string, unknown>,
        'partial Mongo update input is a model-field value record after callback narrowing'
      >(dataOrCallback),
    );
  }

  /**
   * `$set` carries the field's whole value; `$push`, `$addToSet`, `$pull`, `$inc` and `$mul` carry one element or number; `$pop` and `$unset` carry no field value and are not encoded.
   */
  #wrapFieldOpValue(path: string, value: MongoValue, operator: UpdateOperator): MongoValue {
    if (operator === '$unset' || operator === '$pop' || !(value instanceof MongoParamRef)) {
      return value;
    }
    const field = this.#fieldAtPath(path);
    if (field === undefined) return value;
    if (operator === '$set') return this.#wrapFieldValue(value.value, field, path, 'write');
    if (operator === '$pull') return this.#wrapFieldValue(value.value, field, path, 'filter');
    if (field.type.kind === 'scalar') {
      this.#assertEnumValues(field, field.many === true ? [value.value] : value.value, path);
      return this.#fieldParam(value.value, field.type.codecId, path);
    }
    if (field.type.kind === 'valueObject' && isUnknownRecord(value.value)) {
      const voDef = domainValueObjectsAtDefaultNamespace(this.#contract.domain)?.[field.type.name];
      if (voDef) return this.#wrapValueObject(value.value, voDef, path, 'write');
    }
    return value;
  }

  #mergeFilters(): MongoFilterExpr {
    const [single] = this.#state.filters;
    if (this.#state.filters.length === 1 && single) {
      return single;
    }
    return MongoAndExpr.of([...this.#state.filters]);
  }

  #requireFilters(methodName: string): void {
    if (this.#state.filters.length === 0) {
      throw ormError(
        'ORM.WHERE_MISSING',
        `${methodName}() requires a .where() filter. Call .where() before .${methodName}()`,
        { meta: { method: methodName } },
      );
    }
  }

  #rejectWindowing(methodName: string): void {
    if (
      this.#state.orderBy !== undefined ||
      this.#state.limit !== undefined ||
      this.#state.offset !== undefined
    ) {
      throw ormError(
        'ORM.OPERATION_UNSUPPORTED',
        `${methodName}() does not support orderBy/offset/limit. Remove windowing before calling .${methodName}()`,
        { meta: { method: methodName, reason: 'windowing' } },
      );
    }
  }

  #rejectIncludes(methodName: string): void {
    if (this.#state.includes.length > 0) {
      throw ormError(
        'ORM.OPERATION_UNSUPPORTED',
        `${methodName}() does not support .include(). Remove includes before calling .${methodName}()`,
        { meta: { method: methodName, reason: 'includes' } },
      );
    }
  }

  #planMeta(): PlanMeta {
    return {
      target: 'mongo',
      storageHash: this.#contract.storage.storageHash,
      lane: 'mongo-orm',
    };
  }

  #injectDiscriminator(data: Record<string, unknown>): Record<string, unknown> {
    if (!this.#variantName) return data;
    const model = blindCast<
      MongoModelDefinition | undefined,
      'Mongo contract model lookup preserves target storage metadata erased by the namespace helper'
    >(domainModelsAtDefaultNamespace(this.#contract.domain)[this.#modelName]);
    if (!model?.discriminator || !model.variants) return data;
    const variantEntry = model.variants[this.#variantName];
    if (!variantEntry) return data;
    return { ...data, [model.discriminator.field]: variantEntry.value };
  }

  #clone(
    overrides: Partial<MongoCollectionState>,
  ): MongoCollectionImpl<TContract, ModelName, TIncludes, TVariant> {
    const instance = new MongoCollectionImpl<TContract, ModelName, TIncludes, TVariant>(
      this.#contract,
      this.#modelName,
      this.#executor,
      this.#mutationDefaults,
    );
    instance.#state = { ...this.#state, ...overrides };
    instance.#collectionName = this.#collectionName;
    instance.#variantName = this.#variantName;
    return instance;
  }

  #cloneWithVariant<VNew extends string>(
    overrides: Partial<MongoCollectionState>,
    variantName: string,
  ): MongoCollectionImpl<TContract, ModelName, TIncludes, VNew> {
    const instance = new MongoCollectionImpl<TContract, ModelName, TIncludes, VNew>(
      this.#contract,
      this.#modelName,
      this.#executor,
      this.#mutationDefaults,
    );
    instance.#state = { ...this.#state, ...overrides };
    instance.#collectionName = this.#collectionName;
    instance.#variantName = variantName;
    return instance;
  }
}

export function createMongoCollection<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
  ModelName extends string & keyof MongoModelsMap<TContract>,
>(
  contract: TContract,
  modelName: ModelName,
  executor: MongoQueryExecutor,
  mutationDefaults?: MutationDefaults,
): MongoCollection<TContract, ModelName> {
  return new MongoCollectionImpl(contract, modelName, executor, mutationDefaults);
}
