import { isMongoPreparedParamRef, type MongoPreparedParamRef } from '@internal/mongo-value';
import type { MongoAggAccumulator, MongoAggExpr } from './aggregation-expressions';
import { MongoAstNode } from './ast-node';
import type { MongoFilterExpr } from './filter-expressions';
import { ormError } from './orm-errors';
import type {
  MongoAggExprRewriter,
  MongoStageRewriterContext,
  MongoStageVisitor,
} from './visitors';

export type MongoGroupId = null | MongoAggExpr | Readonly<Record<string, MongoAggExpr>>;
export type MongoProjectionValue = 0 | 1 | MongoAggExpr;

// Structural guard: MongoAggExpr nodes always carry a `kind` string discriminant,
// while scalar projection values (0 | 1) are numbers. This convention holds for all
// current AST node types. If non-node objects with `kind` are introduced in the future,
// consider a shared branded isAggExprNode() guard.
function isAggExpr(value: MongoProjectionValue): value is MongoAggExpr {
  return typeof value === 'object' && value !== null && 'kind' in value;
}

// Discriminate MongoAggExpr from Record<string, MongoAggExpr> via the accept() method
// that all AST nodes inherit from MongoAstNode. A plain record won't have accept(),
// so this is robust even if a compound _id contains a key named "kind".
function isAggExprNode(value: object): value is MongoAggExpr {
  return 'accept' in value && typeof value.accept === 'function';
}

function rewriteGroupId(groupId: MongoGroupId, rewriter: MongoAggExprRewriter): MongoGroupId {
  if (groupId === null) return null;
  if (isAggExprNode(groupId)) return groupId.rewrite(rewriter);
  const result: Record<string, MongoAggExpr> = {};
  for (const [key, val] of Object.entries(groupId)) {
    result[key] = val.rewrite(rewriter);
  }
  return result;
}

function rewriteExprRecord(
  fields: Readonly<Record<string, MongoAggExpr>>,
  rewriter: MongoAggExprRewriter,
): Record<string, MongoAggExpr> {
  const result: Record<string, MongoAggExpr> = {};
  for (const [key, val] of Object.entries(fields)) {
    result[key] = val.rewrite(rewriter);
  }
  return result;
}

function rewriteAccumulatorRecord(
  accumulators: Readonly<Record<string, MongoAggAccumulator>>,
  rewriter: MongoAggExprRewriter,
): Record<string, MongoAggAccumulator> {
  const result: Record<string, MongoAggAccumulator> = {};
  for (const [key, acc] of Object.entries(accumulators)) {
    result[key] = acc.rewrite(rewriter) as MongoAggAccumulator;
  }
  return result;
}

abstract class MongoStageNode extends MongoAstNode {
  abstract accept<R>(visitor: MongoStageVisitor<R>): R;
  abstract rewrite(context: MongoStageRewriterContext): MongoPipelineStage;
}

export class MongoMatchStage extends MongoStageNode {
  readonly kind = 'match' as const;
  readonly filter: MongoFilterExpr;

  constructor(filter: MongoFilterExpr) {
    super();
    this.filter = filter;
    this.freeze();
  }

  accept<R>(visitor: MongoStageVisitor<R>): R {
    return visitor.match(this);
  }

  rewrite(context: MongoStageRewriterContext): MongoPipelineStage {
    return new MongoMatchStage(this.filter.rewrite(context.filter ?? {}));
  }
}

export class MongoProjectStage extends MongoStageNode {
  readonly kind = 'project' as const;
  readonly projection: Readonly<Record<string, MongoProjectionValue>>;

  constructor(projection: Record<string, MongoProjectionValue>) {
    super();
    this.projection = Object.freeze({ ...projection });
    this.freeze();
  }

  accept<R>(visitor: MongoStageVisitor<R>): R {
    return visitor.project(this);
  }

  rewrite(context: MongoStageRewriterContext): MongoPipelineStage {
    const rewriter = context.aggExpr;
    if (!rewriter) return this;
    let hasExpr = false;
    for (const val of Object.values(this.projection)) {
      if (isAggExpr(val)) {
        hasExpr = true;
        break;
      }
    }
    if (!hasExpr) return this;
    const newProjection: Record<string, MongoProjectionValue> = {};
    for (const [key, val] of Object.entries(this.projection)) {
      newProjection[key] = isAggExpr(val) ? val.rewrite(rewriter) : val;
    }
    return new MongoProjectStage(newProjection);
  }
}

