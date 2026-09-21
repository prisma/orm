import { describe, expect, it } from 'vitest';
import { mongoTargetDescriptorMeta } from '../src/core/descriptor-meta';
import mongoTargetPack from '../src/exports/pack';

describe('mongoTargetDescriptorMeta', () => {
  it('has the expected identity shape', () => {
    expect(mongoTargetDescriptorMeta).toMatchObject({
      kind: 'target',
      familyId: 'mongo',
      targetId: 'mongo',
      id: 'mongo',
      version: '0.0.1',
      capabilities: {},
      defaultNamespaceId: '__unbound__',
    });
  });

  it('carries its target codec descriptors for build-time authoring', () => {
    const codecIds = mongoTargetDescriptorMeta.types.codecTypes.codecDescriptors.map(
      (d) => d.codecId,
    );
    expect(codecIds).toContain('mongo/string@1');
    expect(codecIds).toContain('mongo/objectId@1');
  });

  it('declares namespace support, so emitted model names keep their namespace segment', () => {
    expect(mongoTargetDescriptorMeta.supportsNamespaces).toBe(true);
  });

  it('declares defaultNamespaceId as __unbound__', () => {
    expect(mongoTargetDescriptorMeta.defaultNamespaceId).toBe('__unbound__');
  });
});

describe('mongoTargetPack', () => {
  it('matches the descriptor metadata', () => {
    expect(mongoTargetPack).toEqual(mongoTargetDescriptorMeta);
  });
});
