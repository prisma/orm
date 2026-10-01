import type { PlanMeta } from '@internal/contract/types';
import type { MongoModelDefinition } from '@internal/mongo-contract';
import type {
  MongoFieldShape,
  MongoPipelineStage,
  MongoQueryPlan,
} from '@internal/mongo-query-ast/execution';
import {
  AggregateCommand,
  MongoAndExpr,
  MongoLimitStage,
  MongoLookupStage,
  MongoMatchStage,
  MongoProjectStage,
  MongoSkipStage,
  MongoSortStage,
  MongoUnwindStage,
} from '@internal/mongo-query-ast/execution';
import {
  contractModelToMongoResultShape,
  type MongoValueObjects,
} from '@internal/mongo-query-builder';
import { ifDefined } from '@internal/utils/defined';
import type { MongoCollectionState, MongoIncludeExpr } from './collection-state';

function isToOne(include: MongoIncludeExpr): boolean {
  return include.cardinality === 'N:1' || include.cardinality === '1:1';
}

/**
 * An included document is decoded through the related model's codecs, like the root document. A to-one include with no related document reads as `null`.
 */
function includeShape(include: MongoIncludeExpr, valueObjects: MongoValueObjects): MongoFieldShape {
  const target = contractModelToMongoResultShape(include.targetModel, { valueObjects });
  const fields = target.kind === 'document' ? target.fields : {};
  return isToOne(include)
    ? { kind: 'document', nullable: true, fields }
    : { kind: 'array', nullable: false, element: { kind: 'document', nullable: false, fields } };
}

function compileIncludes(includes: readonly MongoIncludeExpr[]): MongoPipelineStage[] {
  const stages: MongoPipelineStage[] = [];

  for (const inc of includes) {
    stages.push(
      new MongoLookupStage({
        from: inc.from,
        localField: inc.localField,
        foreignField: inc.foreignField,
        as: inc.relationName,
      }),
    );

    if (isToOne(inc)) {
      stages.push(new MongoUnwindStage(`$${inc.relationName}`, true));
    }
  }

  return stages;
}

export function compileMongoQuery<Row = unknown>(
  collection: string,
  state: MongoCollectionState,
  storageHash: string,
  model: MongoModelDefinition,
  valueObjects: MongoValueObjects,
): MongoQueryPlan<Row> {
  const stages: MongoPipelineStage[] = [];

  const singleFilter = state.filters.length === 1 ? state.filters[0] : undefined;
  if (singleFilter) {
    stages.push(new MongoMatchStage(singleFilter));
  } else if (state.filters.length > 1) {
    stages.push(new MongoMatchStage(MongoAndExpr.of([...state.filters])));
  }

  if (state.includes.length > 0) {
    stages.push(...compileIncludes(state.includes));
  }

  if (state.orderBy) {
    stages.push(new MongoSortStage(state.orderBy));
  }

  if (state.offset !== undefined) {
    stages.push(new MongoSkipStage(state.offset));
  }

  if (state.limit !== undefined) {
    stages.push(new MongoLimitStage(state.limit));
  }

  if (state.selectedFields && state.selectedFields.length > 0) {
    const projection: Record<string, 0 | 1> = {};
    for (const field of state.selectedFields) {
      projection[field] = 1;
    }
    for (const inc of state.includes) {
      projection[inc.relationName] = 1;
    }
    if (!Object.hasOwn(projection, '_id')) {
      projection['_id'] = 0;
    }
    stages.push(new MongoProjectStage(projection));
  }

  const meta: PlanMeta = {
    target: 'mongo',
    storageHash,
    lane: 'mongo-orm',
  };
  const command = new AggregateCommand(collection, stages);

  const selection =
    state.selectedFields !== undefined && state.selectedFields.length > 0
      ? state.selectedFields
      : undefined;
  const resultShape = contractModelToMongoResultShape(model, {
    ...ifDefined('selection', selection),
    includes: Object.fromEntries(
      state.includes.map((inc) => [inc.relationName, includeShape(inc, valueObjects)]),
    ),
    valueObjects,
  });

  return { collection, command, meta, resultShape };
}