export class MongoSortStage extends MongoStageNode {
  readonly kind = 'sort' as const;
  readonly sort: Readonly<Record<string, 1 | -1>>;

  constructor(sort: Record<string, 1 | -1>) {
    super();
    this.sort = Object.freeze({ ...sort });
    this.freeze();
  }

  accept<R>(visitor: MongoStageVisitor<R>): R {
    return visitor.sort(this);
  }

  rewrite(_context: MongoStageRewriterContext): MongoPipelineStage {
    return this;
  }
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

export class MongoLimitStage extends MongoStageNode {
  readonly kind = 'limit' as const;
  readonly limit: number | MongoPreparedParamRef;

  constructor(limit: number | MongoPreparedParamRef) {
    super();
    if (!isMongoPreparedParamRef(limit) && !isNonNegativeInteger(limit)) {
      throw ormError('ORM.ARGUMENT_INVALID', 'limit must be a non-negative integer');
    }
    this.limit = limit;
    this.freeze();
  }

  accept<R>(visitor: MongoStageVisitor<R>): R {
    return visitor.limit(this);
  }

  rewrite(_context: MongoStageRewriterContext): MongoPipelineStage {
    return this;
  }
}

export class MongoSkipStage extends MongoStageNode {
  readonly kind = 'skip' as const;
  readonly skip: number | MongoPreparedParamRef;

  constructor(skip: number | MongoPreparedParamRef) {
    super();
    if (!isMongoPreparedParamRef(skip) && !isNonNegativeInteger(skip)) {
      throw ormError('ORM.ARGUMENT_INVALID', 'skip must be a non-negative integer');
    }
    this.skip = skip;
    this.freeze();
  }

  accept<R>(visitor: MongoStageVisitor<R>): R {
    return visitor.skip(this);
  }

  rewrite(_context: MongoStageRewriterContext): MongoPipelineStage {
    return this;
  }
}

export class MongoLookupStage extends MongoStageNode {
  readonly kind = 'lookup' as const;
  readonly from: string;
  readonly localField: string | undefined;
  readonly foreignField: string | undefined;
  readonly as: string;
  readonly pipeline: ReadonlyArray<MongoPipelineStage> | undefined;
  readonly let_: Readonly<Record<string, MongoAggExpr>> | undefined;

  constructor(options: {
    from: string;
    localField?: string;
    foreignField?: string;
    as: string;
    pipeline?: ReadonlyArray<MongoPipelineStage>;
    let_?: Record<string, MongoAggExpr>;
  }) {
    super();
    const hasLocalField = options.localField !== undefined;
    const hasForeignField = options.foreignField !== undefined;
    const hasPipeline = !!options.pipeline;
    if (hasLocalField !== hasForeignField) {
      throw ormError(
        'ORM.ARGUMENT_INVALID',
        'MongoLookupStage requires both localField and foreignField together',
      );
    }
    if (!hasLocalField && !hasPipeline) {
      throw ormError(
        'ORM.ARGUMENT_INVALID',
        'MongoLookupStage requires either equality fields (localField/foreignField) or a pipeline',
      );
    }
    if (options.let_ && !hasPipeline) {
      throw ormError('ORM.ARGUMENT_INVALID', 'MongoLookupStage let_ requires a pipeline');
    }
    this.from = options.from;
    this.localField = options.localField;
    this.foreignField = options.foreignField;
    this.as = options.as;
    this.pipeline = options.pipeline ? Object.freeze([...options.pipeline]) : undefined;
    this.let_ = options.let_ ? Object.freeze({ ...options.let_ }) : undefined;
    this.freeze();
  }

  accept<R>(visitor: MongoStageVisitor<R>): R {
    return visitor.lookup(this);
  }

  rewrite(context: MongoStageRewriterContext): MongoPipelineStage {
    if (!this.pipeline && !this.let_) return this;
    const rewrittenLet =
      this.let_ && context.aggExpr ? rewriteExprRecord(this.let_, context.aggExpr) : this.let_;
    const options: {
      from: string;
      localField?: string;
      foreignField?: string;
      as: string;
      pipeline?: ReadonlyArray<MongoPipelineStage>;
      let_?: Record<string, MongoAggExpr>;
    } = { from: this.from, as: this.as };
    if (this.localField !== undefined) options.localField = this.localField;
    if (this.foreignField !== undefined) options.foreignField = this.foreignField;
    if (this.pipeline) options.pipeline = this.pipeline.map((stage) => stage.rewrite(context));
    if (rewrittenLet) options.let_ = { ...rewrittenLet };
    return new MongoLookupStage(options);
  }
}

export class MongoUnwindStage extends MongoStageNode {
  readonly kind = 'unwind' as const;
  readonly path: string;
  readonly preserveNullAndEmptyArrays: boolean;
  readonly includeArrayIndex: string | undefined;

