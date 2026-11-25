import type { Contract, ContractWithDomain } from '@internal/contract/types';
import { contractToMongoSchemaIR } from '@internal/family-mongo/control';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import {
  type MigrationDataLoss,
  type MigrationOperationPolicy,
  type MigrationPlanner,
  type MigrationPlannerConflict,
  type MigrationPlannerResult,
  type MigrationPlanWithAuthoringSurface,
  type MigrationScaffoldContext,
  type ModelCoordinate,
  modelDisplayName,
  type PlanOrigin,
  type ResolvedMigrationStatement,
  type ResolvedRenameStatement,
} from '@internal/framework-components/control';
import {
  collectionOfModel,
  embeddingModelOf,
  type MongoContract,
  mongoModelsOf,
} from '@internal/mongo-contract';
import type { MongoSchemaIR } from '@internal/mongo-schema-ir';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { notOk, type Result } from '@internal/utils/result';
import { unrewritableFieldNameReason } from './migration-factories';
import { collectionPlanOf, collectionPlanSchemasOf } from './mongo-collection-plan';
import {
  backfillTransform,
  convertTransform,
  type PlannedTransform,
} from './mongo-data-transforms';
import { documentsNotRewrittenWarnings } from './mongo-documents-not-rewritten';
import { planEnumValueRewrites } from './mongo-enum-value-planning';
import { planFieldFills } from './mongo-field-fills';
import {
  documentCollectionOf,
  isRootModel,
  modelCoordinates,
  modelsADropLoses,
} from './mongo-model-coordinates';
import {
  type DiscriminatorFilter,
  type OrderedRewrite,
  overlapRefusal,
  type RewriteFacts,
  variantDiscriminatorFilter,
} from './mongo-rewrite-overlaps';
import { type PlannedRewrite, rewriteRefusals } from './mongo-rewrite-refusals';
import {
  arrivalOf,
  type FieldRemoval,
  keepCollectionByHandAdvice,
  type ModelMatchInput,
  planFieldRemovals,
  planStatements,
  planValidatorFieldRemovals,
  type StatementCalls,
  type StatementPlan,
} from './mongo-statement-planning';
import type { CollectionRenames } from './mongo-storage-renames';
import { planStoredKeyFills } from './mongo-stored-key-fills';
import { planStoredKeyRewrites } from './mongo-stored-key-planning';
import { suppressedCallWarning } from './mongo-suppressed-calls';
import {
  castFieldCallOf,
  noCastRefusals,
  planFieldTypeChanges,
  planValidatorTypeChanges,
  type TypeChange,
  typeChangeConverted,
  unrewritableTypeChangeRefusals,
} from './mongo-type-changes';
import { mongoTypeLookupsOf } from './mongo-type-lookups';
import type { UnansweredChange } from './mongo-unanswered-changes';
import { planVariantDocumentRewrites, VARIANT_TWO_STEPS } from './mongo-variant-planning';
import type { OpFactoryCall } from './op-factory-call';
import { DropCollectionCall, ReplaceStoredValueCall } from './op-factory-call';
import { PlannerProducedMongoMigration } from './planner-produced-migration';

export type PlanCallsResult =
  | {
      readonly kind: 'success';
      readonly calls: OpFactoryCall[];
      /** One for each change a collection's control policy left out of the plan. */
      readonly warnings: readonly MigrationPlannerConflict[];
    }
  | { readonly kind: 'failure'; readonly conflicts: MigrationPlannerConflict[] };

/**
 * Each collection drop of the plan, with every model whose documents it loses. When such a model
 * keeps its name and the plan brings its new collection into existence, its question says why the
 * plan does not rename the collection: the models stored there are being split or merged, which is
 * a data migration, or its control policy is not `managed` in both contracts, and then how to
 * rename it by hand.
 */
