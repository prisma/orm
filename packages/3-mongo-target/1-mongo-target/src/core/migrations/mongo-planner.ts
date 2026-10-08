import { asNamespaceId, type Contract, type ContractWithDomain } from '@internal/contract/types';
import { contractToMongoSchemaIR } from '@internal/family-mongo/control';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import {
  describeMigrationStatement,
  type MigrationOperationPolicy,
  type MigrationOperationSubject,
  type MigrationPlanner,
  type MigrationPlannerConflict,
  type MigrationPlannerResult,
  type MigrationPlanWithAuthoringSurface,
  type MigrationScaffoldContext,
  type MigrationSubject,
  type ModelCoordinate,
  type PlanOrigin,
  type ResolvedMigrationStatement,
} from '@internal/framework-components/control';
import type { MongoContract } from '@internal/mongo-contract';
import type {
  MongoSchemaCollection,
  MongoSchemaCollectionOptions,
  MongoSchemaIndex,
  MongoSchemaIR,
  MongoSchemaValidator,
} from '@internal/mongo-schema-ir';
import { canonicalize, deepEqual } from '@internal/mongo-schema-ir';
import { blindCast } from '@internal/utils/casts';
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

function buildIndexLookupKey(index: MongoSchemaIndex): string {
  const keys = index.keys.map((k) => `${k.field}:${k.direction}`).join(',');
  const opts = [
    index.unique ? 'unique' : '',
    index.sparse ? 'sparse' : '',
    index.expireAfterSeconds != null ? `ttl:${index.expireAfterSeconds}` : '',
    index.partialFilterExpression ? `pfe:${canonicalize(index.partialFilterExpression)}` : '',
    index.wildcardProjection ? `wp:${canonicalize(index.wildcardProjection)}` : '',
    index.collation ? `col:${canonicalize(index.collation)}` : '',
    index.weights ? `wt:${canonicalize(index.weights)}` : '',
    index.default_language ? `dl:${index.default_language}` : '',
    index.language_override ? `lo:${index.language_override}` : '',
  ]
    .filter(Boolean)
    .join(';');
  return opts ? `${keys}|${opts}` : keys;
}

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