  constructor(path: string, preserveNullAndEmptyArrays: boolean, includeArrayIndex?: string) {
    super();
    this.path = path;
    this.preserveNullAndEmptyArrays = preserveNullAndEmptyArrays;
    this.includeArrayIndex = includeArrayIndex;
    this.freeze();
  }

  accept<R>(visitor: MongoStageVisitor<R>): R {
    return visitor.unwind(this);
  }

  rewrite(_context: MongoStageRewriterContext): MongoPipelineStage {
    return this;
  }
}

export class MongoGroupStage extends MongoStageNode {
  readonly kind = 'group' as const;
  readonly groupId: MongoGroupId;
  readonly accumulators: Readonly<Record<string, MongoAggAccumulator>>;

  constructor(groupId: MongoGroupId, accumulators: Record<string, MongoAggAccumulator>) {
    super();
    this.groupId = groupId;
    this.accumulators = Object.freeze({ ...accumulators });
    this.freeze();
  }

  accept<R>(visitor: MongoStageVisitor<R>): R {
    return visitor.group(this);
  }

  rewrite(context: MongoStageRewriterContext): MongoPipelineStage {
    const rewriter = context.aggExpr;
    if (!rewriter) return this;
    const newAccumulators: Record<string, MongoAggAccumulator> = {};
    for (const [key, acc] of Object.entries(this.accumulators)) {
      // MongoAggAccumulator.rewrite() returns MongoAggExpr (the base union). The cast is safe
      // because the default rewriter rebuilds an accumulator from its rewritten arg. A custom
      // accumulator() hook could technically return a non-accumulator — narrowing the return type
      // on MongoAggAccumulator.rewrite() is tracked as a follow-up for the agg expression AST.
      newAccumulators[key] = acc.rewrite(rewriter) as MongoAggAccumulator;
    }
    return new MongoGroupStage(rewriteGroupId(this.groupId, rewriter), newAccumulators);
  }
}

export class MongoAddFieldsStage extends MongoStageNode {
  readonly kind = 'addFields' as const;
  readonly fields: Readonly<Record<string, MongoAggExpr>>;

  constructor(fields: Record<string, MongoAggExpr>) {
    super();
    this.fields = Object.freeze({ ...fields });
    this.freeze();
  }

  accept<R>(visitor: MongoStageVisitor<R>): R {
    return visitor.addFields(this);
  }

  rewrite(context: MongoStageRewriterContext): MongoPipelineStage {
    const rewriter = context.aggExpr;
    if (!rewriter) return this;
    return new MongoAddFieldsStage(rewriteExprRecord(this.fields, rewriter));
  }
}

export class MongoReplaceRootStage extends MongoStageNode {
  readonly kind = 'replaceRoot' as const;
  readonly newRoot: MongoAggExpr;

  constructor(newRoot: MongoAggExpr) {
    super();
    this.newRoot = newRoot;
    this.freeze();
  }

  accept<R>(visitor: MongoStageVisitor<R>): R {
    return visitor.replaceRoot(this);
  }

  rewrite(context: MongoStageRewriterContext): MongoPipelineStage {
    const rewriter = context.aggExpr;
    if (!rewriter) return this;
    return new MongoReplaceRootStage(this.newRoot.rewrite(rewriter));
  }
}

export class MongoCountStage extends MongoStageNode {
  readonly kind = 'count' as const;
  readonly field: string;

  constructor(field: string) {
    super();
    this.field = field;
    this.freeze();
  }

  accept<R>(visitor: MongoStageVisitor<R>): R {
    return visitor.count(this);
  }

  rewrite(_context: MongoStageRewriterContext): MongoPipelineStage {
    return this;
  }
}

export class MongoSortByCountStage extends MongoStageNode {
  readonly kind = 'sortByCount' as const;
  readonly expr: MongoAggExpr;

  constructor(expr: MongoAggExpr) {
    super();
    this.expr = expr;
    this.freeze();
  }

  accept<R>(visitor: MongoStageVisitor<R>): R {
    return visitor.sortByCount(this);
  }

