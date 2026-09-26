import type { Contract } from '@internal/contract/types';
import { contractToMongoSchemaIR } from '@internal/family-mongo/control';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import type {
  MigrationOperationClass,
  MigrationOperationPolicy,
  MigrationPlanner,
  MigrationPlannerConflict,
  MigrationPlannerResult,
  MigrationPlanWithAuthoringSurface,
  MigrationScaffoldContext,
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

function classifyValidatorUpdate(
  origin: MongoSchemaValidator,
  dest: MongoSchemaValidator,
): 'widening' | 'destructive' {
  // Moving to a stricter action or level narrows the accepted value space.
  if (origin.validationAction !== dest.validationAction && dest.validationAction === 'error') {
    return 'destructive';
  }
  if (origin.validationLevel !== dest.validationLevel && dest.validationLevel === 'strict') {
    return 'destructive';
  }

  if (canonicalize(origin.jsonSchema) === canonicalize(dest.jsonSchema)) {
    return 'widening';
  }

  // Check whether the schema change only adds non-required properties (widening).
  return isWideningSchemaChange(origin.jsonSchema, dest.jsonSchema) ? 'widening' : 'destructive';
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Returns true when `dest` is a structural superset of `origin` for the common
 * additive case: adding non-required properties to a top-level object schema.
 * Anything uncertain falls through to the safe `destructive` default.
 */
function isWideningSchemaChange(
  origin: Record<string, unknown>,
  dest: Record<string, unknown>,
): boolean {
  // Only handle top-level object schemas.
  if (origin['bsonType'] !== 'object' || dest['bsonType'] !== 'object') {
    return false;
  }

  // Any change to keys besides 'required' and 'properties' is uncertain → destructive.
  const allKeys = new Set([...Object.keys(origin), ...Object.keys(dest)]);
  for (const key of allKeys) {
    if (key === 'required' || key === 'properties') continue;
    if (canonicalize(origin[key]) !== canonicalize(dest[key])) return false;
  }

  // dest.required must be a subset of origin.required — no new required fields.
  const originRequired = new Set<unknown>(
    Array.isArray(origin['required']) ? origin['required'] : [],
  );
  const destRequired = Array.isArray(dest['required']) ? dest['required'] : [];
  for (const field of destRequired) {
    if (!originRequired.has(field)) return false;
  }

  // All properties that existed in origin must still exist unchanged.
  // New properties in dest (absent from origin) are allowed — widening.
  const originProps = isPlainObject(origin['properties']) ? origin['properties'] : {};
  const destProps = isPlainObject(dest['properties']) ? dest['properties'] : {};
  for (const field of Object.keys(originProps)) {
    if (!Object.hasOwn(destProps, field)) return false; // Property removed → destructive.
    if (canonicalize(originProps[field]) !== canonicalize(destProps[field])) return false; // Property narrowed → destructive.
  }

  return true;
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
    /**
     * The "from" contract (state the planner assumes the database starts at),
     * or `null` for reconciliation flows. Used to populate `describe().from`
     * on the produced plan as `fromContract?.storage.storageHash ?? null`.
     */
    readonly fromContract: Contract | null;
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
    const result = this.planCalls(options);
    if (result.kind === 'failure') return result;
    return {
      kind: 'success',
      plan: new PlannerProducedMongoMigration(
        result.calls,
        {
          from: options.fromContract?.storage.storageHash ?? null,
          to: contract.storage.storageHash,
        },
        options.snapshotsImportPath,
      ),
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
    const operationClass: MigrationOperationClass = originValidator
      ? classifyValidatorUpdate(originValidator, destValidator)
      : 'destructive';
    return new CollModCall(
      collName,
      {
        validator: { $jsonSchema: destValidator.jsonSchema },
        validationLevel: destValidator.validationLevel,
        validationAction: destValidator.validationAction,
      },
      {
        id: `validator.${collName}.${originValidator ? 'update' : 'add'}`,
        label: `${originValidator ? 'Update' : 'Add'} validator on ${collName}`,
        operationClass,
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
      operationClass: desiredCSPPI.enabled ? 'widening' : 'destructive',
    },
  );
}
