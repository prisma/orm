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
  type DataType,
  type DataTypeId,
  validateCodecTypeParams,
} from '@internal/framework-components/codec';
import type { ProjectionExpr } from '@internal/sql-relational-core/ast';
import { blindCast } from '@internal/utils/casts';
import { InternalError } from '@internal/utils/internal-error';
import { structuredError } from '@internal/utils/structured-error';
import type { StandardSchemaV1 } from '@standard-schema/spec';

const MYSQL_CODEC_DESCRIPTOR_KIND = 'mysql-codec' as const;

export interface AnyMysqlCodecDescriptor extends AnyCodecDescriptor {
  readonly descriptorKind: typeof MYSQL_CODEC_DESCRIPTOR_KIND;
  projectJson(expression: ProjectionExpr, ref: CodecRef): ProjectionExpr;
}

/**
 * A codec descriptor the MySQL target registers. `jsonProjection` writes a column into the JSON an include reads, in the form the codec's `fromWire` reads from a row.
 */
export abstract class MysqlCodecDescriptor<P = void>
  extends CodecDescriptorImpl<P>
  implements AnyMysqlCodecDescriptor
{
  readonly descriptorKind = MYSQL_CODEC_DESCRIPTOR_KIND;

  protected abstract jsonProjection(expression: ProjectionExpr, params: P): ProjectionExpr;

  projectJson(expression: ProjectionExpr, ref: CodecRef): ProjectionExpr {
    if (ref.many === true) {
      throw structuredError(
        'RUNTIME.CODEC_DESCRIPTOR_ARRAY_UNSUPPORTED',
        `Codec '${ref.codecId}' uses CodecRef.many, but MySQL has no stored scalar arrays.`,
        {
          why: 'MySQL codec descriptors project scalar values only.',
          fix: 'Use a scalar CodecRef.',
          meta: { codecId: ref.codecId },
        },
      );
    }
    return this.jsonProjection(
      expression,
      blindCast<P, 'validateCodecTypeParams validates the params against this descriptor schema'>(
        validateCodecTypeParams(this, ref),
      ),
    );
  }
}

type DescriptorParams<D extends AnyCodecDescriptorTemplate> =
  D extends CodecDescriptorTemplate<infer P> ? P : never;

type DescriptorCodec<D extends AnyCodecDescriptorTemplate> = ReturnType<ReturnType<D['factory']>>;

export interface MysqlCodecOptions<
  P,
  C extends Codec<string, readonly CodecTrait[], unknown, unknown> = Codec<
    string,
    readonly CodecTrait[],
    unknown,
    unknown
  >,
> {
  /** The data type the adapted codec represents here. Its parameter schema is the codec's. */
  readonly dataType: DataType;
  /** Renders the literal of the value the codec reads from a stored value of `dataType`. */
  readonly renderValueLiteral?: (value: JsonValue, side: 'output' | 'input') => string | undefined;
  /** Writes a column of this codec into the JSON an include reads. */
  readonly jsonProjection: (expression: ProjectionExpr, params: P) => ProjectionExpr;
  /** Builds the codec of the family template, constructed with `dataType` and the column's parameters. */
  readonly factory: (
    descriptor: MysqlCodecDescriptor<P>,
    dataType: DataType,
    params: P,
  ) => (ctx: CodecInstanceContext) => C;
}

export type AdaptedMysqlCodecDescriptor<D extends AnyCodecDescriptorTemplate> = Pick<
  D,
  keyof CodecDescriptorTemplate<DescriptorParams<D>>
> &
  Pick<CodecDescriptor, 'dataType'> &
  Pick<AnyMysqlCodecDescriptor, 'descriptorKind' | 'projectJson'>;

class MysqlCodecDescriptorAdapter<
  D extends AnyCodecDescriptorTemplate,