  rewrite(context: MongoStageRewriterContext): MongoPipelineStage {
    const rewriter = context.aggExpr;
    if (!rewriter) return this;
    return new MongoSortByCountStage(this.expr.rewrite(rewriter));
  }
}

export class MongoSampleStage extends MongoStageNode {
  readonly kind = 'sample' as const;
  readonly size: number;

  constructor(size: number) {
    super();
    if (!Number.isInteger(size) || size < 0) {
      throw ormError('ORM.ARGUMENT_INVALID', 'size must be a non-negative integer');
    }
    this.size = size;
    this.freeze();
  }

  accept<R>(visitor: MongoStageVisitor<R>): R {
    return visitor.sample(this);
  }

  rewrite(_context: MongoStageRewriterContext): MongoPipelineStage {
    return this;
  }
}

export class MongoRedactStage extends MongoStageNode {
  readonly kind = 'redact' as const;
  readonly expr: MongoAggExpr;

  constructor(expr: MongoAggExpr) {
    super();
    this.expr = expr;
    this.freeze();
  }

  accept<R>(visitor: MongoStageVisitor<R>): R {
    return visitor.redact(this);
  }

  rewrite(context: MongoStageRewriterContext): MongoPipelineStage {
    const rewriter = context.aggExpr;
    if (!rewriter) return this;
    return new MongoRedactStage(this.expr.rewrite(rewriter));
  }
}

export class MongoOutStage extends MongoStageNode {
  readonly kind = 'out' as const;
  readonly collection: string;
  readonly db: string | undefined;

  constructor(collection: string, db?: string) {
    super();
    this.collection = collection;
    this.db = db;
    this.freeze();
  }

  accept<R>(visitor: MongoStageVisitor<R>): R {
    return visitor.out(this);
  }

  rewrite(_context: MongoStageRewriterContext): MongoPipelineStage {
    return this;
  }
}

export class MongoUnionWithStage extends MongoStageNode {
  readonly kind = 'unionWith' as const;
  readonly collection: string;
  readonly pipeline: ReadonlyArray<MongoPipelineStage> | undefined;

  constructor(collection: string, pipeline?: ReadonlyArray<MongoPipelineStage>) {
    super();
    this.collection = collection;
    this.pipeline = pipeline ? Object.freeze([...pipeline]) : undefined;
    this.freeze();
  }

  accept<R>(visitor: MongoStageVisitor<R>): R {
    return visitor.unionWith(this);
  }

  rewrite(context: MongoStageRewriterContext): MongoPipelineStage {
    if (!this.pipeline) return this;
    return new MongoUnionWithStage(
      this.collection,
      this.pipeline.map((stage) => stage.rewrite(context)),
    );
  }
}

export class MongoBucketStage extends MongoStageNode {
  readonly kind = 'bucket' as const;
  readonly groupBy: MongoAggExpr;
  readonly boundaries: ReadonlyArray<unknown>;
  readonly default_: unknown;
  readonly output: Readonly<Record<string, MongoAggAccumulator>> | undefined;

  constructor(options: {
    groupBy: MongoAggExpr;
    boundaries: ReadonlyArray<unknown>;
    default_?: unknown;
    output?: Record<string, MongoAggAccumulator>;
  }) {
    super();
    if (options.boundaries.length < 2) {
      throw ormError('ORM.ARGUMENT_INVALID', 'boundaries must contain at least 2 values');
    }
    this.groupBy = options.groupBy;
    this.boundaries = Object.freeze([...options.boundaries]);
    this.default_ = options.default_;
    this.output = options.output ? Object.freeze({ ...options.output }) : undefined;
    this.freeze();
  }

  accept<R>(visitor: MongoStageVisitor<R>): R {
    return visitor.bucket(this);
  }

  rewrite(context: MongoStageRewriterContext): MongoPipelineStage {
    const rewriter = context.aggExpr;
    if (!rewriter) return this;
    const opts: {
      groupBy: MongoAggExpr;
      boundaries: ReadonlyArray<unknown>;
      default_?: unknown;
      output?: Record<string, MongoAggAccumulator>;
    } = { groupBy: this.groupBy.rewrite(rewriter), boundaries: this.boundaries };
    if (this.default_ !== undefined) opts.default_ = this.default_;
    if (this.output) opts.output = rewriteAccumulatorRecord(this.output, rewriter);
    return new MongoBucketStage(opts);
  }
}

export class MongoBucketAutoStage extends MongoStageNode {
  readonly kind = 'bucketAuto' as const;
  readonly groupBy: MongoAggExpr;
  readonly buckets: number;
  readonly output: Readonly<Record<string, MongoAggAccumulator>> | undefined;
  readonly granularity: string | undefined;

