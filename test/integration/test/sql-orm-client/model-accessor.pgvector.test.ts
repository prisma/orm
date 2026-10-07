import { bindCollectionTables, createModelAccessor } from '@internal/sql-orm-client';
import {
  BinaryExpr,
  ColumnRef,
  OperationExpr,
  type OrderByItem,
  ParamRef,
} from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { getTestContext } from './helpers';

describe('createModelAccessor (pgvector extension)', () => {
  const context = getTestContext();

  it('cosineDistance accepts a raw vector value and produces a ParamRef on arg0', () => {
    const post = createModelAccessor(
      context,
      'public',
      'Post',
      bindCollectionTables(context.contract, 'public', 'Post'),
    );
    const result = post['embedding']!.cosineDistance([1, 2, 3]) as unknown as Record<
      string,
      unknown
    >;
    const gt = (result['gt'] as (value: number) => BinaryExpr)(0.5);
    expect(gt).toBeInstanceOf(BinaryExpr);
    const opExpr = gt.left as OperationExpr;
    expect(opExpr).toBeInstanceOf(OperationExpr);
    expect(opExpr.method).toBe('cosineDistance');
    expect(opExpr.self).toEqual(ColumnRef.of('posts', 'embedding'));
    expect(opExpr.args).toHaveLength(1);
    expect(opExpr.args[0]).toBeInstanceOf(ParamRef);
    expect((opExpr.args[0] as ParamRef).value).toEqual([1, 2, 3]);
  });

  it('cosineDistance accepts another vector column and produces a ColumnRef on arg0 (cross-column composition)', () => {
    const post = createModelAccessor(
      context,
      'public',
      'Post',
      bindCollectionTables(context.contract, 'public', 'Post'),
    );
    const otherPost = createModelAccessor(
      context,
      'public',
      'Post',
      bindCollectionTables(context.contract, 'public', 'Post'),
    );

    const result = post['embedding']!.cosineDistance(otherPost['embedding']!) as unknown as Record<
      string,
      unknown
    >;
    const gt = (result['gt'] as (value: number) => BinaryExpr)(0.5);
    const opExpr = gt.left as OperationExpr;
    expect(opExpr).toBeInstanceOf(OperationExpr);
    expect(opExpr.method).toBe('cosineDistance');
    expect(opExpr.self).toEqual(ColumnRef.of('posts', 'embedding'));
    expect(opExpr.args).toHaveLength(1);
    expect(opExpr.args[0]).toBeInstanceOf(ColumnRef);
    expect(opExpr.args[0]).toEqual(ColumnRef.of('posts', 'embedding'));
  });

  describe('extension operations', () => {
    it('attaches cosineDistance to vector field, not to text field', () => {
      const accessor = createModelAccessor(
        context,
        'public',
        'Post',
        bindCollectionTables(context.contract, 'public', 'Post'),
      );
      const embedding = accessor['embedding'] as unknown as Record<string, unknown>;
      const title = accessor['title'] as unknown as Record<string, unknown>;

      expect(typeof embedding['cosineDistance']).toBe('function');
      expect(title['cosineDistance']).toBeUndefined();
    });

    it('cosineDistance() returns expression result with comparison and ordering methods', () => {
      const accessor = createModelAccessor(
        context,
        'public',
        'Post',
        bindCollectionTables(context.contract, 'public', 'Post'),
      );
      const embedding = accessor['embedding'] as unknown as Record<
        string,
        (...args: unknown[]) => unknown
      >;
      const result = embedding['cosineDistance']!([1, 2, 3]) as Record<string, unknown>;

      expect(typeof result['lt']).toBe('function');
      expect(typeof result['gt']).toBe('function');
      expect(typeof result['eq']).toBe('function');
      expect(typeof result['asc']).toBe('function');
      expect(typeof result['desc']).toBe('function');
      expect(typeof result['isNull']).toBe('function');
      expect(result['like']).toBeUndefined();
    });

    it('cosineDistance().lt() produces BinaryExpr(lt, OperationExpr, ParamRef)', () => {
      const accessor = createModelAccessor(
        context,
        'public',
        'Post',
        bindCollectionTables(context.contract, 'public', 'Post'),
      );
      const embedding = accessor['embedding'] as unknown as Record<
        string,
        (...args: unknown[]) => unknown
      >;
      const result = embedding['cosineDistance']!([1, 2, 3]) as Record<
        string,
        (...args: unknown[]) => unknown
      >;
      const expr = result['lt']!(0.2);

      expect(expr).toBeInstanceOf(BinaryExpr);
      const binary = expr as unknown as BinaryExpr;
      expect(binary.op).toBe('lt');
      expect(binary.left).toBeInstanceOf(OperationExpr);
      expect(binary.right).toBeInstanceOf(ParamRef);

      const opExpr = binary.left as unknown as OperationExpr;
      expect(opExpr.method).toBe('cosineDistance');
      expect(opExpr.self).toEqual(ColumnRef.of('posts', 'embedding'));
      expect(opExpr.args[0]).toEqual(
        ParamRef.of([1, 2, 3], {
          codec: { codecId: 'pg/vector@1', typeParams: { length: 3 } },
        }),
      );
    });

    it('cosineDistance().asc() produces OrderByItem', () => {
      const accessor = createModelAccessor(
        context,
        'public',
        'Post',
        bindCollectionTables(context.contract, 'public', 'Post'),
      );
      const embedding = accessor['embedding'] as unknown as Record<
        string,
        (...args: unknown[]) => unknown
      >;
      const result = embedding['cosineDistance']!([1, 2, 3]) as Record<string, () => unknown>;
      const order = result['asc']!() as OrderByItem;

      expect(order.dir).toBe('asc');
      expect(order.expr.kind).toBe('operation');
      expect((order.expr as OperationExpr).method).toBe('cosineDistance');
    });
  });
});
