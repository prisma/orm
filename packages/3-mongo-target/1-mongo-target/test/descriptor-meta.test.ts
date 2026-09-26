import { describe, expect, it } from 'vitest';
import { mongoTargetDescriptorMeta } from '../src/core/descriptor-meta';
import mongoTargetPack from '../src/exports/pack';
import mongoRuntimeTargetDescriptor from '../src/exports/runtime';

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

describe('mongo temporal field presets', () => {
  const temporal = mongoTargetDescriptorMeta.authoring.field.temporal;
  const storage = { codecId: 'mongo/date@1', nativeType: 'date' };
  const timestampNow = { kind: 'generator', id: 'timestampNow' };

  it('createdAt fills a date on create', () => {
    expect(temporal.createdAt).toEqual({
      kind: 'fieldPreset',
      output: { ...storage, executionDefaults: { onCreate: timestampNow } },
    });
  });

  it('updatedAt fills a date on create and on update', () => {
    expect(temporal.updatedAt).toEqual({
      kind: 'fieldPreset',
      output: { ...storage, executionDefaults: { onCreate: timestampNow, onUpdate: timestampNow } },
    });
  });

  it('timestamp takes optional onCreate and onUpdate options and no precision', () => {
    expect(temporal.timestamp.args.map((arg) => arg.name)).toEqual(['onCreate', 'onUpdate']);
    expect(temporal.timestamp.output).toMatchObject(storage);
  });

  it('registers the timestampNow generator for control-plane checks', () => {
    expect(
      mongoTargetDescriptorMeta.controlMutationDefaults.generatorDescriptors.map((d) => d.id),
    ).toEqual(['timestampNow']);
  });

  it('keeps authoring contributions out of the runtime descriptor', () => {
    expect(mongoRuntimeTargetDescriptor).not.toHaveProperty('authoring');
    expect(mongoRuntimeTargetDescriptor).not.toHaveProperty('controlMutationDefaults');
  });
});

describe('mongoTargetPack', () => {
  it('matches the descriptor metadata', () => {
    expect(mongoTargetPack).toEqual(mongoTargetDescriptorMeta);
  });
});