  constructor(options: {
    groupBy: MongoAggExpr;
    buckets: number;
    output?: Record<string, MongoAggAccumulator>;
    granularity?: string;
  }) {
    super();
    if (!Number.isInteger(options.buckets) || options.buckets < 1) {
      throw ormError('ORM.ARGUMENT_INVALID', 'buckets must be a positive integer');
    }
    this.groupBy = options.groupBy;
    this.buckets = options.buckets;
    this.output = options.output ? Object.freeze({ ...options.output }) : undefined;
    this.granularity = options.granularity;
    this.freeze();
  }

  accept<R>(visitor: MongoStageVisitor<R>): R {
    return visitor.bucketAuto(this);
  }

  rewrite(context: MongoStageRewriterContext): MongoPipelineStage {
    const rewriter = context.aggExpr;
    if (!rewriter) return this;
    const opts: {
      groupBy: MongoAggExpr;
      buckets: number;
      output?: Record<string, MongoAggAccumulator>;
      granularity?: string;
    } = { groupBy: this.groupBy.rewrite(rewriter), buckets: this.buckets };
    if (this.output) opts.output = rewriteAccumulatorRecord(this.output, rewriter);
    if (this.granularity !== undefined) opts.granularity = this.granularity;
    return new MongoBucketAutoStage(opts);
  }
}

export class MongoGeoNearStage extends MongoStageNode {
  readonly kind = 'geoNear' as const;
  readonly near: unknown;
  readonly distanceField: string;
  readonly spherical: boolean | undefined;
  readonly maxDistance: number | undefined;
  readonly minDistance: number | undefined;
  readonly query: MongoFilterExpr | undefined;
  readonly key: string | undefined;
  readonly distanceMultiplier: number | undefined;
  readonly includeLocs: string | undefined;

  constructor(options: {
    near: unknown;
    distanceField: string;
    spherical?: boolean;
    maxDistance?: number;
    minDistance?: number;
    query?: MongoFilterExpr;
    key?: string;
    distanceMultiplier?: number;
    includeLocs?: string;
  }) {
    super();
    this.near = options.near;
    this.distanceField = options.distanceField;
    this.spherical = options.spherical;
    this.maxDistance = options.maxDistance;
    this.minDistance = options.minDistance;
    this.query = options.query;
    this.key = options.key;
    this.distanceMultiplier = options.distanceMultiplier;
    this.includeLocs = options.includeLocs;
    this.freeze();
  }

  accept<R>(visitor: MongoStageVisitor<R>): R {
    return visitor.geoNear(this);
  }

  rewrite(context: MongoStageRewriterContext): MongoPipelineStage {
    if (!this.query || !context.filter) return this;
    const opts: {
      near: unknown;
      distanceField: string;
      spherical?: boolean;
      maxDistance?: number;
      minDistance?: number;
      query?: MongoFilterExpr;
      key?: string;
      distanceMultiplier?: number;
      includeLocs?: string;
    } = { near: this.near, distanceField: this.distanceField };
    if (this.spherical !== undefined) opts.spherical = this.spherical;
    if (this.maxDistance !== undefined) opts.maxDistance = this.maxDistance;
    if (this.minDistance !== undefined) opts.minDistance = this.minDistance;
    opts.query = this.query.rewrite(context.filter);
    if (this.key !== undefined) opts.key = this.key;
    if (this.distanceMultiplier !== undefined) opts.distanceMultiplier = this.distanceMultiplier;
    if (this.includeLocs !== undefined) opts.includeLocs = this.includeLocs;
    return new MongoGeoNearStage(opts);
  }
}

export class MongoFacetStage extends MongoStageNode {
  readonly kind = 'facet' as const;
  readonly facets: Readonly<Record<string, ReadonlyArray<MongoPipelineStage>>>;

  constructor(facets: Record<string, ReadonlyArray<MongoPipelineStage>>) {
    super();
    const frozen: Record<string, ReadonlyArray<MongoPipelineStage>> = {};
    for (const [key, pipeline] of Object.entries(facets)) {
      frozen[key] = Object.freeze([...pipeline]);
    }
    this.facets = Object.freeze(frozen);
    this.freeze();
  }

  accept<R>(visitor: MongoStageVisitor<R>): R {
    return visitor.facet(this);
  }

