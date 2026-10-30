import {
  asNamespaceId,
  type Contract,
  type ContractWithDomain,
  type ControlPolicy,
} from '@internal/contract/types';
import { contractToMongoSchemaIR } from '@internal/family-mongo/control';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import {
  describeMigrationStatement,
  type MigrationDataLoss,
  type MigrationOperationPolicy,
  type MigrationPlanner,
  type MigrationPlannerConflict,
  type MigrationPlannerResult,
  type MigrationPlanWithAuthoringSurface,
  type MigrationScaffoldContext,
  type MigrationSubject,
  type ModelCoordinate,
  type PlanOrigin,
  type ResolvedMigrationStatement,
  type ResolvedRenameStatement,
} from '@internal/framework-components/control';
import {
  canonicalize,
  indexLookupKey,
  type MongoContract,
  validatorRootShapesOf,
} from '@internal/mongo-contract';
import type {
  MongoSchemaCollection,
  MongoSchemaCollectionOptions,
  MongoSchemaIndex,
  MongoSchemaIR,
  MongoSchemaValidator,
} from '@internal/mongo-schema-ir';
import { deepEqual } from '@internal/mongo-schema-ir';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import {
  type CollectionControl,
  collectionControlOf,
  collectionOf,
  type FieldRemoval,
  keepCollectionByHandAdvice,
  planFieldRemovals,
  planStatements,
  planValidatorFieldRemovals,
  type StatementCalls,
  sharedCollectionRemovalRefusals,
  timeSeriesRemovalRefusals,
} from './mongo-statement-planning';
import type { OpFactoryCall } from './op-factory-call';
import {
  CollModCall,
  CreateCollectionCall,
  CreateIndexCall,
  DropCollectionCall,
  DropIndexCall,
  schemaCollectionToCreateCollectionOptions,
  schemaIndexToCreateIndexOptions,
} from './op-factory-call';
import { PlannerProducedMongoMigration } from './planner-produced-migration';