function collectionDrops(
  calls: readonly OpFactoryCall[],
  fromContract: ContractWithDomain | null,
  contract: ContractWithDomain,
  renames: CollectionRenames,
  collections: { readonly origin: MongoSchemaIR; readonly destination: MongoSchemaIR },
): readonly MigrationDataLoss[] {
  const created = (collection: string) =>
    collections.origin.collection(collection) === undefined &&
    collections.destination.collection(collection) !== undefined;
  const adviceFor = (model: ModelCoordinate, dropped: string): string | undefined => {
    const destinationCollection = modelStoredInDestination(contract, model);
    if (destinationCollection === undefined || !created(destinationCollection)) return undefined;
    const change = { from: dropped, to: destinationCollection };
    const shared = renames.sharedCollection(change);
    if (shared !== undefined) return renames.sharedStorageAdvice(change, shared);
    return renames.managedOnBothSides(change)
      ? undefined
      : keepCollectionByHandAdvice(model, dropped, destinationCollection);
  };
  return calls.flatMap((call, operationIndex): readonly MigrationDataLoss[] => {
    if (!(call instanceof DropCollectionCall)) return [];
    const lost = { operationIndex, loss: 'drop', label: call.label } as const;
    const models = fromContract === null ? [] : modelsADropLoses(fromContract, call.collection);
    if (models.length === 0) {
      return [{ ...lost, subject: { kind: 'storage', name: call.collection } }];
    }
    return models.map((model) => ({
      ...lost,
      subject: { kind: 'model', ...model },
      ...ifDefined('keepDataAdvice', adviceFor(model, call.collection)),
    }));
  });
}

/** The collection the destination stores `model` in, when the destination still has that model. */
function modelStoredInDestination(
  contract: ContractWithDomain,
  model: ModelCoordinate,
): string | undefined {
  const namespace = contract.domain.namespaces[model.namespaceId];
  return namespace !== undefined && Object.hasOwn(namespace.models, model.model)
    ? collectionOfModel(contract.domain, model)
    : undefined;
}

export interface MongoPlanOptions {
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
}

function mongoContractOf(contract: unknown): MongoContract {
  return blindCast<
    MongoContract,
    'framework planner passes the Mongo contract selected for the mongo target'
  >(contract);
}

function mongoSchemaOf(schema: unknown): MongoSchemaIR {
  return blindCast<
    MongoSchemaIR,
    'framework planner passes the inspected Mongo schema IR selected for the mongo target'
  >(schema);
}