  rewrite(context: MongoStageRewriterContext): MongoPipelineStage {
    const newFacets: Record<string, ReadonlyArray<MongoPipelineStage>> = {};
    for (const [key, pipeline] of Object.entries(this.facets)) {
      newFacets[key] = pipeline.map((stage) => stage.rewrite(context));
    }
    return new MongoFacetStage(newFacets);
  }
}

export class MongoGraphLookupStage extends MongoStageNode {
  readonly kind = 'graphLookup' as const;
  readonly from: string;
  readonly startWith: MongoAggExpr;
  readonly connectFromField: string;
  readonly connectToField: string;
  readonly as: string;
  readonly maxDepth: number | undefined;
  readonly depthField: string | undefined;
  readonly restrictSearchWithMatch: MongoFilterExpr | undefined;

  constructor(options: {
    from: string;
    startWith: MongoAggExpr;
    connectFromField: string;
    connectToField: string;
    as: string;
    maxDepth?: number;
    depthField?: string;
    restrictSearchWithMatch?: MongoFilterExpr;
  }) {
    super();
    this.from = options.from;
    this.startWith = options.startWith;
    this.connectFromField = options.connectFromField;
    this.connectToField = options.connectToField;
    this.as = options.as;
    this.maxDepth = options.maxDepth;
    this.depthField = options.depthField;
    this.restrictSearchWithMatch = options.restrictSearchWithMatch;
    this.freeze();
  }

  accept<R>(visitor: MongoStageVisitor<R>): R {
    return visitor.graphLookup(this);
  }

  rewrite(context: MongoStageRewriterContext): MongoPipelineStage {
    const rewrittenStartWith = context.aggExpr
      ? this.startWith.rewrite(context.aggExpr)
      : this.startWith;
    const rewrittenMatch =
      this.restrictSearchWithMatch && context.filter
        ? this.restrictSearchWithMatch.rewrite(context.filter)
        : this.restrictSearchWithMatch;
    if (rewrittenStartWith === this.startWith && rewrittenMatch === this.restrictSearchWithMatch) {
      return this;
    }
    const opts: {
      from: string;
      startWith: MongoAggExpr;
      connectFromField: string;
      connectToField: string;
      as: string;
      maxDepth?: number;
      depthField?: string;
      restrictSearchWithMatch?: MongoFilterExpr;
    } = {
      from: this.from,
      startWith: rewrittenStartWith,
      connectFromField: this.connectFromField,
      connectToField: this.connectToField,
      as: this.as,
    };
    if (this.maxDepth !== undefined) opts.maxDepth = this.maxDepth;
    if (this.depthField !== undefined) opts.depthField = this.depthField;
    if (rewrittenMatch) opts.restrictSearchWithMatch = rewrittenMatch;
    return new MongoGraphLookupStage(opts);
  }
}

export class MongoMergeStage extends MongoStageNode {
  readonly kind = 'merge' as const;
  readonly into: string | { readonly db: string; readonly coll: string };
  readonly on: string | ReadonlyArray<string> | undefined;
  readonly whenMatched: string | ReadonlyArray<MongoUpdatePipelineStage> | undefined;
  readonly whenNotMatched: string | undefined;

  constructor(options: {
    into: string | { db: string; coll: string };
    on?: string | ReadonlyArray<string>;
    whenMatched?: string | ReadonlyArray<MongoUpdatePipelineStage>;
    whenNotMatched?: string;
  }) {
    super();
    this.into =
      typeof options.into === 'string' ? options.into : Object.freeze({ ...options.into });
    this.on =
      options.on === undefined
        ? undefined
        : typeof options.on === 'string'
          ? options.on
          : Object.freeze([...options.on]);
    this.whenMatched =
      options.whenMatched === undefined
        ? undefined
        : typeof options.whenMatched === 'string'
          ? options.whenMatched
          : Object.freeze([...options.whenMatched]);
    this.whenNotMatched = options.whenNotMatched;
    this.freeze();
  }

  accept<R>(visitor: MongoStageVisitor<R>): R {
    return visitor.merge(this);
  }