function validatorsEqual(
  a: MongoSchemaValidator | undefined,
  b: MongoSchemaValidator | undefined,
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (
    a.validationLevel === b.validationLevel &&
    a.validationAction === b.validationAction &&
    canonicalize(a.jsonSchema) === canonicalize(b.jsonSchema)
  );
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Each field a root model of the validator declares, with the distinct schemas the root models give it, in canonical form. */
function propertiesOf(schema: Record<string, unknown>): Record<string, string> {
  const schemas = new Map<string, Set<string>>();
  for (const root of validatorRootShapesOf(schema)) {
    for (const [field, fieldSchema] of Object.entries(root.properties)) {
      schemas.set(field, (schemas.get(field) ?? new Set()).add(canonicalize(fieldSchema)));
    }
  }
  return Object.fromEntries(
    [...schemas].map(([field, distinct]) => [field, [...distinct].sort().join('|')]),
  );
}

/**
 * A label naming the properties whose schema changed, so a dry run shows what a validator update does: `Update validator on items (changed: meta; added: note)`.
 */
function validatorUpdateLabel(
  collName: string,
  origin: MongoSchemaValidator,
  dest: MongoSchemaValidator,
): string {
  const originProps = propertiesOf(origin.jsonSchema);
  const destProps = propertiesOf(dest.jsonSchema);
  const changed = Object.keys(destProps).filter(
    (field) => Object.hasOwn(originProps, field) && originProps[field] !== destProps[field],
  );
  const added = Object.keys(destProps).filter((field) => !Object.hasOwn(originProps, field));
  const removed = Object.keys(originProps).filter((field) => !Object.hasOwn(destProps, field));
  const parts = [
    ...(changed.length > 0 ? [`changed: ${changed.join(', ')}`] : []),
    ...(added.length > 0 ? [`added: ${added.join(', ')}`] : []),
    ...(removed.length > 0 ? [`removed: ${removed.join(', ')}`] : []),
  ];
  return parts.length === 0
    ? `Update validator on ${collName}`
    : `Update validator on ${collName} (${parts.join('; ')})`;
}

/**
 * The keys of an option MongoDB fills in when a collection is created without them, each with a
 * test for the value it fills in. `listCollections` reports a time-series collection's granularity
 * as "seconds" and its bucketMaxSpanSeconds when they were not given, and bucketRoundingSeconds only
 * for custom bucketing, which a contract cannot state; and a clustered index's v, key and unique, and
 * its name as "_id_".
 */
const SERVER_FILLED: Readonly<
  Record<'timeseries' | 'clusteredIndex', Readonly<Record<string, (value: unknown) => boolean>>>
> = {
  timeseries: {
    granularity: (value) => value === 'seconds',
    bucketMaxSpanSeconds: () => true,
    bucketRoundingSeconds: () => true,
  },
  clusteredIndex: {
    v: () => true,
    key: () => true,
    unique: () => true,
    name: (value) => value === '_id_',
  },
};

/** The origin's value of an option without the keys the server filled in and the destination leaves out. */
function withoutServerFilled(
  option: keyof typeof SERVER_FILLED,
  origin: unknown,
  dest: unknown,
): unknown {
  if (!isPlainObject(origin)) return origin;
  const filled = SERVER_FILLED[option];
  return Object.fromEntries(
    Object.entries(origin).filter(
      ([key, value]) => (isPlainObject(dest) && Object.hasOwn(dest, key)) || !filled[key]?.(value),
    ),
  );
}

function hasImmutableOptionChange(
  origin: MongoSchemaCollectionOptions | undefined,
  dest: MongoSchemaCollectionOptions | undefined,
): string | undefined {
  if (canonicalize(origin?.capped) !== canonicalize(dest?.capped)) return 'capped';
  if (
    canonicalize(withoutServerFilled('timeseries', origin?.timeseries, dest?.timeseries)) !==
    canonicalize(dest?.timeseries)
  )
    return 'timeseries';
  if (canonicalize(origin?.collation) !== canonicalize(dest?.collation)) return 'collation';
  if (
    canonicalize(
      withoutServerFilled('clusteredIndex', origin?.clusteredIndex, dest?.clusteredIndex),
    ) !== canonicalize(dest?.clusteredIndex)
  )
    return 'clusteredIndex';
  return undefined;
}

function collectionHasOptions(coll: MongoSchemaCollection): boolean {
  return !!(coll.options || coll.validator);
}

export type PlanCallsResult =
  | {
      readonly kind: 'success';
      readonly calls: OpFactoryCall[];
      /** One for each change a collection's control policy left out of the plan. */
      readonly warnings: readonly MigrationPlannerConflict[];
    }
  | { readonly kind: 'failure'; readonly conflicts: MigrationPlannerConflict[] };

/**
 * The model of `fromContract` that stores its documents in `collection`, if any: the root model
 * when variants share the collection with it.
 */
function modelStoredIn(
  fromContract: ContractWithDomain,
  collection: string,
): ModelCoordinate | undefined {
  const storing = Object.entries(fromContract.domain.namespaces).flatMap(
    ([namespaceId, namespace]) =>
      Object.entries(namespace.models).flatMap(([model, definition]) => {
        const coordinate = { namespaceId: asNamespaceId(namespaceId), model };
        return collectionOf(fromContract, coordinate) === collection
          ? [{ coordinate, isRoot: definition.base === undefined }]
          : [];
      }),
  );
  return (storing.find(({ isRoot }) => isRoot) ?? storing[0])?.coordinate;
}

/** A convert or backfill statement, which this release cannot carry out on MongoDB. */
function unsupportedStatementConflict(
  statement: ResolvedMigrationStatement,
  fromContract: ContractWithDomain,
  contract: ContractWithDomain,
): MigrationPlannerConflict {
  return {
    kind: 'statementRefused',
    summary: `MongoDB does not apply ${statement.kind} statements in this release, so nothing was planned: ${describeMigrationStatement(statement, fromContract, contract)}`,
    why: `MongoDB cannot carry out ${statement.kind} statements in this release. Leave out the statement.`,
    refusedStatement: statement,
  };
}

/**
 * Each collection drop of the plan, with the model whose documents it loses. When that model keeps
 * its name and the plan brings its new collection into existence, the drop says how to rename the
 * collection by hand instead.
 */
function collectionDrops(
  calls: readonly OpFactoryCall[],
  fromContract: ContractWithDomain | null,
  contract: ContractWithDomain,
  collections: { readonly origin: MongoSchemaIR; readonly destination: MongoSchemaIR },
): readonly MigrationDataLoss[] {
  const created = (collection: string) =>
    collections.origin.collection(collection) === undefined &&
    collections.destination.collection(collection) !== undefined;
  return calls.flatMap((call, operationIndex): readonly MigrationDataLoss[] => {
    if (!(call instanceof DropCollectionCall)) return [];
    const model = fromContract === null ? undefined : modelStoredIn(fromContract, call.collection);
    const lost = { operationIndex, loss: 'drop', label: call.label } as const;
    if (model === undefined) {
      return [{ ...lost, subject: { kind: 'storage', name: call.collection } }];
    }
    const subject: MigrationSubject = { kind: 'model', ...model };
    const destinationCollection = modelStoredInDestination(contract, model);
    return [
      destinationCollection !== undefined && created(destinationCollection)
        ? {
            ...lost,
            subject,
            keepDataAdvice: keepCollectionByHandAdvice(
              model,
              call.collection,
              destinationCollection,
            ),
          }
        : { ...lost, subject },
    ];
  });
}

/** The collection the destination stores `model` in, when the destination still has that model. */
function modelStoredInDestination(
  contract: ContractWithDomain,
  model: ModelCoordinate,
): string | undefined {
  const namespace = contract.domain.namespaces[model.namespaceId];
  return namespace !== undefined && Object.hasOwn(namespace.models, model.model)
    ? collectionOf(contract, model)
    : undefined;
}

interface CollectionDiff {
  readonly collCreates: readonly OpFactoryCall[];
  readonly drops: readonly OpFactoryCall[];
  readonly creates: readonly OpFactoryCall[];
  readonly validatorOps: readonly OpFactoryCall[];
  readonly mutableOptionOps: readonly OpFactoryCall[];
  readonly collDrops: readonly OpFactoryCall[];
  readonly conflicts: readonly MigrationPlannerConflict[];
}

function callsOf(diff: CollectionDiff): readonly OpFactoryCall[] {
  return [
    ...diff.collCreates,
    ...diff.drops,
    ...diff.creates,
    ...diff.validatorOps,
    ...diff.mutableOptionOps,
    ...diff.collDrops,
  ];
}

function planCollectionDiff(
  collName: string,
  originColl: MongoSchemaCollection | undefined,
  destColl: MongoSchemaCollection | undefined,
): CollectionDiff {
  const collCreates: OpFactoryCall[] = [];
  const drops: OpFactoryCall[] = [];
  const creates: OpFactoryCall[] = [];
  const validatorOps: OpFactoryCall[] = [];
  const mutableOptionOps: OpFactoryCall[] = [];
  const collDrops: OpFactoryCall[] = [];
  const conflicts: MigrationPlannerConflict[] = [];

  if (!originColl) {
    // Provision contract-declared collections that are absent from
    // the live database. MongoDB lazily materialises a collection
    // on first write, so subsequent `createIndex` calls in the same
    // plan would create the collection for us implicitly — but the
    // schema verifier treats an unmaterialised contract collection
    // as a `missing_table` issue, so a plan that lacks both options
    // and indexes (e.g. a plain `users` collection from the init
    // scaffold) ends up provisioning nothing and failing verify.
    // The planner therefore emits an explicit createCollection for
    // any contract collection that has options/validator OR no
    // indexes to ride along on. Collections that have indexes
    // continue to rely on createIndex for materialisation, keeping
    // existing plans byte-stable.
    if (destColl && (collectionHasOptions(destColl) || destColl.indexes.length === 0)) {
      const opts = collectionHasOptions(destColl)
        ? schemaCollectionToCreateCollectionOptions(destColl)
        : undefined;
      collCreates.push(new CreateCollectionCall(collName, opts));
    }
  } else if (!destColl) {
    collDrops.push(new DropCollectionCall(collName));
  } else {
    const immutableChange = hasImmutableOptionChange(originColl.options, destColl.options);
    if (immutableChange) {
      conflicts.push({
        kind: 'policy-violation',
        summary: `Cannot change immutable collection option '${immutableChange}' on ${collName}`,
        why: `MongoDB does not support modifying the '${immutableChange}' option after collection creation`,
      });
    }

    const mutableCall = planMutableOptionsDiffCall(collName, originColl.options, destColl.options);
    if (mutableCall) mutableOptionOps.push(mutableCall);

    const validatorCall = planValidatorDiffCall(collName, originColl.validator, destColl.validator);
    if (validatorCall) validatorOps.push(validatorCall);
  }

  const originLookup = new Map<string, MongoSchemaIndex>();
  if (originColl) {
    for (const idx of originColl.indexes) {
      originLookup.set(indexLookupKey(idx), idx);
    }
  }

  const destLookup = new Map<string, MongoSchemaIndex>();
  if (destColl) {
    for (const idx of destColl.indexes) {
      destLookup.set(indexLookupKey(idx), idx);
    }
  }

  for (const [lookupKey, idx] of originLookup) {
    if (!destLookup.has(lookupKey)) {
      drops.push(new DropIndexCall(collName, idx.keys));
    }
  }

  for (const [lookupKey, idx] of destLookup) {
    if (!originLookup.has(lookupKey)) {
      creates.push(new CreateIndexCall(collName, idx.keys, schemaIndexToCreateIndexOptions(idx)));
    }
  }
  return { collCreates, drops, creates, validatorOps, mutableOptionOps, collDrops, conflicts };
}

/**
 * The warning for a change a collection's control policy left out of the plan, worded as the Postgres planner words a suppressed call.
 */
function suppressedCallWarning(
  call: OpFactoryCall,
  collection: string,
  control: CollectionControl,
): MigrationPlannerConflict & { readonly meta: Record<string, string> } {
  const declared =
    control.declared !== undefined && control.declared !== control.policy
      ? ` but declared '${control.declared}'`
      : '';
  return {
    kind: 'controlPolicySuppressedCall',
    summary: `control policy suppressed: ${call.label} — collection "${collection}" has effective control '${control.policy}'${declared}`,
    meta: {
      controlPolicy: control.policy,
      ...ifDefined('declaredControlPolicy', control.declared),
    },
  };
}

export class MongoMigrationPlanner implements MigrationPlanner<'mongo', 'mongo'> {
  planCalls(options: {
    readonly contract: unknown;
    readonly schema: unknown;
    readonly policy: MigrationOperationPolicy;
    readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'mongo', 'mongo'>>;
    /** The contract the planner reads as the starting state, or `null` when it has none. */
    readonly fromContract: Contract | null;
    /** What the statements and removed fields plan; its `schema` is diffed in place of `schema`. */
    readonly statementCalls?: StatementCalls;
  }): PlanCallsResult {
    const contract = blindCast<
      MongoContract,
      'framework planner passes the Mongo contract selected for the mongo target'
    >(options.contract);
    const originIR =
      options.statementCalls?.schema ??
      blindCast<
        MongoSchemaIR,
        'framework planner passes the inspected Mongo schema IR selected for the mongo target'
      >(options.schema);
    const destinationIR = contractToMongoSchemaIR(contract);

    const collCreates: OpFactoryCall[] = [];
    const drops: OpFactoryCall[] = [];
    const creates: OpFactoryCall[] = [];
    const validatorOps: OpFactoryCall[] = [];
    const mutableOptionOps: OpFactoryCall[] = [];
    const collDrops: OpFactoryCall[] = [];
    const conflicts: MigrationPlannerConflict[] = [];
    const warnings: MigrationPlannerConflict[] = [];

    const allCollectionNames = new Set([
      ...originIR.collectionNames,
      ...destinationIR.collectionNames,
    ]);

    for (const collName of [...allCollectionNames].sort()) {
      const originColl = originIR.collection(collName);
      const planned = planCollectionDiff(collName, originColl, destinationIR.collection(collName));
      const control = collectionControlOf(contract, options.fromContract, collName);
      if (!plansChangesTo(control.policy, originColl !== undefined)) {
        warnings.push(
          ...callsOf(planned).map((call) => suppressedCallWarning(call, collName, control)),
        );
        continue;
      }
      collCreates.push(...planned.collCreates);
      drops.push(...planned.drops);
      creates.push(...planned.creates);
      validatorOps.push(...planned.validatorOps);
      mutableOptionOps.push(...planned.mutableOptionOps);
      collDrops.push(...planned.collDrops);
      conflicts.push(...planned.conflicts);
    }

    if (conflicts.length > 0) {
      return { kind: 'failure', conflicts };
    }

    const allCalls = [
      ...(options.statementCalls?.collectionRenames ?? []),
      ...collCreates,
      ...drops,
      ...(options.statementCalls?.rewrites ?? []),
      ...creates,
      ...validatorOps,
      ...mutableOptionOps,
      ...collDrops,
    ];

    for (const call of allCalls) {
      if (!options.policy.allowedOperationClasses.includes(call.operationClass)) {
        conflicts.push({
          kind: 'policy-violation',
          summary: `${call.operationClass} operation disallowed: ${call.label}`,
          why: `Policy does not allow '${call.operationClass}' operations`,
          refusedOperationClass: call.operationClass,
        });
      }
    }

    if (conflicts.length > 0) {
      return { kind: 'failure', conflicts };
    }

    return { kind: 'success', calls: allCalls, warnings };
  }

  plan(options: {
    readonly contract: unknown;
    readonly schema: unknown;
    readonly policy: MigrationOperationPolicy;
    /** The contract the planner reads as the starting state, or `null` when it has none. */
    readonly fromContract: Contract | null;
    /** The origin the produced plan asserts: its `describe().from` and `origin`. */
    readonly origin: PlanOrigin | null;
    /** The `--rename` statements, resolved. */
    readonly statements: readonly ResolvedMigrationStatement[];
    readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'mongo', 'mongo'>>;
    /**
     * POSIX-relative path from the migration package dir to
     * `migrations/snapshots`, e.g. `'../../snapshots'`. Threaded straight
     * into the produced plan's `renderTypeScript()` metadata.
     */
    readonly snapshotsImportPath: string;
  }): MigrationPlannerResult {
    const contract = blindCast<
      MongoContract,
      'framework planner passes the Mongo contract selected for the mongo target'
    >(options.contract);
    const originIR = blindCast<
      MongoSchemaIR,
      'framework planner passes the inspected Mongo schema IR selected for the mongo target'
    >(options.schema);
    const fromContract = options.fromContract;
    const unsupported = options.statements.find((statement) => statement.kind !== 'rename');
    if (unsupported !== undefined) {
      return {
        kind: 'failure',
        conflicts: [unsupportedStatementConflict(unsupported, fromContract ?? contract, contract)],
      };
    }
    const renames = options.statements.filter(
      (statement): statement is ResolvedRenameStatement => statement.kind === 'rename',
    );
    const statementPlan = planStatements({
      statements: renames,
      fromContract: fromContract ?? contract,
      contract,
      schema: originIR,
    });
    if (!statementPlan.ok) return { kind: 'failure', conflicts: statementPlan.failure };
    const { schema, collectionRenames, fieldRenames, callOfStatement } = statementPlan.value;
    const destinationIR = contractToMongoSchemaIR(contract);
    const renamedTo = new Map(collectionRenames.map((call) => [call.from, call.to]));
    const removals: readonly FieldRemoval[] =
      fromContract === null
        ? planValidatorFieldRemovals({ origin: schema, destination: destinationIR, contract })
        : planFieldRemovals({
            statements: renames,
            fromContract,
            contract,
            collectionAfterRenames: (collection) => renamedTo.get(collection) ?? collection,
            keptCollections: new Set(
              schema.collectionNames.filter((name) => destinationIR.collection(name) !== undefined),
            ),
          });
    const removalRefusals = [
      ...timeSeriesRemovalRefusals(removals, schema),
      ...sharedCollectionRemovalRefusals(removals, contract),
    ];
    if (removalRefusals.length > 0) return { kind: 'failure', conflicts: removalRefusals };
    const result = this.planCalls({
      ...options,
      statementCalls: {
        schema,
        collectionRenames,
        rewrites: [...fieldRenames, ...removals.map((removal) => removal.call)],
      },
    });
    if (result.kind === 'failure') return result;
    const { calls, warnings } = result;
    const fieldLoss: readonly MigrationDataLoss[] = removals.map((removal) => ({
      operationIndex: calls.indexOf(removal.call),
      subject: removal.subject,
      loss: 'drop',
      label: removal.call.label,
    }));
    return {
      kind: 'success',
      plan: new PlannerProducedMongoMigration(
        calls,
        {
          from: options.origin?.storageHash ?? null,
          to: contract.storage.storageHash,
        },
        options.snapshotsImportPath,
      ),
      appliedStatements: options.statements.map((statement, index) => {
        const call = callOfStatement[index];
        return { statement, operationIndexes: call === undefined ? [] : [calls.indexOf(call)] };
      }),
      dataLoss: [
        ...collectionDrops(calls, fromContract, contract, {
          origin: schema,
          destination: destinationIR,
        }),
        ...fieldLoss,
      ].sort((a, b) => a.operationIndex - b.operationIndex),
      accessChanges: [],
      temporaryValues: [],
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }

  /**
   * Produce an empty `migration.ts` authoring surface for `migration new`.
   *
   * The "empty migration" is a `PlannerProducedMongoMigration` with no
   * operations; `renderTypeScript()` emits a stub class with the correct
   * `from`/`to` metadata that the user then fills in with operations. The
   * contract path on the context is unused — Mongo's emitted source does
   * not import from the generated contract `.d.ts`.
   */
  emptyMigration(context: MigrationScaffoldContext): MigrationPlanWithAuthoringSurface {
    return new PlannerProducedMongoMigration(
      [],
      {
        from: context.fromHash,
        to: context.toHash,
      },
      context.snapshotsImportPath,
    );
  }
}

function plansChangesTo(policy: ControlPolicy, collectionExists: boolean): boolean {
  switch (policy) {
    case 'managed':
      return true;
    case 'tolerated':
      return !collectionExists;
    case 'external':
    case 'observed':
      return false;
  }
}

function planValidatorDiffCall(
  collName: string,
  originValidator: MongoSchemaValidator | undefined,
  destValidator: MongoSchemaValidator | undefined,
): OpFactoryCall | undefined {
  if (validatorsEqual(originValidator, destValidator)) return undefined;

  if (destValidator) {
    return new CollModCall(
      collName,
      {
        validator: { $jsonSchema: destValidator.jsonSchema },
        validationLevel: destValidator.validationLevel,
        validationAction: destValidator.validationAction,
      },
      {
        id: `validator.${collName}.${originValidator ? 'update' : 'add'}`,
        label: originValidator
          ? validatorUpdateLabel(collName, originValidator, destValidator)
          : `Add validator on ${collName}`,
        operationClass: 'widening',
      },
    );
  }

  return new CollModCall(
    collName,
    {
      validator: {},
      validationLevel: 'strict',
      validationAction: 'error',
    },
    {
      id: `validator.${collName}.remove`,
      label: `Remove validator on ${collName}`,
      operationClass: 'widening',
    },
  );
}

function planMutableOptionsDiffCall(
  collName: string,
  origin: MongoSchemaCollectionOptions | undefined,
  dest: MongoSchemaCollectionOptions | undefined,
): OpFactoryCall | undefined {
  const originCSPPI = origin?.changeStreamPreAndPostImages;
  const destCSPPI = dest?.changeStreamPreAndPostImages;
  if (deepEqual(originCSPPI, destCSPPI)) return undefined;

  const desiredCSPPI = destCSPPI ?? { enabled: false };
  return new CollModCall(
    collName,
    {
      changeStreamPreAndPostImages: desiredCSPPI,
    },
    {
      id: `options.${collName}.update`,
      label: `Update mutable options on ${collName}`,
      operationClass: 'widening',
    },
  );
}
