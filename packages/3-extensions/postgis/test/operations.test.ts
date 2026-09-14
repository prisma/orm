import type { CodecRef } from '@internal/framework-components/codec';
import { createSqlOperationRegistry } from '@internal/sql-operations';
import { ColumnRef, OperationExpr, ParamRef } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import postgisDescriptor from '../src/exports/runtime';

const geometryCodec: CodecRef = { codecId: 'pg/geometry@1' };
const float8Codec: CodecRef = { codecId: 'pg/float8@1' };

function geometryExpr(value: unknown, codec: CodecRef = geometryCodec) {
  const ref = ParamRef.of(value, { codec });
  return { returnType: { codecId: codec.codecId, nullable: false }, buildAst: () => ref, codec };
}

describe('postgis operations', () => {
  it('descriptor has correct metadata', () => {
    expect(postgisDescriptor.kind).toBe('extension');
    expect(postgisDescriptor.id).toBe('postgis');
    expect(postgisDescriptor.familyId).toBe('sql');
    expect(postgisDescriptor.targetId).toBe('postgres');
    expect(postgisDescriptor.version).toBe('0.0.1');
  });

  it('descriptor exposes a geometry codec descriptor', () => {
    const codecs = postgisDescriptor.codecs!();
    expect(codecs).toBeDefined();
    expect(codecs.some((c) => c.codecId === 'pg/geometry@1')).toBe(true);
  });

  it('exposes the seven geospatial operations', () => {
    const operations = postgisDescriptor.queryOperations!();
    expect(Object.keys(operations).sort()).toEqual(
      [
        'contains',
        'distance',
        'distanceSphere',
        'dwithin',
        'intersects',
        'intersectsBbox',
        'within',
      ].sort(),
    );
  });

  it('binary operation impls build AST with the right lowering template', () => {
    const operations = postgisDescriptor.queryOperations!();

    const cases: ReadonlyArray<readonly [string, string]> = [
      ['distance', 'ST_Distance({{self}}, {{arg0}})'],
      ['distanceSphere', 'ST_DistanceSphere({{self}}, {{arg0}})'],
      ['contains', 'ST_Contains({{self}}, {{arg0}})'],
      ['within', 'ST_Within({{self}}, {{arg0}})'],
      ['intersects', 'ST_Intersects({{self}}, {{arg0}})'],
      ['intersectsBbox', '({{self}} && {{arg0}})'],
    ];

    for (const [method, template] of cases) {
      const op = operations[method];
      expect(op, method).toBeDefined();
      const expr = op?.impl(
        geometryExpr({ type: 'Point', coordinates: [0, 0] }) as never,
        { type: 'Point', coordinates: [1, 1] } as never,
      ) as unknown as { buildAst(): OperationExpr };
      const ast = expr.buildAst();
      expect(ast).toBeInstanceOf(OperationExpr);
      expect(ast.lowering).toEqual({
        targetFamily: 'sql',
        strategy: 'function',
        template,
      });
    }
  });

  it('dwithin impl has three-argument template', () => {
    const op = postgisDescriptor.queryOperations!()['dwithin'];
    expect(op).toBeDefined();
    const expr = op?.impl(
      geometryExpr({ type: 'Point', coordinates: [0, 0] }) as never,
      { type: 'Point', coordinates: [1, 1] } as never,
      geometryExpr(1000, float8Codec) as never,
    ) as unknown as { buildAst(): OperationExpr };
    const ast = expr.buildAst();
    expect(ast.lowering).toEqual({
      targetFamily: 'sql',
      strategy: 'function',
      template: 'ST_DWithin({{self}}, {{arg0}}, {{arg1}})',
    });
  });

  it('binary impls thread the column codec from self onto the user-value ParamRef', () => {
    const operations = postgisDescriptor.queryOperations!();
    const columnSelf = {
      codec: geometryCodec,
      returnType: { codecId: 'pg/geometry@1', nullable: false, codec: geometryCodec },
      buildAst: () => ColumnRef.of('cafe', 'location'),
    };
    const binaryMethods = [
      'distance',
      'distanceSphere',
      'contains',
      'within',
      'intersects',
      'intersectsBbox',
    ] as const;
    for (const method of binaryMethods) {
      const op = operations[method];
      expect(op, method).toBeDefined();
      const expr = op?.impl(
        columnSelf as never,
        { type: 'Point', coordinates: [1, 1] } as never,
      ) as unknown as { buildAst(): OperationExpr };
      const ast = expr.buildAst();
      const otherArg = ast.args?.[0];
      expect(otherArg, `${method} arg0`).toBeInstanceOf(ParamRef);
      expect((otherArg as ParamRef).codec, `${method} codec`).toEqual(geometryCodec);
    }
  });

  it('dwithin threads the column codec onto its geometry arg', () => {
    const op = postgisDescriptor.queryOperations!()['dwithin'];
    expect(op).toBeDefined();
    const columnSelf = {
      codec: geometryCodec,
      returnType: { codecId: 'pg/geometry@1', nullable: false, codec: geometryCodec },
      buildAst: () => ColumnRef.of('cafe', 'location'),
    };
    const expr = op?.impl(
      columnSelf as never,
      { type: 'Point', coordinates: [1, 1] } as never,
      1000 as never,
    ) as unknown as { buildAst(): OperationExpr };
    const ast = expr.buildAst();
    const otherArg = ast.args?.[0];
    expect(otherArg).toBeInstanceOf(ParamRef);
    expect((otherArg as ParamRef).codec).toEqual(geometryCodec);
  });

  it('operations register into a SqlOperationRegistry', () => {
    const operations = postgisDescriptor.queryOperations!();
    const registry = createSqlOperationRegistry();
    for (const [method, entry] of Object.entries(operations)) {
      registry.register(method, entry);
    }

    const entries = registry.entries();
    expect(entries['distance']).toBeDefined();
    expect(entries['dwithin']).toBeDefined();
    expect(entries['intersectsBbox']).toBeDefined();
  });
});
