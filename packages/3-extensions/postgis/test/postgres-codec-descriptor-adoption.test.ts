import { ColumnRef } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { codecDescriptors, postgisGeometryDescriptor } from '../src/core/codecs';
import { postgisCodecRegistry } from '../src/core/registry';
import postgisExtensionDescriptor from '../src/exports/control';
import postgisRuntimeDescriptor from '../src/exports/runtime';
import { fromContractJson, toContractJson } from './contract-json';

describe('PostGIS PostgreSQL codec descriptor adoption', () => {
  it('uses one target descriptor instance across canonical, registry, runtime, and control contributions', () => {
    expect(codecDescriptors).toEqual([postgisGeometryDescriptor]);
    expect(
      codecDescriptors.every((descriptor) => descriptor.descriptorKind === 'postgres-codec'),
    ).toBe(true);
    expect([...postgisCodecRegistry.values()]).toEqual(codecDescriptors);
    expect(postgisRuntimeDescriptor.codecs()).toEqual(codecDescriptors);
    expect(postgisRuntimeDescriptor.types?.codecTypes?.codecDescriptors).toEqual(codecDescriptors);
    expect(postgisExtensionDescriptor.types?.codecTypes?.codecDescriptors).toEqual(
      codecDescriptors,
    );
  });

  it('preserves the geometry data type and unparameterized and required-SRID projection without changing HEXEWKB JSON', () => {
    const expression = ColumnRef.of('places', 'location');
    const unparameterizedRef = { codecId: postgisGeometryDescriptor.codecId };
    const constrainedRef = {
      codecId: postgisGeometryDescriptor.codecId,
      typeParams: { srid: 4326 },
    };

    expect(postgisGeometryDescriptor.dataType).toBe('postgis/geometry');
    expect(postgisGeometryDescriptor.projectJson(expression, unparameterizedRef)).toBe(expression);
    expect(postgisGeometryDescriptor.projectJson(expression, constrainedRef)).toBe(expression);

    const codec = postgisGeometryDescriptor.factory(constrainedRef.typeParams)({
      name: 'location',
    });
    const point = { type: 'Point', coordinates: [1, 2], srid: 4326 } as const;
    const encoded = toContractJson(codec, point);
    expect(encoded).toBe('0101000020E6100000000000000000F03F0000000000000040');
    expect(fromContractJson(codec, encoded, constrainedRef.typeParams)).toEqual(point);
  });
});
