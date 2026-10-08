import { CastExpr, ColumnRef } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { codecDescriptors, pgVectorDescriptor } from '../src/core/codecs';
import { pgvectorCodecRegistry } from '../src/core/registry';
import pgvectorExtensionDescriptor from '../src/exports/control';
import pgvectorRuntimeDescriptor from '../src/exports/runtime';
import { fromContractJson, toContractJson } from './contract-json';

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

  it('projects the text PostgreSQL prints for the vector', () => {
    const ref = { codecId: pgVectorDescriptor.codecId, typeParams: { length: 3 } };
    const expression = ColumnRef.of('records', 'embedding');

    expect(pgVectorDescriptor.projectJson(expression, ref)).toEqual(
      CastExpr.as(expression, 'text'),
    );

    const codec = pgVectorDescriptor.factory(ref.typeParams)({ name: 'embedding' });
    expect(toContractJson(codec, [0.1, 0.2, 0.3])).toEqual([0.1, 0.2, 0.3]);
    expect(fromContractJson(codec, [0.1, 0.2, 0.3], ref.typeParams)).toEqual([0.1, 0.2, 0.3]);
  });
});