function renamesOf(
  statements: readonly ResolvedMigrationStatement[],
): readonly ResolvedRenameStatement[] {
  return statements.filter(
    (statement): statement is ResolvedRenameStatement => statement.kind === 'rename',
  );
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
    const contract = mongoContractOf(options.contract);
    const schema = mongoSchemaOf(options.schema);
    const schemas = collectionPlanSchemasOf(options.statementCalls?.schema ?? schema, contract);

    const collCreates: OpFactoryCall[] = [];
    const drops: OpFactoryCall[] = [];
    const creates: OpFactoryCall[] = [];
    const validatorOps: OpFactoryCall[] = [];
    const mutableOptionOps: OpFactoryCall[] = [];
    const collDrops: OpFactoryCall[] = [];
    const conflicts: MigrationPlannerConflict[] = [];
    const warnings: MigrationPlannerConflict[] = [];

    const allCollectionNames = new Set([
      ...schemas.origin.collectionNames,
      ...schemas.destination.collectionNames,
    ]);

    for (const collName of [...allCollectionNames].sort()) {
      const plan = collectionPlanOf(collName, schemas, {
        contract,
        fromContract: options.fromContract,
      });
      if (plan.kind === 'leftOut') {
        warnings.push(
          ...plan.calls.map((call) => suppressedCallWarning(call, collName, plan.control)),
        );
        continue;
      }
      const planned = plan.diff;
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

  plan(options: MongoPlanOptions): MigrationPlannerResult {
    const statementPlan = this.#statementPlanOf(options);
    if (!statementPlan.ok) return { kind: 'failure', conflicts: statementPlan.failure };
    return this.#planFrom(options, statementPlan.value);
  }

  /**
   * The renames of the plan. The refusals whose route tells the user to plan without some statements
   * read that plan: this planner's whole plan of the same contracts without them. Each nested plan
   * has fewer statements, so re-planning ends. It can go deeper than one level when leaving a
   * statement out pairs an origin model with a destination model of the same name, which the CLI's
   * resolver prevents by refusing a rename onto a name the origin has or from a name the
   * destination has. Each level makes its plan without the statements once, so the re-planning
   * stays linear in the number of levels.
   */
  #statementPlanOf(
    options: MongoPlanOptions,
  ): Result<StatementPlan, readonly MigrationPlannerConflict[]> {
    return planStatements({
      statements: renamesOf(options.statements),
      fromContract: options.fromContract,
      contract: mongoContractOf(options.contract),
      schema: mongoSchemaOf(options.schema),
      planWithout: (leftOut) => {
        const without = {
          ...options,
          statements: options.statements.filter(
            (statement) => !leftOut.some((each) => each === statement),
          ),
        };
        const statementPlan = this.#statementPlanOf(without);
        if (!statementPlan.ok) return statementPlan;
        const planned = this.#planFrom(without, statementPlan.value);
        return planned.kind === 'success' ? statementPlan : notOk(planned.conflicts);
      },
    });
  }

  #planFrom(options: MongoPlanOptions, statementPlan: StatementPlan): MigrationPlannerResult {
    const contract = mongoContractOf(options.contract);
    const fromContract = options.fromContract;
    const renames = renamesOf(options.statements);
    const {
      schema,
      collectionRenames,
      fieldRenameCalls,
      fieldRenames,
      callOfStatement,
      models,
      collections,
      renamedCollections,
    } = statementPlan;
    const destinationIR = contractToMongoSchemaIR(contract);
    const renamedTo = renamedCollections;
    const match: ModelMatchInput | undefined =
      fromContract === null
        ? undefined
        : {
            statements: renames,
            models,
            fieldRenames,
            fromContract,
            contract,
            collectionAfterRenames: (collection) => renamedTo.get(collection) ?? collection,
          };
    const arrivals = match === undefined ? undefined : arrivalOf(match);
    const storedKeys = planStoredKeyRewrites({
      statements: renames,
      fromContract,
      contract,
      schema,
      destination: destinationIR,
      arrivalOf: arrivals,
    });
    if (!storedKeys.ok) return { kind: 'failure', conflicts: [...storedKeys.failure] };
    const storedKeyRewrites = [...storedKeys.value.renames, ...storedKeys.value.removals];
    const enumValues = planEnumValueRewrites({
      statements: renames,
      fromContract,
      contract,
      schema,
      lookups: mongoTypeLookupsOf(options.frameworkComponents),
      arrivalOf: arrivals,
    });
    if (!enumValues.ok) return { kind: 'failure', conflicts: [...enumValues.failure] };
    const { replacements: valueReplacements, removals: valueRemovals } = enumValues.value;
    const lookups = mongoTypeLookupsOf(options.frameworkComponents);
    const plannedFills = planFieldFills({
      match,
      contract,
      lookups,
      schema,
      destination: destinationIR,
      statements: options.statements,
    });
    if (!plannedFills.ok) return { kind: 'failure', conflicts: [...plannedFills.failure] };
    const fills = plannedFills.value;
    const variants = planVariantDocumentRewrites({
      statements: options.statements,
      fromContract,
      contract,
      schema,
      collectionRenames,
      keptCollections: new Set(
        schema.collectionNames.filter((name) => destinationIR.collection(name) !== undefined),
      ),
      collectionAfterRenames: (collection) => renamedTo.get(collection) ?? collection,
      models,
      enumReplacements: valueReplacements.flatMap(({ call }) =>
        call instanceof ReplaceStoredValueCall ? [call] : [],
      ),
      fieldRenames,
      fieldRenameCalls: fieldRenameCalls.map(({ call }) => call),
    });
    if (!variants.ok) return { kind: 'failure', conflicts: [...variants.failure] };
    const { deletes: variantDeletes, replacements: variantReplacements } = variants.value;
    const variantCalls = new Set<OpFactoryCall>(variantReplacements.map(({ call }) => call));
    const removals: readonly FieldRemoval[] =
      fromContract === null
        ? planValidatorFieldRemovals({ origin: schema, destination: destinationIR, contract })
        : planFieldRemovals({
            statements: renames,
            models,
            fieldRenames,
            fromContract,
            contract,
            collectionAfterRenames: (collection) => renamedTo.get(collection) ?? collection,
            keptCollections: new Set(
              schema.collectionNames.filter((name) => destinationIR.collection(name) !== undefined),
            ),
          });
    const typeChanges: readonly TypeChange[] =
      fromContract === null
        ? planValidatorTypeChanges({ origin: schema, destination: destinationIR, contract })
        : planFieldTypeChanges(
            {
              statements: renames,
              models,
              fieldRenames,
              fromContract,
              contract,
              collectionAfterRenames: (collection) => renamedTo.get(collection) ?? collection,
              keptCollections: new Set(
                schema.collectionNames.filter(
                  (name) => destinationIR.collection(name) !== undefined,
                ),
              ),
            },
            lookups,
          );
    const contracts = { fromContract: fromContract ?? contract, contract };
    const converted: TypeChange[] = [];
    const transforms = options.statements.flatMap((statement): PlannedTransform[] => {
      if (statement.kind === 'convert' && statement.entity === 'field') {
        const change = typeChangeConverted(statement, typeChanges);
        if (change !== undefined) converted.push(change);
        return [{ statement, outcome: convertTransform(statement, change, contracts) }];
      }
      if (
        statement.kind === 'backfill' &&
        statement.entity === 'field' &&
        embeddingModelOf(contract.domain, statement.field) === undefined
      ) {
        return [
          {
            statement,
            outcome: backfillTransform(statement, { contract, schema, match }),
          },
        ];
      }
      return [];
    });
    const unconverted = typeChanges.filter((change) => !converted.includes(change));
    const rewritable = unconverted.filter(
      (change) => unrewritableFieldNameReason(change.field) === undefined,
    );
    const casts = rewritable.flatMap((change) => {
      const call = castFieldCallOf(change);
      return call === undefined ? [] : [{ ...change, call }];
    });
    const storedKeyFills = planStoredKeyFills({
      statements: options.statements,
      fromContract,
      contract,
      lookups,
      schema,
      destination: destinationIR,
      arrivalOf: arrivals,
    });
    if (!storedKeyFills.ok) return { kind: 'failure', conflicts: [...storedKeyFills.failure] };
    const rewrites: readonly PlannedRewrite[] = [
      ...removals.map(
        ({ call, destination, variant }): PlannedRewrite => ({
          kind: 'removal',
          collection: call.collection,
          field: call.field,
          variant,
          model: destination,
          storedKey: undefined,
          keepAdvice: 'keep the field in the contract',
          renameStatement: undefined,
        }),
      ),
      ...casts.map(
        (change): PlannedRewrite => ({
          kind: 'cast',
          collection: change.collection,
          field: change.field,
          variant: change.variant,
          model: change.destination,
          storedKey: undefined,
          keepAdvice: "keep the field's type in the contract",
          renameStatement: undefined,
        }),
      ),
      ...transforms.flatMap(({ outcome }) =>
        outcome.kind === 'transform' ? [outcome.rewrite] : [],
      ),
      ...fills.map(
        ({ call, subject, variant }): PlannedRewrite => ({
          kind: 'fill',
          collection: call.options.collection,
          field: call.options.field,
          variant,
          model: subject.kind === 'field' ? subject : undefined,
          storedKey: undefined,
          keepAdvice: 'make the field optional in the contract',
          renameStatement: undefined,
        }),
      ),
    ];
    const refusals = [
      ...transforms.flatMap(({ outcome }) =>
        outcome.kind === 'refused' ? [outcome.conflict] : [],
      ),
      ...unrewritableTypeChangeRefusals(unconverted, contract),
      ...noCastRefusals(rewritable, contract),
      ...rewrites.flatMap((rewrite) =>
        rewriteRefusals(
          rewrite,
          contract,
          {
            timeSeries: schema.collection(rewrite.collection)?.options?.timeseries !== undefined,
            validator: schema.collection(rewrite.collection)?.validator?.jsonSchema,
          },
          arrivals,
        ),
      ),
    ];
    if (refusals.length > 0) return { kind: 'failure', conflicts: refusals };
    const callsOf = new Map<ResolvedMigrationStatement, readonly OpFactoryCall[]>([
      ...renames.map((statement, index) => {
        const call = callOfStatement[index];
        const keyCalls = [
          ...storedKeyRewrites,
          ...variantReplacements,
          ...valueReplacements,
        ].flatMap((rewrite) => (rewrite.statement === statement ? [rewrite.call] : []));
        return [statement, call === undefined ? keyCalls : [call, ...keyCalls]] as const;
      }),
      ...transforms.map(({ statement, outcome }) =>
        outcome.kind === 'transform'
          ? ([statement, [outcome.call]] as const)
          : ([statement, []] as const),
      ),
      ...variantReplacements.flatMap((rewrite) =>
        rewrite.statement?.kind === 'convert' ? [[rewrite.statement, [rewrite.call]] as const] : [],
      ),
      ...options.statements.flatMap((statement) => {
        const calls = storedKeyFills.value.flatMap((fill) =>
          fill.statement === statement ? [fill.call] : [],
        );
        return calls.length === 0 ? [] : [[statement, calls] as const];
      }),
    ]);
    const twoMigrationsAdvice = new Map<OpFactoryCall, string>([
      ...[...valueReplacements, ...valueRemovals].map(
        (rewrite) => [rewrite.call, rewrite.twoMigrationsAdvice] as const,
      ),
      ...[...variantDeletes, ...variantReplacements].map(
        (rewrite) => [rewrite.call, VARIANT_TWO_STEPS] as const,
      ),
    ]);
    const changeOfCall = new Map<OpFactoryCall, UnansweredChange>([
      ...removals.map(({ call, subject }) => [call, { kind: 'removed', subject }] as const),
      ...variantDeletes.map(
        ({ call, model }) =>
          [call, { kind: 'removed', subject: { kind: 'model', ...model } }] as const,
      ),
      ...storedKeys.value.removals.map(
        ({ call, subject }) => [call, { kind: 'removed', subject }] as const,
      ),
      ...valueRemovals.map(
        ({ call, enumValue }) =>
          [call, { kind: 'removed', subject: { kind: 'enumValue', ...enumValue } }] as const,
      ),
      ...fills.map(({ call, subject }) => [call, { kind: 'newRequired', subject }] as const),
      ...storedKeyFills.value.flatMap(({ call, subject, text }) =>
        text === undefined ? [] : [[call, { kind: 'newRequired', subject }] as const],
      ),
    ]);
    const rewriteOf = (facts: RewriteFacts): OrderedRewrite => {
      const statements = options.statements.filter((statement) =>
        (callsOf.get(statement) ?? []).includes(facts.call),
      );
      return {
        ...facts,
        statements,
        twoMigrationsAdvice: twoMigrationsAdvice.get(facts.call),
        unanswered: statements.length === 0 ? changeOfCall.get(facts.call) : undefined,
      };
    };
    const writesDiscriminator = ({ statement }: PlannedTransform) => {
      const { namespaceId, model, field } = statement.field;
      return mongoModelsOf(contract.domain, namespaceId)[model]?.discriminator?.field === field;
    };
    const transformRewrites = (
      kind: 'convert' | 'backfill',
      selected: (transform: PlannedTransform) => boolean = () => true,
    ) =>
      transforms.filter(selected).flatMap(({ statement, outcome }) =>
        statement.kind === kind && outcome.kind === 'transform'
          ? [
              rewriteOf({
                kind: 'dataTransform',
                call: outcome.call,
                transformedField: outcome.rewrite.field,
                discriminatorFilter: variantDiscriminatorFilter(outcome.rewrite.variant),
              }),
            ]
          : [],
      );
    const fieldRenamesSelecting = (kind: DiscriminatorFilter['kind'] | undefined) =>
      fieldRenameCalls.flatMap(({ call, discriminatorFilter }) =>
        discriminatorFilter?.kind === kind
          ? [rewriteOf({ kind: 'renameField', call, discriminatorFilter })]
          : [],
      );
    const orderedRewrites = [
      ...fieldRenamesSelecting('variant'),
      ...fieldRenamesSelecting(undefined),
      ...variantDeletes.map(({ call, field, from }) =>
        rewriteOf({ kind: 'deleteDocuments', call, deletedVariant: { field, value: from } }),
      ),
      ...variantReplacements.map(({ call, to }) =>
        rewriteOf({
          kind: 'replaceStoredValue',
          call,
          writtenValue:
            valueReplacements.find((replacement) => replacement.call === call)?.writtenValue ?? to,
          discriminatorFilter: undefined,
        }),
      ),
      ...fieldRenamesSelecting('noneOf'),
      ...storedKeys.value.renames.map(({ call, variant }) =>
        rewriteOf({
          kind: 'renameStoredKey',
          call,
          discriminatorFilter: variantDiscriminatorFilter(variant),
        }),
      ),
      ...valueReplacements.flatMap(({ call, writtenValue, variant }) =>
        variantCalls.has(call)
          ? []
          : [
              rewriteOf({
                kind: 'replaceStoredValue',
                call,
                writtenValue,
                discriminatorFilter: variantDiscriminatorFilter(variant),
              }),
            ],
      ),
      ...transformRewrites('backfill', writesDiscriminator),
      ...casts.map(({ call, variant }) =>
        rewriteOf({
          kind: 'castField',
          call,
          discriminatorFilter: variantDiscriminatorFilter(variant),
        }),
      ),
      ...transformRewrites('convert'),
      ...fills.map(({ call, variant }) =>
        rewriteOf({
          kind: 'fillField',
          call,
          discriminatorFilter: variantDiscriminatorFilter(variant),
        }),
      ),
      ...storedKeyFills.value.map(({ call, variant }) =>
        rewriteOf({
          kind: 'fillStoredKey',
          call,
          discriminatorFilter: variantDiscriminatorFilter(variant),
        }),
      ),
      ...transformRewrites('backfill', (transform) => !writesDiscriminator(transform)),
      ...removals.map(({ call, discriminatorFilter }) =>
        rewriteOf({ kind: 'unsetField', call, discriminatorFilter }),
      ),
      ...storedKeys.value.removals.map(({ call, variant }) =>
        rewriteOf({
          kind: 'removeStoredKey',
          call,
          discriminatorFilter: variantDiscriminatorFilter(variant),
        }),
      ),
      ...valueRemovals.map(({ call, variant }) =>
        rewriteOf({
          kind: 'removeStoredValue',
          call,
          discriminatorFilter: variantDiscriminatorFilter(variant),
        }),
      ),
    ];
    const overlap = overlapRefusal(orderedRewrites, {
      ...contracts,
      statements: options.statements,
      fieldRenames,
    });
    if (overlap !== undefined) return { kind: 'failure', conflicts: [overlap] };
    const result = this.planCalls({
      ...options,
      statementCalls: {
        schema,
        collectionRenames,
        rewrites: orderedRewrites.map(({ call }) => call),
      },
    });
    if (result.kind === 'failure') return result;
    const { calls, warnings } = result;
    const allWarnings = [
      ...warnings,
      ...storedKeys.value.warnings,
      ...(match === undefined ? [] : documentsNotRewrittenWarnings(match)),
    ];
    const fieldLoss: readonly MigrationDataLoss[] = [
      ...variantDeletes.map(
        (rewrite): MigrationDataLoss => ({
          operationIndex: calls.indexOf(rewrite.call),
          subject: { kind: 'model', ...rewrite.model },
          loss: 'drop',
          label: rewrite.call.label,
        }),
      ),
      ...removals.map((removal) => ({
        operationIndex: calls.indexOf(removal.call),
        subject: removal.subject,
        loss: 'drop' as const,
        label: removal.call.label,
      })),
      ...storedKeys.value.removals.map((removal) => ({
        operationIndex: calls.indexOf(removal.call),
        subject: removal.subject,
        loss: 'drop' as const,
        label: removal.call.label,
      })),
      ...valueRemovals.map(
        (removal): MigrationDataLoss => ({
          operationIndex: calls.indexOf(removal.call),
          subject: { kind: 'enumValue', ...removal.enumValue },
          loss: 'drop',
          label: removal.call.label,
        }),
      ),
      ...casts.flatMap(({ call, subject }): MigrationDataLoss[] =>
        call.operationClass !== 'destructive'
          ? []
          : [
              {
                operationIndex: calls.indexOf(call),
                subject,
                loss: 'typeChange',
                label: call.label,
              },
            ],
      ),
    ];
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
      appliedStatements: options.statements.map((statement) => ({
        statement,
        operationIndexes: (callsOf.get(statement) ?? []).map((call) => calls.indexOf(call)),
      })),
      dataLoss: [
        ...collectionDrops(calls, fromContract, contract, collections, {
          origin: schema,
          destination: destinationIR,
        }),
        ...fieldLoss,
      ].sort((a, b) => a.operationIndex - b.operationIndex),
      accessChanges: [],
      temporaryValues: [
        ...fills.map((fill) => ({
          operationIndex: calls.indexOf(fill.call),
          subject: fill.subject,
          value: fill.text,
        })),
        ...storedKeyFills.value.flatMap(({ call, subject, text }) =>
          text === undefined ? [] : [{ operationIndex: calls.indexOf(call), subject, value: text }],
        ),
      ],
      ...(allWarnings.length > 0 ? { warnings: allWarnings } : {}),
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