function propertiesOf(schema: Record<string, unknown>): Record<string, unknown> {
  return isPlainObject(schema['properties']) ? schema['properties'] : {};
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
    (field) =>
      Object.hasOwn(originProps, field) &&
      canonicalize(originProps[field]) !== canonicalize(destProps[field]),
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

function hasImmutableOptionChange(
  origin: MongoSchemaCollectionOptions | undefined,
  dest: MongoSchemaCollectionOptions | undefined,
): string | undefined {
  if (canonicalize(origin?.capped) !== canonicalize(dest?.capped)) return 'capped';
  if (canonicalize(origin?.timeseries) !== canonicalize(dest?.timeseries)) return 'timeseries';
  if (canonicalize(origin?.collation) !== canonicalize(dest?.collation)) return 'collation';
  if (canonicalize(origin?.clusteredIndex) !== canonicalize(dest?.clusteredIndex))
    return 'clusteredIndex';
  return undefined;
}

function collectionHasOptions(coll: MongoSchemaCollection): boolean {
  return !!(coll.options || coll.validator);
}

export type PlanCallsResult =
  | { readonly kind: 'success'; readonly calls: OpFactoryCall[] }
  | { readonly kind: 'failure'; readonly conflicts: MigrationPlannerConflict[] };

/** The collection a model stores its documents in; a model without `@@map` names it verbatim. */
function collectionOf(contract: ContractWithDomain | null, coordinate: ModelCoordinate): string {
  const collection =
    contract?.domain.namespaces[coordinate.namespaceId]?.models[coordinate.model]?.storage[
      'collection'
    ];
  return typeof collection === 'string' ? collection : coordinate.model;
}

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

/** Each collection drop of the plan, with the model whose documents it loses. */
function collectionDrops(
  calls: readonly OpFactoryCall[],
  fromContract: ContractWithDomain | null,
): readonly MigrationOperationSubject[] {
  return calls.flatMap((call, operationIndex) => {
    if (!(call instanceof DropCollectionCall)) return [];
    const model = fromContract === null ? undefined : modelStoredIn(fromContract, call.collection);
    const subject: MigrationSubject =
      model === undefined
        ? { kind: 'storage', name: call.collection }
        : { kind: 'model', ...model };
    return [{ operationIndex, subject }];
  });
}

const NOT_IN_THIS_RELEASE = 'MongoDB cannot carry out rename statements in this release.';

function shellString(name: string): string {
  return JSON.stringify(name);
}

/**
 * How to keep the documents of a subject a plan would drop, since the planner carries out no
 * rename: rename the collection by hand before a plan that drops it is applied. Right for both
 * `db update`, which then finds nothing to drop, and `migration plan`, whose written migration
 * still drops it.
 */
export function keepDataByHand(
  subject: MigrationSubject,
  fromContract: ContractWithDomain,
): string {
  const collection =
    subject.kind === 'storage' ? subject.name : collectionOf(fromContract, subject);
  return `If it was renamed, keep its documents instead: rename collection "${collection}" by hand on each database before a plan that drops it is applied there, for example with db.getCollection(${shellString(collection)}).renameCollection("<new collection>") in mongosh. db update then drops nothing; a migration written by migration plan still drops "${collection}", so remove that operation from its migration.ts, or do not apply it where the collection was renamed.`;
}

/**
 * What a plan made without the statement does to the data, and how to keep it. Right for both
 * `db update` and `migration plan`, since the planner does not know which command it serves.
 * Mongo contracts key a model's fields by their stored names, so the statement's field names are
 * the names a `$rename` needs.
 */
function keepTheData(
  statement: ResolvedMigrationStatement,
  fromContract: ContractWithDomain | null,
  contract: ContractWithDomain,
): string {
  const from = collectionOf(fromContract, statement.from);
  if (statement.entity === 'field') {
    const { field } = statement.from;
    const newField = statement.to.field;
    const collection = `db.getCollection(${shellString(from)})`;
    return `${NOT_IN_THIS_RELEASE} Without the statement, the documents in collection "${from}" keep their values under "${field}", and nothing moves them to "${newField}". To move them, run these in mongosh on each database before a plan made without the statement is applied there, using the field names as they are stored. First turn off the collection's validator, which still requires "${field}": db.runCommand({ collMod: ${shellString(from)}, validationLevel: "off" }). Then drop each unique index that includes "${field}", or the move fails once two documents have lost it, for example ${collection}.dropIndex(${shellString(`${field}_1`)}). Then move the values: ${collection}.updateMany({}, { $rename: { ${shellString(field)}: ${shellString(newField)} } }). Applying the plan then creates the indexes on "${newField}" and turns the validator back on.`;
  }
  const to = collectionOf(contract, statement.to);
  if (from === to) {
    return `${NOT_IN_THIS_RELEASE} Both models store their documents in collection "${from}", so a plan made without the statement keeps them.`;
  }
  return `${NOT_IN_THIS_RELEASE} Without the statement, a plan drops collection "${from}" with its documents and creates collection "${to}". To keep the documents, rename the collection by hand on each database before a plan made without the statement is applied there, for example with db.getCollection(${shellString(from)}).renameCollection(${shellString(to)}) in mongosh. A migration written by migration plan without the statement still drops "${from}" wherever it is applied, so check its operations first.`;
}

function statementNotApplied(
  statement: ResolvedMigrationStatement,
  fromContract: ContractWithDomain | null,
  contract: ContractWithDomain,
): MigrationPlannerConflict {
  return {
    kind: 'statementRefused',
    summary: `MongoDB does not apply rename statements in this release, so nothing was planned: ${describeMigrationStatement(statement, fromContract ?? contract, contract)}`,
    why: keepTheData(statement, fromContract, contract),
    refusedStatement: statement,
  };
}

export class MongoMigrationPlanner implements MigrationPlanner<'mongo', 'mongo'> {
  planCalls(options: {
    readonly contract: unknown;
    readonly schema: unknown;
    readonly policy: MigrationOperationPolicy;
    readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'mongo', 'mongo'>>;
  }): PlanCallsResult {
    const contract = blindCast<
      MongoContract,
      'framework planner passes the Mongo contract selected for the mongo target'
    >(options.contract);
    const originIR = blindCast<
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

    const allCollectionNames = new Set([
      ...originIR.collectionNames,
      ...destinationIR.collectionNames,
    ]);

    for (const collName of [...allCollectionNames].sort()) {
      const originColl = originIR.collection(collName);
      const destColl = destinationIR.collection(collName);

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

        const mutableCall = planMutableOptionsDiffCall(
          collName,
          originColl.options,
          destColl.options,
        );
        if (mutableCall) mutableOptionOps.push(mutableCall);

        const validatorCall = planValidatorDiffCall(
          collName,
          originColl.validator,
          destColl.validator,
        );
        if (validatorCall) validatorOps.push(validatorCall);
      }

      const originLookup = new Map<string, MongoSchemaIndex>();
      if (originColl) {
        for (const idx of originColl.indexes) {
          originLookup.set(buildIndexLookupKey(idx), idx);
        }
      }

      const destLookup = new Map<string, MongoSchemaIndex>();
      if (destColl) {
        for (const idx of destColl.indexes) {
          destLookup.set(buildIndexLookupKey(idx), idx);
        }
      }

      for (const [lookupKey, idx] of originLookup) {
        if (!destLookup.has(lookupKey)) {
          drops.push(new DropIndexCall(collName, idx.keys));
        }
      }

      for (const [lookupKey, idx] of destLookup) {
        if (!originLookup.has(lookupKey)) {
          creates.push(
            new CreateIndexCall(collName, idx.keys, schemaIndexToCreateIndexOptions(idx)),
          );
        }
      }
    }

    if (conflicts.length > 0) {
      return { kind: 'failure', conflicts };
    }

    const allCalls = [
      ...collCreates,
      ...drops,
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

    return { kind: 'success', calls: allCalls };
  }

  plan(options: {
    readonly contract: unknown;
    readonly schema: unknown;
    readonly policy: MigrationOperationPolicy;
    /** The contract the planner reads as the starting state, or `null` when it has none. */
    readonly fromContract: Contract | null;
    /** The origin the produced plan asserts: its `describe().from` and `origin`. */
    readonly origin: PlanOrigin | null;
    /** The `--rename` statements, resolved; MongoDB refuses any statement in this release. */
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
    const [statement] = options.statements;
    if (statement !== undefined) {
      return {
        kind: 'failure',
        conflicts: [statementNotApplied(statement, options.fromContract, contract)],
      };
    }
    const result = this.planCalls(options);
    if (result.kind === 'failure') return result;
    return {
      kind: 'success',
      plan: new PlannerProducedMongoMigration(
        result.calls,
        {
          from: options.origin?.storageHash ?? null,
          to: contract.storage.storageHash,
        },
        options.snapshotsImportPath,
      ),
      appliedStatements: [],
      dataLoss: collectionDrops(result.calls, options.fromContract),
      accessWidening: [],
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
