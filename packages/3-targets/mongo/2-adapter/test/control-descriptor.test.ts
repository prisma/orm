import { describe, expect, it } from 'vitest';
import mongoAdapterDescriptor, { MongoControlAdapterImpl } from '../src/exports/control';

describe('mongoAdapterDescriptor', () => {
  it('contributes no type constructors, which the target contributes', () => {
    expect(mongoAdapterDescriptor).not.toHaveProperty('authoring');
  });

  it('points emitted contracts at the target codec types', () => {
    expect(mongoAdapterDescriptor.types?.codecTypes?.import).toEqual({
      package: '@internal/target-mongo/codec-types',
      named: 'CodecTypes',
      alias: 'MongoCodecTypes',
    });
  });
});

describe('MongoControlAdapterImpl', () => {
  it('names the collection that holds the markers', () => {
    expect(new MongoControlAdapterImpl().markerLocation).toBe('_prisma_migrations');
  });
});
