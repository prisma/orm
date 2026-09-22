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
import type { ProjectionExpr } from '@internal/sql-relational-core/ast';
import { blindCast } from '@internal/utils/casts';
import { structuredError } from '@internal/utils/structured-error';

const SQLITE_CODEC_DESCRIPTOR_KIND = 'sqlite-codec' as const;

export interface AnySqliteCodecDescriptor extends AnyCodecDescriptor {
  readonly descriptorKind: typeof SQLITE_CODEC_DESCRIPTOR_KIND;
  projectJson(expression: ProjectionExpr, ref: CodecRef): ProjectionExpr;
}

export abstract class SqliteCodecDescriptor<P = void>
  extends CodecDescriptorImpl<P>
  implements AnySqliteCodecDescriptor
{
  readonly descriptorKind = SQLITE_CODEC_DESCRIPTOR_KIND;

  protected abstract jsonProjection(expression: ProjectionExpr, params: P): ProjectionExpr;

  projectJson(expression: ProjectionExpr, ref: CodecRef): ProjectionExpr {
    if (ref.many === true) {
      throw structuredError(
        'RUNTIME.CODEC_DESCRIPTOR_ARRAY_UNSUPPORTED',
        `Codec '${ref.codecId}' uses CodecRef.many, but SQLite codec descriptors do not support stored scalar arrays.`,
        {
          why: 'SQLite has no stored scalar-array codec protocol, so applying a scalar projection to the whole stored array would be ambiguous.',
          fix: 'Use a scalar CodecRef or introduce an explicit target representation before projecting stored arrays.',
          meta: { codecId: ref.codecId },
        },
      );
    }

    return this.jsonProjection(expression, this.validateParams(ref));
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

export interface SqliteCodecOptions<P> {
  /** The data type the adapted codec represents here. A template names none; this target does. */
  readonly dataType: DataTypeId;
  readonly jsonProjection: (expression: ProjectionExpr, params: P) => ProjectionExpr;
}

export type AdaptedSqliteCodecDescriptor<D extends AnyCodecDescriptorTemplate> = Pick<
  D,
  keyof CodecDescriptorTemplate<DescriptorParams<D>>
> &
  Pick<CodecDescriptor, 'dataType'> &
  Pick<AnySqliteCodecDescriptor, 'descriptorKind' | 'projectJson'>;

class SqliteCodecDescriptorAdapter<
  D extends AnyCodecDescriptorTemplate,
> extends SqliteCodecDescriptor<DescriptorParams<D>> {
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

  constructor(
    private readonly descriptor: D,
    private readonly options: SqliteCodecOptions<DescriptorParams<D>>,
  ) {
    super();
    this.dataType = options.dataType;
    this.codecId = descriptor.codecId;
    this.traits = descriptor.traits;
    this.targetTypes = descriptor.targetTypes;
    this.paramsSchema = descriptor.paramsSchema;

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

  override readonly factory = (
    params: DescriptorParams<D>,
  ): ((ctx: CodecInstanceContext) => Codec<string, readonly CodecTrait[], unknown, unknown>) =>
    this.descriptor.factory(params);

  protected override jsonProjection(
    expression: ProjectionExpr,
    params: DescriptorParams<D>,
  ): ProjectionExpr {
    return this.options.jsonProjection(expression, params);
  }
}

export function sqliteCodec<D extends AnyCodecDescriptorTemplate>(
  descriptor: D,
  options: SqliteCodecOptions<DescriptorParams<D>>,
): AdaptedSqliteCodecDescriptor<D> {
  return blindCast<
    AdaptedSqliteCodecDescriptor<D>,
    'the adapter delegates every ordinary descriptor member while adding the validated SQLite protocol'
  >(new SqliteCodecDescriptorAdapter(descriptor, options));
}

export function defineSqliteCodecs<const Descriptors extends readonly AnySqliteCodecDescriptor[]>(
  descriptors: Descriptors,
): Descriptors {
  return descriptors;
}

export function isSqliteCodecDescriptor(value: unknown): value is AnySqliteCodecDescriptor {
  return (
    typeof value === 'object' &&
    value !== null &&
    'descriptorKind' in value &&
    value.descriptorKind === SQLITE_CODEC_DESCRIPTOR_KIND &&
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
    'projectJson' in value &&
    typeof value.projectJson === 'function'
  );
}

function isObjectLike(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

export interface SqliteCodecDescriptorRegistry {
  descriptorFor(codecId: string): AnySqliteCodecDescriptor | undefined;
  values(): IterableIterator<AnySqliteCodecDescriptor>;
}

class SqliteCodecDescriptorRegistryImpl implements SqliteCodecDescriptorRegistry {
  readonly #descriptors: ReadonlyMap<string, AnySqliteCodecDescriptor>;

  constructor(descriptors: ReadonlyMap<string, AnySqliteCodecDescriptor>) {
    this.#descriptors = descriptors;
    Object.freeze(this);
  }

  descriptorFor(codecId: string): AnySqliteCodecDescriptor | undefined {
    return this.#descriptors.get(codecId);
  }

  *values(): IterableIterator<AnySqliteCodecDescriptor> {
    yield* this.#descriptors.values();
  }
}

export function buildSqliteCodecDescriptorRegistry(
  descriptors: ReadonlyArray<unknown>,
): SqliteCodecDescriptorRegistry {
  const byId = new Map<string, AnySqliteCodecDescriptor>();

  for (const descriptor of descriptors) {
    if (!isSqliteCodecDescriptor(descriptor)) {
      const codecId = candidateCodecId(descriptor);
      throw structuredError(
        'RUNTIME.CODEC_DESCRIPTOR_INVALID',
        `Codec descriptor '${codecId}' is not a valid SQLite codec descriptor.`,
        {
          why: 'SQLite codec registries require the sqlite-codec discriminant and complete target descriptor methods.',
          fix: 'Extend SqliteCodecDescriptor or adapt a generic descriptor with sqliteCodec().',
          meta: { codecId },
        },
      );
    }

    if (byId.has(descriptor.codecId)) {
      throw structuredError(
        'RUNTIME.DUPLICATE_CODEC',
        `Duplicate SQLite codec descriptor id '${descriptor.codecId}'.`,
        {
          why: 'Each codecId must resolve to exactly one SQLite descriptor during registry composition.',
          fix: 'Remove the duplicate target, adapter, or extension contribution.',
          meta: { codecId: descriptor.codecId, target: 'sqlite' },
        },
      );
    }

    byId.set(descriptor.codecId, descriptor);
  }

  return new SqliteCodecDescriptorRegistryImpl(byId);
}

function candidateCodecId(value: unknown): string {
  return typeof value === 'object' &&
    value !== null &&
    'codecId' in value &&
    typeof value.codecId === 'string'
    ? value.codecId
    : '<unknown>';
}