  rewrite(context: MongoStageRewriterContext): MongoPipelineStage {
    if (!Array.isArray(this.whenMatched)) return this;
    const opts: {
      into: string | { db: string; coll: string };
      on?: string | ReadonlyArray<string>;
      whenMatched?: string | ReadonlyArray<MongoUpdatePipelineStage>;
      whenNotMatched?: string;
    } = { into: this.into };
    if (this.on !== undefined) opts.on = this.on;
    // rewrite() preserves the concrete stage type at runtime
    opts.whenMatched = this.whenMatched.map(
      (stage) => stage.rewrite(context) as MongoUpdatePipelineStage,
    );
    if (this.whenNotMatched !== undefined) opts.whenNotMatched = this.whenNotMatched;
    return new MongoMergeStage(opts);
  }
}

export interface MongoWindowField {
  readonly operator: MongoAggExpr;
  readonly window?: {
    readonly documents?: readonly [number, number];
    readonly range?: { readonly start: unknown; readonly end: unknown; readonly unit?: string };
  };
}

export class MongoSetWindowFieldsStage extends MongoStageNode {
  readonly kind = 'setWindowFields' as const;
  readonly partitionBy: MongoAggExpr | undefined;
  readonly sortBy: Readonly<Record<string, 1 | -1>> | undefined;
  readonly output: Readonly<Record<string, MongoWindowField>>;

  constructor(options: {
    partitionBy?: MongoAggExpr;
    sortBy?: Record<string, 1 | -1>;
    output: Record<string, MongoWindowField>;
  }) {
    super();
    this.partitionBy = options.partitionBy;
    this.sortBy = options.sortBy ? Object.freeze({ ...options.sortBy }) : undefined;
    this.output = Object.freeze({ ...options.output });
    this.freeze();
  }

  accept<R>(visitor: MongoStageVisitor<R>): R {
    return visitor.setWindowFields(this);
  }

  rewrite(context: MongoStageRewriterContext): MongoPipelineStage {
    const rewriter = context.aggExpr;
    if (!rewriter) return this;
    const newOutput: Record<string, MongoWindowField> = {};
    for (const [key, wf] of Object.entries(this.output)) {
      newOutput[key] = { ...wf, operator: wf.operator.rewrite(rewriter) };
    }
    const opts: {
      partitionBy?: MongoAggExpr;
      sortBy?: Record<string, 1 | -1>;
      output: Record<string, MongoWindowField>;
    } = { output: newOutput };
    if (this.partitionBy) opts.partitionBy = this.partitionBy.rewrite(rewriter);
    if (this.sortBy) opts.sortBy = { ...this.sortBy };
    return new MongoSetWindowFieldsStage(opts);
  }
}

export interface MongoDensifyRange {
  readonly step: number;
  readonly unit?: string;
  readonly bounds: 'full' | 'partition' | readonly [unknown, unknown];
}

export class MongoDensifyStage extends MongoStageNode {
  readonly kind = 'densify' as const;
  readonly field: string;
  readonly partitionByFields: ReadonlyArray<string> | undefined;
  readonly range: MongoDensifyRange;

  constructor(options: {
    field: string;
    partitionByFields?: ReadonlyArray<string>;
    range: MongoDensifyRange;
  }) {
    super();
    this.field = options.field;
    this.partitionByFields = options.partitionByFields
      ? Object.freeze([...options.partitionByFields])
      : undefined;
    this.range = Object.freeze({ ...options.range });
    this.freeze();
  }

  accept<R>(visitor: MongoStageVisitor<R>): R {
    return visitor.densify(this);
  }

  rewrite(_context: MongoStageRewriterContext): MongoPipelineStage {
    return this;
  }
}

export interface MongoFillOutput {
  readonly method?: string;
  readonly value?: MongoAggExpr;
}

export class MongoFillStage extends MongoStageNode {
  readonly kind = 'fill' as const;
  readonly partitionBy: MongoAggExpr | undefined;
  readonly partitionByFields: ReadonlyArray<string> | undefined;
  readonly sortBy: Readonly<Record<string, 1 | -1>> | undefined;
  readonly output: Readonly<Record<string, MongoFillOutput>>;

  constructor(options: {
    partitionBy?: MongoAggExpr;
    partitionByFields?: ReadonlyArray<string>;
    sortBy?: Record<string, 1 | -1>;
    output: Record<string, MongoFillOutput>;
  }) {
    super();
    this.partitionBy = options.partitionBy;
    this.partitionByFields = options.partitionByFields
      ? Object.freeze([...options.partitionByFields])
      : undefined;
    this.sortBy = options.sortBy ? Object.freeze({ ...options.sortBy }) : undefined;
    this.output = Object.freeze({ ...options.output });
    this.freeze();
  }

  accept<R>(visitor: MongoStageVisitor<R>): R {
    return visitor.fill(this);
  }

