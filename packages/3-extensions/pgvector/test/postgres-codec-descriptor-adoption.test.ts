import { CastExpr, ColumnRef, FunctionCallExpr } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { codecDescriptors, pgVectorDescriptor } from '../src/core/codecs';
import { pgvectorCodecRegistry } from '../src/core/registry';
import pgvectorExtensionDescriptor from '../src/exports/control';
import pgvectorRuntimeDescriptor from '../src/exports/runtime';

describe('pgvector PostgreSQL codec descriptor adoption', () => {
  it('uses one target descriptor instance across canonical, registry, runtime, and control contributions', () => {
    expect(codecDescriptors).toEqual([pgVectorDescriptor]);
    expect(
      codecDescriptors.every((descriptor) => descriptor.descriptorKind === 'postgres-codec'),
    ).toBe(true);
    expect([...pgvectorCodecRegistry.values()]).toEqual(codecDescriptors);
    expect(pgvectorRuntimeDescriptor.codecs()).toEqual(codecDescriptors);
    expect(pgvectorRuntimeDescriptor.types?.codecTypes?.codecDescriptors).toEqual(codecDescriptors);
    expect(pgvectorExtensionDescriptor.types?.codecTypes?.codecDescriptors).toEqual(
      codecDescriptors,
    );
  });

  it('projects a JSON numeric array', () => {
    const ref = { codecId: pgVectorDescriptor.codecId, typeParams: { length: 3 } };
    const expression = ColumnRef.of('records', 'embedding');

    // Elements widen to float8 before the array is built, so the exact value a
    // `real` denotes survives rather than its shortest text form.
    expect(pgVectorDescriptor.projectJson(expression, ref)).toEqual(
      FunctionCallExpr.of('array_to_json', [
        CastExpr.as(CastExpr.as(expression, 'real[]'), 'float8[]'),
      ]),
    );

    const codec = pgVectorDescriptor.factory(ref.typeParams)({ name: 'embedding' });
    expect(codec.encodeJson([0.1, 0.2, 0.3])).toEqual([0.1, 0.2, 0.3]);
    expect(codec.decodeJson([0.1, 0.2, 0.3])).toEqual([0.1, 0.2, 0.3]);
  });
});
