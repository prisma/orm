import type { JsonValue } from '@internal/contract/types';
import {
  type AnyCodecDescriptor,
  type AnyCodecDescriptorTemplate,
  type Codec,
  type CodecDescriptor,
  CodecDescriptorImpl,
  type CodecDescriptorTemplate,
  type CodecInstanceContext,
  type CodecRef,
  type CodecTrait,
  type DataTypeId,
  validateCodecTypeParams,
} from '@internal/framework-components/codec';
import {
  CaseExpr,
  ColumnRef,
  DerivedTableSource,
  FunctionSource,
  JsonArrayAggExpr,
  LiteralExpr,
  NativeJsonValueProjection,
  NullCheckExpr,
  OrderByItem,
  type ProjectionExpr,
  ProjectionItem,
  SelectAst,
  SubqueryExpr,
} from '@internal/sql-relational-core/ast';
import { blindCast } from '@internal/utils/casts';
import { structuredError } from '@internal/utils/structured-error';

const POSTGRES_CODEC_DESCRIPTOR_KIND = 'postgres-codec' as const;
const ARRAY_INPUT_ALIAS = 'array_input';
const ARRAY_ELEMENT_ALIAS = 'array_element';
const ARRAY_VALUE_COLUMN = 'value';
const ARRAY_ORDINALITY_COLUMN = 'ordinality';

export interface AnyPostgresCodecDescriptor extends AnyCodecDescriptor {
  readonly descriptorKind: typeof POSTGRES_CODEC_DESCRIPTOR_KIND;
  nativeTypeFor(ref: CodecRef): string;
  projectJson(expression: ProjectionExpr, ref: CodecRef): ProjectionExpr;
}

export abstract class PostgresCodecDescriptor<P = void>
  extends CodecDescriptorImpl<P>
  implements AnyPostgresCodecDescriptor
{
  readonly descriptorKind = POSTGRES_CODEC_DESCRIPTOR_KIND;

  protected abstract nativeType(params: P): string;
  protected abstract jsonProjection(expression: ProjectionExpr, params: P): ProjectionExpr;

  protected jsonArrayProjection(expression: ProjectionExpr, params: P): ProjectionExpr {
    const boundArray = ColumnRef.of(ARRAY_INPUT_ALIAS, ARRAY_VALUE_COLUMN);
    const element = ColumnRef.of(ARRAY_ELEMENT_ALIAS, ARRAY_VALUE_COLUMN);
    const ordinality = ColumnRef.of(ARRAY_ELEMENT_ALIAS, ARRAY_ORDINALITY_COLUMN);
    const projectedElement = CaseExpr.of(
      [{ condition: NullCheckExpr.isNull(element), value: LiteralExpr.of(null) }],
      this.jsonProjection(element, params),
    );
    const aggregate = JsonArrayAggExpr.of(
      new NativeJsonValueProjection(projectedElement),
      'emptyArray',
      [OrderByItem.asc(ordinality)],
    );
    const aggregateQuery = SelectAst.from(
      FunctionSource.of('unnest', [boundArray], {
        alias: ARRAY_ELEMENT_ALIAS,
        columnAliases: [ARRAY_VALUE_COLUMN, ARRAY_ORDINALITY_COLUMN],
      }).withOrdinality(),
    ).withProjection([ProjectionItem.of(ARRAY_VALUE_COLUMN, aggregate)]);
    const arrayResult = CaseExpr.of(
      [{ condition: NullCheckExpr.isNull(boundArray), value: LiteralExpr.of(null) }],
      SubqueryExpr.of(aggregateQuery),
    );
    const inputBinding = SelectAst.noFrom().withProjection([
      ProjectionItem.of(ARRAY_VALUE_COLUMN, expression),
    ]);

    return SubqueryExpr.of(
      SelectAst.from(DerivedTableSource.as(ARRAY_INPUT_ALIAS, inputBinding)).withProjection([
        ProjectionItem.of(ARRAY_VALUE_COLUMN, arrayResult),
      ]),
    );
  }

  nativeTypeFor(ref: CodecRef): string {
    return this.nativeType(this.validateParams(ref));
  }

  projectJson(expression: ProjectionExpr, ref: CodecRef): ProjectionExpr {
    const params = this.validateParams(ref);
    return ref.many === true
      ? this.jsonArrayProjection(expression, params)
      : this.jsonProjection(expression, params);
  }

  private validateParams(ref: CodecRef): P {
    return blindCast<
      P,
      'validateCodecTypeParams synchronously validates this descriptor schema before the typed hook'
    >(validateCodecTypeParams(this, ref));
  }
}