  rewrite(context: MongoStageRewriterContext): MongoPipelineStage {
    const rewriter = context.aggExpr;
    if (!rewriter) return this;
    const newOutput: Record<string, MongoFillOutput> = {};
    for (const [key, fo] of Object.entries(this.output)) {
      newOutput[key] = fo.value ? { ...fo, value: fo.value.rewrite(rewriter) } : fo;
    }
    const opts: {
      partitionBy?: MongoAggExpr;
      partitionByFields?: ReadonlyArray<string>;
      sortBy?: Record<string, 1 | -1>;
      output: Record<string, MongoFillOutput>;
    } = { output: newOutput };
    if (this.partitionBy) opts.partitionBy = this.partitionBy.rewrite(rewriter);
    if (this.partitionByFields) opts.partitionByFields = [...this.partitionByFields];
    if (this.sortBy) opts.sortBy = { ...this.sortBy };
    return new MongoFillStage(opts);
  }
}

export class MongoSearchStage extends MongoStageNode {
  readonly kind = 'search' as const;
  readonly index: string | undefined;
  readonly config: Readonly<Record<string, unknown>>;

  constructor(config: Record<string, unknown>, index?: string) {
    super();
    this.config = Object.freeze({ ...config });
    this.index = index;
    this.freeze();
  }

  accept<R>(visitor: MongoStageVisitor<R>): R {
    return visitor.search(this);
  }

  rewrite(_context: MongoStageRewriterContext): MongoPipelineStage {
    return this;
  }
}

export class MongoSearchMetaStage extends MongoStageNode {
  readonly kind = 'searchMeta' as const;
  readonly index: string | undefined;
  readonly config: Readonly<Record<string, unknown>>;

  constructor(config: Record<string, unknown>, index?: string) {
    super();
    this.config = Object.freeze({ ...config });
    this.index = index;
    this.freeze();
  }

  accept<R>(visitor: MongoStageVisitor<R>): R {
    return visitor.searchMeta(this);
  }

  rewrite(_context: MongoStageRewriterContext): MongoPipelineStage {
    return this;
  }
}

export class MongoVectorSearchStage extends MongoStageNode {
  readonly kind = 'vectorSearch' as const;
  readonly index: string;
  readonly path: string;
  readonly queryVector: ReadonlyArray<number>;
  readonly numCandidates: number;
  readonly limit: number;
  readonly filter: Readonly<Record<string, unknown>> | undefined;

  constructor(options: {
    index: string;
    path: string;
    queryVector: ReadonlyArray<number>;
    numCandidates: number;
    limit: number;
    filter?: Record<string, unknown>;
  }) {
    super();
    if (!Number.isInteger(options.limit) || options.limit < 1) {
      throw ormError('ORM.ARGUMENT_INVALID', 'limit must be a positive integer');
    }
    if (!Number.isInteger(options.numCandidates) || options.numCandidates < options.limit) {
      throw ormError('ORM.ARGUMENT_INVALID', 'numCandidates must be an integer >= limit');
    }
    this.index = options.index;
    this.path = options.path;
    this.queryVector = Object.freeze([...options.queryVector]);
    this.numCandidates = options.numCandidates;
    this.limit = options.limit;
    this.filter = options.filter ? Object.freeze({ ...options.filter }) : undefined;
    this.freeze();
  }

  accept<R>(visitor: MongoStageVisitor<R>): R {
    return visitor.vectorSearch(this);
  }

  rewrite(_context: MongoStageRewriterContext): MongoPipelineStage {
    return this;
  }
}

export type MongoUpdatePipelineStage =
  | MongoAddFieldsStage
  | MongoProjectStage
  | MongoReplaceRootStage;

export type MongoPipelineStage =
  | MongoMatchStage
  | MongoProjectStage
  | MongoSortStage
  | MongoLimitStage
  | MongoSkipStage
  | MongoLookupStage
  | MongoUnwindStage
  | MongoGroupStage
  | MongoAddFieldsStage
  | MongoReplaceRootStage
  | MongoCountStage
  | MongoSortByCountStage
  | MongoSampleStage
  | MongoRedactStage
  | MongoOutStage
  | MongoUnionWithStage
  | MongoBucketStage
  | MongoBucketAutoStage
  | MongoGeoNearStage
  | MongoFacetStage
  | MongoGraphLookupStage
  | MongoMergeStage
  | MongoSetWindowFieldsStage
  | MongoDensifyStage
  | MongoFillStage
  | MongoSearchStage
  | MongoSearchMetaStage
  | MongoVectorSearchStage;
