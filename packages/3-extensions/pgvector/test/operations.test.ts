import type { CodecRef } from '@internal/framework-components/codec';
import { createSqlOperationRegistry } from '@internal/sql-operations';
import { OperationExpr, ParamRef } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import pgvectorDescriptor from '../src/exports/runtime';

function vectorExpr(value: number[], codec: CodecRef) {
  const ref = ParamRef.of(value, { codec });
  return { returnType: { codecId: codec.codecId, nullable: false }, buildAst: () => ref, codec };
}

describe('pgvector operations', () => {
  it('descriptor has correct metadata', () => {
    expect(pgvectorDescriptor.kind).toBe('extension');
    expect(pgvectorDescriptor.id).toBe('pgvector');
    expect(pgvectorDescriptor.familyId).toBe('sql');
    expect(pgvectorDescriptor.targetId).toBe('postgres');
    expect(pgvectorDescriptor.version).toBe('0.0.1');
  });

  it('descriptor contributes the pg/vector@1 codec descriptor', () => {
    const descriptors = pgvectorDescriptor.codecs();
    expect(descriptors).toBeDefined();
    expect(descriptors.length).toBe(1);

    const vectorDescriptor = descriptors.find((d) => d.codecId === 'pg/vector@1');
    expect(vectorDescriptor).toBeDefined();
    expect(vectorDescriptor?.codecId).toBe('pg/vector@1');
  });

  it('descriptor provides query operations whose impls build AST with lowering', () => {
    const operations = pgvectorDescriptor.queryOperations!();
    expect(operations).toBeDefined();
    expect(Object.keys(operations).sort()).toEqual(['cosineDistance', 'cosineSimilarity']);

    const vectorCodec: CodecRef = { codecId: 'pg/vector@1', typeParams: { length: 2 } };
    const cosineDistanceOp = operations['cosineDistance'];
    expect(cosineDistanceOp).toBeDefined();
    const distExpr = cosineDistanceOp?.impl(
      vectorExpr([1, 2], vectorCodec) as never,
      vectorExpr([3, 4], vectorCodec) as never,
    ) as unknown as { buildAst(): OperationExpr };
    const distAst = distExpr.buildAst();
    expect(distAst).toBeInstanceOf(OperationExpr);
    expect(distAst.lowering).toEqual({
      targetFamily: 'sql',
      strategy: 'function',
      template: '{{self}} <=> {{arg0}}',
    });

    const cosineSimilarityOp = operations['cosineSimilarity'];
    expect(cosineSimilarityOp).toBeDefined();
    const simExpr = cosineSimilarityOp?.impl(
      vectorExpr([1, 2], vectorCodec) as never,
      vectorExpr([3, 4], vectorCodec) as never,
    ) as unknown as { buildAst(): OperationExpr };
    const simAst = simExpr.buildAst();
    expect(simAst).toBeInstanceOf(OperationExpr);
    expect(simAst.lowering).toEqual({
      targetFamily: 'sql',
      strategy: 'function',
      template: '1 - ({{self}} <=> {{arg0}})',
    });
  });

  it('operations can be registered in registry', () => {
    const operations = pgvectorDescriptor.queryOperations!();

    const registry = createSqlOperationRegistry();
    for (const [name, op] of Object.entries(operations)) {
      registry.register(name, op);
    }

    const entries = registry.entries();
    expect(entries['cosineDistance']).toBeDefined();
    expect(entries['cosineSimilarity']).toBeDefined();
  });

  it('descriptor materializes a runtime codec when its factory is called', () => {
    const descriptors = pgvectorDescriptor.codecs();
    const vectorDescriptor = descriptors.find((d) => d.codecId === 'pg/vector@1');
    expect(vectorDescriptor).toBeDefined();

    const codec = vectorDescriptor!.factory({ length: 3 })({ name: '<test>' });
    expect(codec.id).toBe('pg/vector@1');
  });

  it('instance is minimal (identity only)', () => {
    const instance = pgvectorDescriptor.create();
    expect(instance.familyId).toBe('sql');
    expect(instance.targetId).toBe('postgres');
  });
});