type DescriptorParams<D extends AnyCodecDescriptorTemplate> =
  D extends CodecDescriptorTemplate<infer P> ? P : never;

export interface PostgresCodecOptions<P> {
  /** The data type the adapted codec represents here. A template names none; this target does. */
  readonly dataType: DataTypeId;
  readonly nativeType: (params: P) => string;
  readonly jsonProjection: (expression: ProjectionExpr, params: P) => ProjectionExpr;
  readonly jsonArrayProjection?: (expression: ProjectionExpr, params: P) => ProjectionExpr;
}

export type AdaptedPostgresCodecDescriptor<D extends AnyCodecDescriptorTemplate> = Pick<
  D,
  keyof CodecDescriptorTemplate<DescriptorParams<D>>
> &
  Pick<CodecDescriptor, 'dataType'> &
  Pick<AnyPostgresCodecDescriptor, 'descriptorKind' | 'nativeTypeFor' | 'projectJson'>;

class PostgresCodecDescriptorAdapter<
  D extends AnyCodecDescriptorTemplate,
> extends PostgresCodecDescriptor<DescriptorParams<D>> {
  override readonly dataType: DataTypeId;
  override readonly codecId: string;
  override readonly traits: readonly CodecTrait[];
  override readonly targetTypes: readonly string[];
  override readonly paramsSchema: D['paramsSchema'];
  override readonly renderOutputType?: (params: DescriptorParams<D>) => string | undefined;
  override readonly renderInputType?: (params: DescriptorParams<D>) => string | undefined;
  override readonly renderValueLiteral?: (
    value: JsonValue,
    side: 'output' | 'input',
  ) => string | undefined;
  override readonly factory: (
    params: DescriptorParams<D>,
  ) => (ctx: CodecInstanceContext) => Codec<string, readonly CodecTrait[], unknown, unknown>;

  constructor(
    private readonly descriptor: D,
    private readonly options: PostgresCodecOptions<DescriptorParams<D>>,
  ) {
    super();
    this.dataType = options.dataType;
    this.codecId = descriptor.codecId;
    this.traits = descriptor.traits;
    this.targetTypes = descriptor.targetTypes;
    this.paramsSchema = descriptor.paramsSchema;
    this.factory = (params) => descriptor.factory(params);

    const renderOutputType = descriptor.renderOutputType;
    if (renderOutputType !== undefined) {
      this.renderOutputType = (params) => renderOutputType.call(descriptor, params);
    }

    const renderInputType = descriptor.renderInputType;
    if (renderInputType !== undefined) {
      this.renderInputType = (params) => renderInputType.call(descriptor, params);
    }

    const renderValueLiteral = descriptor.renderValueLiteral;
    if (renderValueLiteral !== undefined) {
      this.renderValueLiteral = (value, side) => renderValueLiteral.call(descriptor, value, side);
    }
  }

  override get isParameterized(): boolean {
    return this.descriptor.isParameterized;
  }

  protected override nativeType(params: DescriptorParams<D>): string {
    return this.options.nativeType(params);
  }

  protected override jsonProjection(
    expression: ProjectionExpr,
    params: DescriptorParams<D>,
  ): ProjectionExpr {
    return this.options.jsonProjection(expression, params);
  }

  protected override jsonArrayProjection(
    expression: ProjectionExpr,
    params: DescriptorParams<D>,
  ): ProjectionExpr {
    return this.options.jsonArrayProjection === undefined
      ? super.jsonArrayProjection(expression, params)
      : this.options.jsonArrayProjection(expression, params);
  }
}

export function postgresCodec<D extends AnyCodecDescriptorTemplate>(
  descriptor: D,
  options: PostgresCodecOptions<DescriptorParams<D>>,
): AdaptedPostgresCodecDescriptor<D> {
  return blindCast<
    AdaptedPostgresCodecDescriptor<D>,
    'the adapter delegates every ordinary descriptor member while adding the validated PostgreSQL protocol'
  >(new PostgresCodecDescriptorAdapter(descriptor, options));
}

