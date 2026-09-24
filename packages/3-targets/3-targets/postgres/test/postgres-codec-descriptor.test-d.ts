import type { JsonValue } from '@internal/contract/types';
import {
  type CodecCallContext,
  type CodecDescriptor,
  CodecDescriptorImpl,
  CodecImpl,
  type CodecInstanceContext,
  type CodecTrait,
  dataTypeId,
} from '@internal/framework-components/codec';
import { FunctionCallExpr, type ProjectionExpr } from '@internal/sql-relational-core/ast';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { expectTypeOf, test } from 'vitest';
import {
  definePostgresCodecs,
  PostgresCodecDescriptor,
  postgresCodec,
} from '../src/exports/codec-descriptor';

interface VectorParams {
  readonly length: number;
}

const vectorParamsSchema: StandardSchemaV1<VectorParams> = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: (input) => ({ value: input as VectorParams }),
  },
};

class VectorCodec<N extends number> extends CodecImpl<
  'demo/vector@1',
  readonly ['equality'],
  string,
  ReadonlyArray<number>
> {
  constructor(
    descriptor: CodecDescriptor<VectorParams>,
    readonly length: N,
  ) {
    super(descriptor);
  }

  async encode(value: ReadonlyArray<number>, _ctx: CodecCallContext): Promise<string> {
    return `[${value.join(',')}]`;
  }

  async decode(wire: string, _ctx: CodecCallContext): Promise<ReadonlyArray<number>> {
    return wire.slice(1, -1).split(',').map(Number);
  }

  encodeJson(value: ReadonlyArray<number>): JsonValue {
    return [...value];
  }

  decodeJson(json: JsonValue): ReadonlyArray<number> {
    return json as unknown as ReadonlyArray<number>;
  }
}

class GenericVectorDescriptor extends CodecDescriptorImpl<VectorParams> {
  override readonly dataType = dataTypeId('demo/fixture');
  override readonly codecId = 'demo/vector@1' as const;
  override readonly traits = ['equality'] as const;
  override readonly targetTypes = ['vector'] as const;
  override readonly paramsSchema = vectorParamsSchema;
  readonly extensionOnly = 'wrapped-only' as const;

  extensionOnlyMethod(): 'wrapped-only' {
    return this.extensionOnly;
  }

  override factory<N extends number>(params: {
    readonly length: N;
  }): (ctx: CodecInstanceContext) => VectorCodec<N> {
    return () => new VectorCodec(this, params.length);
  }
}

class DirectVectorDescriptor extends PostgresCodecDescriptor<VectorParams> {
  override readonly dataType = dataTypeId('demo/fixture');
  override readonly codecId = 'demo/direct-vector@1' as const;
  override readonly traits = ['equality'] as const;
  override readonly targetTypes = ['vector'] as const;
  override readonly paramsSchema = vectorParamsSchema;

  protected override nativeType(params: VectorParams): string {
    return `vector(${params.length})`;
  }

  protected override jsonProjection(
    expression: ProjectionExpr,
    _params: VectorParams,
  ): ProjectionExpr {
    return expression;
  }

  override factory<N extends number>(params: {
    readonly length: N;
  }): (ctx: CodecInstanceContext) => VectorCodec<N> {
    return () => new VectorCodec(this, params.length);
  }
}

const genericDescriptor = new GenericVectorDescriptor();
const directDescriptor = new DirectVectorDescriptor();
const adaptedDescriptor = postgresCodec(genericDescriptor, {
  dataType: dataTypeId('demo/fixture'),
  nativeType(params) {
    expectTypeOf(params).toEqualTypeOf<VectorParams>();
    return `vector(${params.length})`;
  },
  jsonProjection(expression, params) {
    expectTypeOf(expression).toEqualTypeOf<ProjectionExpr>();
    expectTypeOf(params).toEqualTypeOf<VectorParams>();
    return expression;
  },
  jsonArrayProjection(expression, params) {
    expectTypeOf(expression).toEqualTypeOf<ProjectionExpr>();
    expectTypeOf(params).toEqualTypeOf<VectorParams>();
    return FunctionCallExpr.of('optimized_vector_array', [expression]);
  },
});

test('direct and adapted descriptors preserve codec and factory literals', () => {
  expectTypeOf(directDescriptor.codecId).toEqualTypeOf<'demo/direct-vector@1'>();
  expectTypeOf(adaptedDescriptor.codecId).toEqualTypeOf<'demo/vector@1'>();
  expectTypeOf(adaptedDescriptor.traits).toEqualTypeOf<readonly ['equality']>();
  expectTypeOf(adaptedDescriptor.targetTypes).toEqualTypeOf<readonly ['vector']>();

  expectTypeOf(adaptedDescriptor.factory({ length: 1536 })).toEqualTypeOf<
    (ctx: CodecInstanceContext) => VectorCodec<1536>
  >();
  expectTypeOf(adaptedDescriptor.factory({ length: 3 })({} as CodecInstanceContext)).toEqualTypeOf<
    VectorCodec<3>
  >();

  // @ts-expect-error -- the adapter does not expose wrapped-only fields
  adaptedDescriptor.extensionOnly;
  // @ts-expect-error -- the adapter does not expose wrapped-only methods
  adaptedDescriptor.extensionOnlyMethod();
});

test('definePostgresCodecs preserves the readonly descriptor tuple', () => {
  const descriptors = definePostgresCodecs([adaptedDescriptor, directDescriptor] as const);
  expectTypeOf(descriptors).toEqualTypeOf<
    readonly [typeof adaptedDescriptor, typeof directDescriptor]
  >();
});

test('definePostgresCodecs rejects an unadapted generic descriptor', () => {
  // @ts-expect-error -- generic descriptors need an explicit PostgreSQL adapter
  definePostgresCodecs([genericDescriptor] as const);
});

test('postgresCodec requires explicit native and scalar projection behavior', () => {
  // @ts-expect-error -- nativeType is mandatory
  postgresCodec(genericDescriptor, { jsonProjection: (expression) => expression });
  // @ts-expect-error -- jsonProjection is mandatory
  postgresCodec(genericDescriptor, { nativeType: () => 'vector' });
});

// @ts-expect-error -- direct descriptors must implement scalar JSON projection
class MissingJsonProjection extends PostgresCodecDescriptor<VectorParams> {
  override readonly dataType = dataTypeId('demo/fixture');
  override readonly codecId = 'demo/missing-json@1' as const;
  override readonly traits: readonly CodecTrait[] = [];
  override readonly targetTypes: readonly string[] = [];
  override readonly paramsSchema = vectorParamsSchema;
  protected override nativeType(): string {
    return 'vector';
  }
  override factory(): (ctx: CodecInstanceContext) => VectorCodec<number> {
    return () => new VectorCodec(this, 1);
  }
}

// @ts-expect-error -- direct descriptors must implement native type resolution
class MissingNativeType extends PostgresCodecDescriptor<VectorParams> {
  override readonly dataType = dataTypeId('demo/fixture');
  override readonly codecId = 'demo/missing-native@1' as const;
  override readonly traits: readonly CodecTrait[] = [];
  override readonly targetTypes: readonly string[] = [];
  override readonly paramsSchema = vectorParamsSchema;
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override factory(): (ctx: CodecInstanceContext) => VectorCodec<number> {
    return () => new VectorCodec(this, 1);
  }
}

void MissingJsonProjection;
void MissingNativeType;
