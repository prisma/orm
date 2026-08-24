import {
  type ContractField,
  type ContractReferenceRelation,
  type ContractValueObject,
  domainModelsAtDefaultNamespace,
  domainValueObjectsAtDefaultNamespace,
  type PlanMeta,
} from '@internal/contract/types';
import {
  AsyncIterableResult,
  type RuntimeStatementStats,
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
import type { MongoIncludeExpr } from './collection-state';
import { emptyCollectionState, type MongoCollectionState } from './collection-state';
import { compileMongoQuery } from './compile';
import type { MongoQueryExecutor } from './executor';
import {
  compileFieldOperations,
  createFieldAccessor,
  type FieldAccessor,
  type FieldOperation,
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
  /** Narrows to a specific variant, injecting a discriminator filter. */
  variant<V extends VariantNames<TContract, ModelName>>(
    variantName: V,
  ): MongoCollection<TContract, ModelName, TIncludes, V>;
  /** Appends equality filters from a plain object. Values are encoded through codecs. */
  where(
    filter: MongoWhereFilter<TContract, ModelName>,
  ): MongoCollection<TContract, ModelName, TIncludes, TVariant>;
  /** Appends a filter condition from a raw filter expression. */
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
  /** Returns the input data with the server-assigned `_id`. Does not re-read the stored document. */
  create(
    data: ResolvedCreateInput<TContract, ModelName, TVariant>,
  ): Promise<IncludedRow<TContract, ModelName, TIncludes>>;
  /** Returns input rows with server-assigned `_id`s. Does not re-read stored documents. */
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

function resolveCollectionName(model: MongoModelDefinition, modelName: string): string {
  return model.storage.collection ?? modelName;
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
  #collectionName: string;
  #state: MongoCollectionState;
  #variantName: string | undefined;

  constructor(contract: TContract, modelName: ModelName, executor: MongoQueryExecutor) {
    this.#contract = contract;
    this.#modelName = modelName;
    this.#executor = executor;
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
      return this.#clone({ filters: [...this.#state.filters, filter] });
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
    const normalized = this.#injectDiscriminator(
      this.#stripUndefined(
        blindCast<
          Record<string, unknown>,
          'resolved Mongo create input is a model-field value record'
        >(data),
      ),
    );
    const document = this.#toDocument(normalized);
    const command = new InsertOneCommand(this.#collectionName, document);
    const results = await this.#drainPlan(command, this.#insertOneResultShape());
    const insertedId = blindCast<
      { insertedId: unknown },
      'InsertOneCommand runtime result exposes the server-assigned insertedId, decoded via the _id codec'
    >(results[0]).insertedId;
    return blindCast<
      IncludedRow<TContract, ModelName, TIncludes>,
      'created row combines resolved model input with the server-assigned _id'
    >({ _id: insertedId, ...normalized });
  }

  createAll(
    data: ReadonlyArray<ResolvedCreateInput<TContract, ModelName, TVariant>>,
  ): AsyncIterableResult<IncludedRow<TContract, ModelName, TIncludes>> {
    this.#rejectIncludes('createAll');
    const self = this;
    async function* gen(): AsyncGenerator<IncludedRow<TContract, ModelName, TIncludes>> {
      const normalizedRows = data.map((d) =>
        self.#injectDiscriminator(
          self.#stripUndefined(
            blindCast<
              Record<string, unknown>,
              'resolved Mongo create-all input is a model-field value record'
            >(d),
          ),
        ),
      );
      const documents = normalizedRows.map((d) => self.#toDocument(d));
      const command = new InsertManyCommand(self.#collectionName, documents);
      const results = await self.#drainPlan(command, self.#insertManyResultShape());
      const insertedIds = blindCast<
        { insertedIds: readonly unknown[] },
        'InsertManyCommand runtime result exposes insertedIds in input order, decoded via the _id codec'
      >(results[0]).insertedIds;
      for (let i = 0; i < normalizedRows.length; i++) {
        yield blindCast<
          IncludedRow<TContract, ModelName, TIncludes>,
          'created row combines resolved model input with its server-assigned _id'
        >({ _id: insertedIds[i], ...normalizedRows[i] });
      }
    }
    return new AsyncIterableResult(gen());
  }

  async createAndCount(
    data: ReadonlyArray<ResolvedCreateInput<TContract, ModelName, TVariant>>,
  ): Promise<number> {
    this.#rejectIncludes('createAndCount');
    const documents = data.map((d) =>
      this.#toDocument(
        this.#injectDiscriminator(
          blindCast<
            Record<string, unknown>,
            'resolved Mongo create-and-count input is a model-field value record'
          >(d),
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
    const updateDoc = this.#resolveUpdateDoc(dataOrCallback);
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
      const updateDoc = self.#resolveUpdateDoc(dataOrCallback);
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
    const updateDoc = this.#resolveUpdateDoc(dataOrCallback);
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

    const allCreateFields = this.#toDocument(
      this.#injectDiscriminator(
        blindCast<
          Record<string, unknown>,
          'resolved Mongo upsert create input is a model-field value record'
        >(input.create),
      ),
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

    const updatedFields = new Set<string>();
    for (const operatorGroup of Object.values(updateDoc)) {
      for (const fieldPath of Object.keys(operatorGroup)) {
        updatedFields.add(fieldPath.split('.')[0] ?? fieldPath);
      }
    }
    const insertOnlyFields: Record<string, MongoValue> = {};
    for (const [key, value] of Object.entries(allCreateFields)) {
      if (!updatedFields.has(key)) {
        insertOnlyFields[key] = value;
      }
    }
    if (Object.keys(insertOnlyFields).length > 0) {
      updateDoc['$setOnInsert'] = insertOnlyFields;
    }

    const command = new FindOneAndUpdateCommand(this.#collectionName, filter, updateDoc, true);
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
    const model = blindCast<
      MongoModelDefinition | undefined,
      'Mongo contract model lookup preserves target storage metadata erased by the namespace helper'
    >(domainModelsAtDefaultNamespace(this.#contract.domain)[this.#modelName]);
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
    const model = blindCast<
      MongoModelDefinition | undefined,
      'Mongo contract model lookup preserves target storage metadata erased by the namespace helper'
    >(domainModelsAtDefaultNamespace(this.#contract.domain)[this.#modelName]);
    return model?.fields ?? {};
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
      fields: { insertedId: this.#idFieldShape() },
    });
  }

  #insertManyResultShape(): MongoResultShape {
    return freezeMongoResultShape({
      kind: 'document',
      fields: { insertedIds: { kind: 'array', nullable: false, element: this.#idFieldShape() } },
    });
  }

  #modelResultShape(): MongoResultShape {
    const model = blindCast<
      MongoModelDefinition | undefined,
      'Mongo contract model lookup preserves target storage metadata erased by the namespace helper'
    >(domainModelsAtDefaultNamespace(this.#contract.domain)[this.#modelName]);
    if (!model) {
      return Object.freeze({ kind: 'unknown' as const });
    }
    return contractModelToMongoResultShape(model);
  }

  #compileWhereObject(data: Record<string, unknown>): MongoFilterExpr[] {
    const fields = this.#modelFields();
    const filters: MongoFilterExpr[] = [];
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue;
      const wrapped = this.#wrapFieldValue(value, fields[key]);
      filters.push(MongoFieldFilter.eq(key, wrapped));
    }
    return filters;
  }

  #wrapFieldValue(value: unknown, field: ContractField | undefined): MongoValue {
    if (field === undefined) return new MongoParamRef(value);

    if (field.type.kind === 'scalar') {
      return new MongoParamRef(value, { codecId: field.type.codecId });
    }

    if (field.type.kind === 'valueObject') {
      const voName = field.type.name;
      const voDef = domainValueObjectsAtDefaultNamespace(this.#contract.domain)?.[voName];
      if (!voDef || value === null) return new MongoParamRef(value);

      if (field.many && Array.isArray(value)) {
        return value.map((item) =>
          this.#wrapValueObject(
            blindCast<
              Record<string, unknown>,
              'contract-typed value-object array elements are field-value records'
            >(item),
            voDef,
          ),
        );
      }
      return this.#wrapValueObject(
        blindCast<
          Record<string, unknown>,
          'contract-typed value-object input is a field-value record'
        >(value),
        voDef,
      );
    }

    return new MongoParamRef(value);
  }

  #wrapValueObject(
    data: Record<string, unknown>,
    voDef: ContractValueObject,
  ): Record<string, MongoValue> {
    const doc: Record<string, MongoValue> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue;
      const fieldDef = voDef.fields[key];
      doc[key] = this.#wrapFieldValue(value, fieldDef);
    }
    return doc;
  }

  #toDocument(data: Record<string, unknown>): Record<string, MongoValue> {
    const fields = this.#modelFields();
    const doc: Record<string, MongoValue> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) {
        doc[key] = this.#wrapFieldValue(value, fields[key]);
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
        result[key] = this.#wrapFieldValue(value, fields[key]);
      }
    }
    return result;
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

  #wrapFieldOpValue(field: string, value: MongoValue, operator?: string): MongoValue {
    if (operator === '$unset') return value;

    const topLevelField = field.split('.')[0] ?? field;
    const fields = this.#modelFields();
    const contractField = fields[topLevelField];
    if (!contractField) return value;

    if (field.includes('.')) {
      return this.#wrapDotPathValue(field, value);
    }

    if (value instanceof MongoParamRef && contractField.type.kind === 'scalar') {
      return new MongoParamRef(value.value, { codecId: contractField.type.codecId });
    }

    if (contractField.type.kind === 'valueObject' && value instanceof MongoParamRef) {
      const raw = value.value;
      if (isUnknownRecord(raw)) {
        const voName = contractField.type.name;
        const voDef = domainValueObjectsAtDefaultNamespace(this.#contract.domain)?.[voName];
        if (voDef) {
          return this.#wrapValueObject(raw, voDef);
        }
      }
    }

    return value;
  }

  #wrapDotPathValue(dotPath: string, value: MongoValue): MongoValue {
    const parts = dotPath.split('.');
    const fields = this.#modelFields();
    let currentField: ContractField | undefined = parts[0] ? fields[parts[0]] : undefined;

    for (let i = 1; i < parts.length; i++) {
      if (currentField?.type.kind !== 'valueObject') return value;
      const voName = currentField.type.name;
      const voDef = domainValueObjectsAtDefaultNamespace(this.#contract.domain)?.[voName];
      if (!voDef) return value;
      const partKey = parts[i];
      currentField = partKey ? voDef.fields[partKey] : undefined;
    }

    if (currentField?.type.kind === 'scalar' && value instanceof MongoParamRef) {
      return new MongoParamRef(value.value, { codecId: currentField.type.codecId });
    }

    if (currentField?.type.kind === 'valueObject' && value instanceof MongoParamRef) {
      const raw = value.value;
      if (isUnknownRecord(raw)) {
        const voName = currentField.type.name;
        const voDef = domainValueObjectsAtDefaultNamespace(this.#contract.domain)?.[voName];
        if (voDef) {
          return this.#wrapValueObject(raw, voDef);
        }
      }
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
): MongoCollection<TContract, ModelName> {
  return new MongoCollectionImpl(contract, modelName, executor);
}