> extends MysqlCodecDescriptor<DescriptorParams<D>> {
  override readonly dataType: DataTypeId;
  override readonly codecId: string;
  override readonly traits: readonly CodecTrait[];
  override readonly paramsSchema: StandardSchemaV1<DescriptorParams<D>> | undefined;
  override readonly renderValueLiteral?: (
    value: JsonValue,
    side: 'output' | 'input',
  ) => string | undefined;

  constructor(
    descriptor: D,
    private readonly options: MysqlCodecOptions<DescriptorParams<D>>,
  ) {
    super();
    this.dataType = options.dataType.id;
    this.codecId = descriptor.codecId;
    this.traits = descriptor.traits;
    this.paramsSchema = blindCast<
      StandardSchemaV1<DescriptorParams<D>> | undefined,
      'the data type the codec represents declares the parameters the codec takes'
    >(options.dataType.params);
    if (descriptor.renderValueLiteral !== undefined) {
      throw new InternalError(
        `${descriptor.codecId} is a family codec template with its own renderValueLiteral; pass renderValueLiteral in the options instead.`,
      );
    }
    if (options.renderValueLiteral !== undefined) {
      this.renderValueLiteral = options.renderValueLiteral;
    }
  }

  override readonly factory = (
    params: DescriptorParams<D>,
  ): ((ctx: CodecInstanceContext) => Codec<string, readonly CodecTrait[], unknown, unknown>) =>
    this.options.factory(this, this.options.dataType, params);

  protected override jsonProjection(
    expression: ProjectionExpr,
    params: DescriptorParams<D>,
  ): ProjectionExpr {
    return this.options.jsonProjection(expression, params);
  }
}

/** Adapts a family codec template to MySQL, naming the MySQL data type it represents. */
export function mysqlCodec<D extends AnyCodecDescriptorTemplate>(
  descriptor: D,
  options: MysqlCodecOptions<DescriptorParams<D>, DescriptorCodec<D>>,
): AdaptedMysqlCodecDescriptor<D> {
  return blindCast<
    AdaptedMysqlCodecDescriptor<D>,
    'the adapter delegates every ordinary descriptor member while adding the MySQL protocol'
  >(new MysqlCodecDescriptorAdapter(descriptor, options));
}

export function isMysqlCodecDescriptor(value: unknown): value is AnyMysqlCodecDescriptor {
  return (
    typeof value === 'object' &&
    value !== null &&
    'descriptorKind' in value &&
    value.descriptorKind === MYSQL_CODEC_DESCRIPTOR_KIND &&
    'codecId' in value &&
    typeof value.codecId === 'string' &&
    'factory' in value &&
    typeof value.factory === 'function' &&
    'projectJson' in value &&
    typeof value.projectJson === 'function'
  );
}

export interface MysqlCodecDescriptorRegistry {
  descriptorFor(codecId: string): AnyMysqlCodecDescriptor | undefined;
  values(): IterableIterator<AnyMysqlCodecDescriptor>;
}

class MysqlCodecDescriptorRegistryImpl implements MysqlCodecDescriptorRegistry {
  readonly #descriptors: ReadonlyMap<string, AnyMysqlCodecDescriptor>;

  constructor(descriptors: ReadonlyMap<string, AnyMysqlCodecDescriptor>) {
    this.#descriptors = descriptors;
    Object.freeze(this);
  }

  descriptorFor(codecId: string): AnyMysqlCodecDescriptor | undefined {
    return this.#descriptors.get(codecId);
  }

  *values(): IterableIterator<AnyMysqlCodecDescriptor> {
    yield* this.#descriptors.values();
  }
}

/** Indexes MySQL codec descriptors by codec id, refusing a descriptor that is not a MySQL one and a codec id given twice. */
export function buildMysqlCodecDescriptorRegistry(
  descriptors: ReadonlyArray<unknown>,
): MysqlCodecDescriptorRegistry {
  const byId = new Map<string, AnyMysqlCodecDescriptor>();
  for (const descriptor of descriptors) {
    if (!isMysqlCodecDescriptor(descriptor)) {
      const codecId = candidateCodecId(descriptor);
      throw structuredError(
        'RUNTIME.CODEC_DESCRIPTOR_INVALID',
        `Codec descriptor '${codecId}' is not a valid MySQL codec descriptor.`,
        {
          why: 'MySQL codec registries require the mysql-codec discriminant and the MySQL descriptor methods.',
          fix: 'Extend MysqlCodecDescriptor or adapt a family descriptor with mysqlCodec().',
          meta: { codecId },
        },
      );
    }
    if (byId.has(descriptor.codecId)) {
      throw structuredError(
        'RUNTIME.DUPLICATE_CODEC',
        `Duplicate MySQL codec descriptor id '${descriptor.codecId}'.`,
        {
          why: 'Each codecId must resolve to exactly one MySQL descriptor during registry composition.',
          fix: 'Remove the duplicate target, adapter, or extension contribution.',
          meta: { codecId: descriptor.codecId, target: 'mysql' },
        },
      );
    }
    byId.set(descriptor.codecId, descriptor);
  }
  return new MysqlCodecDescriptorRegistryImpl(byId);
}

function candidateCodecId(value: unknown): string {
  return typeof value === 'object' &&
    value !== null &&
    'codecId' in value &&
    typeof value.codecId === 'string'
    ? value.codecId
    : '<unknown>';
}
