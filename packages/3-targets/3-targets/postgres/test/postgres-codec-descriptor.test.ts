import type { JsonValue } from '@internal/contract/types';
import {
  type CodecCallContext,
  type CodecDescriptor,
  CodecDescriptorImpl,
  CodecImpl,
  type CodecInstanceContext,
  type CodecRef,
  dataTypeId,
} from '@internal/framework-components/codec';
import {
  CaseExpr,
  ColumnRef,
  DerivedTableSource,
  FunctionCallExpr,
  FunctionSource,
  JsonArrayAggExpr,
  LiteralExpr,
  NativeJsonValueProjection,
  NullCheckExpr,
  OrderByItem,
  type ProjectionExpr,
  SubqueryExpr,
} from '@internal/sql-relational-core/ast';
import { ifDefined } from '@internal/utils/defined';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { describe, expect, it } from 'vitest';
import {
  buildPostgresCodecDescriptorRegistry,
  isPostgresCodecDescriptor,
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
    validate(value) {
      if (
        typeof value === 'object' &&
        value !== null &&
        'length' in value &&
        typeof value.length === 'number'
      ) {
        return { value: { length: value.length } };
      }
      return { issues: [{ message: 'expected numeric length' }] };
    },
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
    if (!Array.isArray(json)) {
      throw new Error('Expected vector JSON array');
    }
    return json.map(Number);
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

  override renderOutputType(params: VectorParams): string {
    return `Vector<${params.length}>`;
  }

  override renderInputType(params: VectorParams): string {
    return `ReadonlyArray<number> & { length: ${params.length} }`;
  }

  override renderValueLiteral(value: JsonValue, side: 'output' | 'input'): string | undefined {
    return typeof value === 'string' ? `${side}:${value}` : undefined;
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
  readonly nativeTypeParams: VectorParams[] = [];
  readonly jsonProjectionParams: VectorParams[] = [];

  protected override nativeType(params: VectorParams): string {
    this.nativeTypeParams.push(params);
    return `custom_schema.vector_${params.length}`;
  }

  protected override jsonProjection(
    expression: ProjectionExpr,
    params: VectorParams,
  ): ProjectionExpr {
    this.jsonProjectionParams.push(params);
    return FunctionCallExpr.of('project_vector', [expression, LiteralExpr.of(params.length)]);
  }

  override factory<N extends number>(params: {
    readonly length: N;
  }): (ctx: CodecInstanceContext) => VectorCodec<N> {
    return () => new VectorCodec(this, params.length);
  }
}

const genericVectorDescriptor = new GenericVectorDescriptor();

function countReferences(value: unknown, target: object, seen = new WeakSet<object>()): number {
  if (value === target) return 1;
  if (typeof value !== 'object' || value === null || seen.has(value)) return 0;
  seen.add(value);
  return Object.values(value).reduce(
    (count, child) => count + countReferences(child, target, seen),
    0,
  );
}

function vectorRef(typeParams: JsonValue, many?: true): CodecRef {
  return {
    codecId: 'demo/direct-vector@1',
    typeParams,
    ...ifDefined('many', many),
  };
}

describe('PostgresCodecDescriptor', () => {
  it('exposes the stable structural discriminant and trusted native type string', () => {
    const descriptor = new DirectVectorDescriptor();

    expect(descriptor.descriptorKind).toBe('postgres-codec');
    expect(descriptor.nativeTypeFor(vectorRef({ length: 3 }))).toBe('custom_schema.vector_3');
    expect(descriptor.nativeTypeParams).toEqual([{ length: 3 }]);
  });

  it('validates erased type parameters before invoking typed hooks', () => {
    const descriptor = new DirectVectorDescriptor();
    const expression = ColumnRef.of('items', 'embedding');

    expect(() => descriptor.nativeTypeFor(vectorRef({ length: 'bad' }))).toThrow(
      'Invalid typeParams',
    );
    expect(() => descriptor.projectJson(expression, vectorRef({ length: 'bad' }))).toThrow(
      'Invalid typeParams',
    );
    expect(descriptor.nativeTypeParams).toEqual([]);
    expect(descriptor.jsonProjectionParams).toEqual([]);

    const projected = descriptor.projectJson(expression, vectorRef({ length: 4 }));
    expect(projected).toEqual(
      FunctionCallExpr.of('project_vector', [expression, LiteralExpr.of(4)]),
    );
    expect(descriptor.jsonProjectionParams).toEqual([{ length: 4 }]);
  });

  it('lifts scalar projection over arrays with one input binding and explicit array semantics', () => {
    const descriptor = new DirectVectorDescriptor();
    const input = FunctionCallExpr.of('volatile_vector_array', []);

    const projected = descriptor.projectJson(input, vectorRef({ length: 5 }, true));

    expect(projected).toBeInstanceOf(SubqueryExpr);
    if (!(projected instanceof SubqueryExpr)) {
      throw new Error('Expected array projection subquery');
    }
    expect(countReferences(projected, input)).toBe(1);

    const boundInput = projected.query.from;
    expect(boundInput).toBeInstanceOf(DerivedTableSource);
    if (!(boundInput instanceof DerivedTableSource)) {
      throw new Error('Expected derived input binding');
    }
    expect(boundInput.query.projection[0]?.expr).toBe(input);

    const outerCase = projected.query.projection[0]?.expr;
    expect(outerCase).toBeInstanceOf(CaseExpr);
    if (!(outerCase instanceof CaseExpr)) {
      throw new Error('Expected outer null-preserving case');
    }
    expect(outerCase.branches[0]?.condition).toEqual(
      NullCheckExpr.isNull(ColumnRef.of('array_input', 'value')),
    );
    expect(outerCase.branches[0]?.value).toEqual(LiteralExpr.of(null));

    const aggregateSubquery = outerCase.elseExpr;
    expect(aggregateSubquery).toBeInstanceOf(SubqueryExpr);
    if (!(aggregateSubquery instanceof SubqueryExpr)) {
      throw new Error('Expected aggregate subquery');
    }

    const source = aggregateSubquery.query.from;
    expect(source).toBeInstanceOf(FunctionSource);
    if (!(source instanceof FunctionSource)) {
      throw new Error('Expected unnest function source');
    }
    expect(source).toMatchObject({
      fn: 'unnest',
      args: [ColumnRef.of('array_input', 'value')],
      alias: 'array_element',
      columnAliases: ['value', 'ordinality'],
      ordinality: true,
    });

    const aggregate = aggregateSubquery.query.projection[0]?.expr;
    expect(aggregate).toBeInstanceOf(JsonArrayAggExpr);
    if (!(aggregate instanceof JsonArrayAggExpr)) {
      throw new Error('Expected JSON array aggregate');
    }
    expect(aggregate.onEmpty).toBe('emptyArray');
    expect(aggregate.orderBy).toEqual([
      OrderByItem.asc(ColumnRef.of('array_element', 'ordinality')),
    ]);
    expect(aggregate.expr).toBeInstanceOf(NativeJsonValueProjection);

    const projectedElement = aggregate.expr.value;
    expect(projectedElement).toBeInstanceOf(CaseExpr);
    if (!(projectedElement instanceof CaseExpr)) {
      throw new Error('Expected null-element-preserving case');
    }
    expect(projectedElement.branches[0]?.condition).toEqual(
      NullCheckExpr.isNull(ColumnRef.of('array_element', 'value')),
    );
    expect(projectedElement.branches[0]?.value).toEqual(LiteralExpr.of(null));
    expect(projectedElement.elseExpr).toEqual(
      FunctionCallExpr.of('project_vector', [
        ColumnRef.of('array_element', 'value'),
        LiteralExpr.of(5),
      ]),
    );
    expect(descriptor.jsonProjectionParams).toEqual([{ length: 5 }]);
  });
});

describe('postgresCodec', () => {
  it('preserves the wrapped descriptor contract and materialization behavior', () => {
    const descriptor = postgresCodec(genericVectorDescriptor, {
      dataType: dataTypeId('demo/fixture'),
      nativeType: (params) => `vector(${params.length})`,
      jsonProjection: (expression, params) =>
        FunctionCallExpr.of('project_generic_vector', [expression, LiteralExpr.of(params.length)]),
    });

    expect(descriptor.descriptorKind).toBe('postgres-codec');
    expect(descriptor.codecId).toBe(genericVectorDescriptor.codecId);
    expect(descriptor.traits).toBe(genericVectorDescriptor.traits);
    expect(descriptor.targetTypes).toBe(genericVectorDescriptor.targetTypes);
    expect(descriptor.paramsSchema).toBe(genericVectorDescriptor.paramsSchema);
    expect(descriptor.isParameterized).toBe(genericVectorDescriptor.isParameterized);
    expect(descriptor.renderOutputType?.({ length: 6 })).toBe('Vector<6>');
    expect(descriptor.renderInputType?.({ length: 6 })).toBe(
      'ReadonlyArray<number> & { length: 6 }',
    );
    expect(descriptor.renderValueLiteral?.('value', 'input')).toBe('input:value');
    expect('extensionOnly' in descriptor).toBe(false);
    expect('extensionOnlyMethod' in descriptor).toBe(false);

    const codec = descriptor.factory({ length: 6 })({} as CodecInstanceContext);
    expect(codec).toBeInstanceOf(VectorCodec);
    expect(codec.length).toBe(6);
    expect(codec.descriptor).toBe(genericVectorDescriptor);
  });

  it('accepts an array override only after typed parameter validation', () => {
    const overrideCalls: VectorParams[] = [];
    const descriptor = postgresCodec(genericVectorDescriptor, {
      dataType: dataTypeId('demo/fixture'),
      nativeType: (params) => `vector(${params.length})`,
      jsonProjection: (expression) => expression,
      jsonArrayProjection: (expression, params) => {
        overrideCalls.push(params);
        return FunctionCallExpr.of('optimized_vector_array', [
          expression,
          LiteralExpr.of(params.length),
        ]);
      },
    });
    const expression = ColumnRef.of('items', 'embeddings');
    const ref = { codecId: descriptor.codecId, typeParams: { length: 7 }, many: true } as const;

    expect(descriptor.projectJson(expression, ref)).toEqual(
      FunctionCallExpr.of('optimized_vector_array', [expression, LiteralExpr.of(7)]),
    );
    expect(overrideCalls).toEqual([{ length: 7 }]);

    expect(() =>
      descriptor.projectJson(expression, {
        codecId: descriptor.codecId,
        typeParams: { length: 'bad' },
        many: true,
      }),
    ).toThrow('Invalid typeParams');
    expect(overrideCalls).toEqual([{ length: 7 }]);
  });
});

describe('Postgres codec descriptor registry', () => {
  it('accepts structurally valid descriptors without relying on class identity', () => {
    const descriptor = new DirectVectorDescriptor();
    const structuralDescriptor = {
      descriptorKind: descriptor.descriptorKind,
      codecId: descriptor.codecId,
      traits: descriptor.traits,
      targetTypes: descriptor.targetTypes,
      paramsSchema: descriptor.paramsSchema,
      isParameterized: descriptor.isParameterized,
      factory: descriptor.factory.bind(descriptor),
      nativeTypeFor: descriptor.nativeTypeFor.bind(descriptor),
      projectJson: descriptor.projectJson.bind(descriptor),
    };

    expect(structuralDescriptor).not.toBeInstanceOf(PostgresCodecDescriptor);
    expect(isPostgresCodecDescriptor(structuralDescriptor)).toBe(true);

    const registry = buildPostgresCodecDescriptorRegistry([structuralDescriptor]);
    expect(Object.isFrozen(registry)).toBe(true);
    expect(registry.descriptorFor(descriptor.codecId)).toBe(structuralDescriptor);
    expect([...registry.values()]).toEqual([structuralDescriptor]);
  });

  it('rejects raw, wrong-target, malformed, and duplicate descriptors clearly', () => {
    const descriptor = new DirectVectorDescriptor();
    const validShape = {
      descriptorKind: descriptor.descriptorKind,
      codecId: descriptor.codecId,
      traits: descriptor.traits,
      targetTypes: descriptor.targetTypes,
      paramsSchema: descriptor.paramsSchema,
      isParameterized: descriptor.isParameterized,
      factory: descriptor.factory.bind(descriptor),
      nativeTypeFor: descriptor.nativeTypeFor.bind(descriptor),
      projectJson: descriptor.projectJson.bind(descriptor),
    };

    expect(() => buildPostgresCodecDescriptorRegistry([genericVectorDescriptor])).toThrow(
      /demo\/vector@1.*PostgreSQL codec descriptor/,
    );
    expect(() =>
      buildPostgresCodecDescriptorRegistry([{ ...validShape, descriptorKind: 'sqlite-codec' }]),
    ).toThrow(/demo\/direct-vector@1.*PostgreSQL codec descriptor/);
    expect(() =>
      buildPostgresCodecDescriptorRegistry([{ ...validShape, projectJson: undefined }]),
    ).toThrow(/demo\/direct-vector@1.*PostgreSQL codec descriptor/);
    expect(() =>
      buildPostgresCodecDescriptorRegistry([
        {
          ...validShape,
          paramsSchema: { '~standard': { version: 1, vendor: 'test' } },
        },
      ]),
    ).toThrow(/demo\/direct-vector@1.*PostgreSQL codec descriptor/);
    expect(() =>
      buildPostgresCodecDescriptorRegistry([
        {
          ...validShape,
          paramsSchema: {
            '~standard': { version: 1, vendor: 'test', validate: 'not-callable' },
          },
        },
      ]),
    ).toThrow(/demo\/direct-vector@1.*PostgreSQL codec descriptor/);
    expect(() => buildPostgresCodecDescriptorRegistry([validShape, validShape])).toThrow(
      /Duplicate PostgreSQL codec descriptor id.*demo\/direct-vector@1/,
    );

    expect(() =>
      buildPostgresCodecDescriptorRegistry([{ ...validShape, descriptorKind: 'sqlite-codec' }]),
    ).toThrow(expect.objectContaining({ code: 'RUNTIME.CODEC_DESCRIPTOR_INVALID' }));
    expect(() => buildPostgresCodecDescriptorRegistry([validShape, validShape])).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.DUPLICATE_CODEC',
        meta: expect.objectContaining({ target: 'postgres' }),
      }),
    );
  });
});