export function definePostgresCodecs<
  const Descriptors extends readonly AnyPostgresCodecDescriptor[],
>(descriptors: Descriptors): Descriptors {
  return descriptors;
}

export function isPostgresCodecDescriptor(value: unknown): value is AnyPostgresCodecDescriptor {
  return (
    typeof value === 'object' &&
    value !== null &&
    'descriptorKind' in value &&
    value.descriptorKind === POSTGRES_CODEC_DESCRIPTOR_KIND &&
    'codecId' in value &&
    typeof value.codecId === 'string' &&
    'traits' in value &&
    Array.isArray(value.traits) &&
    'targetTypes' in value &&
    Array.isArray(value.targetTypes) &&
    value.targetTypes.every((targetType) => typeof targetType === 'string') &&
    'paramsSchema' in value &&
    isObjectLike(value.paramsSchema) &&
    '~standard' in value.paramsSchema &&
    isObjectLike(value.paramsSchema['~standard']) &&
    'validate' in value.paramsSchema['~standard'] &&
    typeof value.paramsSchema['~standard'].validate === 'function' &&
    'isParameterized' in value &&
    typeof value.isParameterized === 'boolean' &&
    'factory' in value &&
    typeof value.factory === 'function' &&
    'nativeTypeFor' in value &&
    typeof value.nativeTypeFor === 'function' &&
    'projectJson' in value &&
    typeof value.projectJson === 'function'
  );
}

function isObjectLike(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

export interface PostgresCodecDescriptorRegistry {
  descriptorFor(codecId: string): AnyPostgresCodecDescriptor | undefined;
  values(): IterableIterator<AnyPostgresCodecDescriptor>;
}

class PostgresCodecDescriptorRegistryImpl implements PostgresCodecDescriptorRegistry {
  readonly #descriptors: ReadonlyMap<string, AnyPostgresCodecDescriptor>;

  constructor(descriptors: ReadonlyMap<string, AnyPostgresCodecDescriptor>) {
    this.#descriptors = descriptors;
    Object.freeze(this);
  }

  descriptorFor(codecId: string): AnyPostgresCodecDescriptor | undefined {
    return this.#descriptors.get(codecId);
  }

  *values(): IterableIterator<AnyPostgresCodecDescriptor> {
    yield* this.#descriptors.values();
  }
}

export function buildPostgresCodecDescriptorRegistry(
  descriptors: ReadonlyArray<unknown>,
): PostgresCodecDescriptorRegistry {
  const byId = new Map<string, AnyPostgresCodecDescriptor>();

  for (const descriptor of descriptors) {
    if (!isPostgresCodecDescriptor(descriptor)) {
      const codecId = candidateCodecId(descriptor);
      throw structuredError(
        'RUNTIME.CODEC_DESCRIPTOR_INVALID',
        `Codec descriptor '${codecId}' is not a valid PostgreSQL codec descriptor.`,
        {
          why: 'PostgreSQL codec registries require the postgres-codec discriminant and complete target descriptor methods.',
          fix: 'Extend PostgresCodecDescriptor or adapt a generic descriptor with postgresCodec().',
          meta: { codecId },
        },
      );
    }

    if (byId.has(descriptor.codecId)) {
      throw structuredError(
        'RUNTIME.DUPLICATE_CODEC',
        `Duplicate PostgreSQL codec descriptor id '${descriptor.codecId}'.`,
        {
          why: 'Each codecId must resolve to exactly one PostgreSQL descriptor during registry composition.',
          fix: 'Remove the duplicate target, adapter, or extension contribution.',
          meta: { codecId: descriptor.codecId, target: 'postgres' },
        },
      );
    }

    byId.set(descriptor.codecId, descriptor);
  }

  return new PostgresCodecDescriptorRegistryImpl(byId);
}

function candidateCodecId(value: unknown): string {
  return typeof value === 'object' &&
    value !== null &&
    'codecId' in value &&
    typeof value.codecId === 'string'
    ? value.codecId
    : '<unknown>';
}
